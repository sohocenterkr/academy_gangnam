import { randomUUID } from 'node:crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString, getTodayKST } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { messageCampaigns, messageCampaignMedia, messageRecipients, messageSendItems, messageTemplates } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';
import { resolveRecipients, type DuplicateStrategy, type RecipientFilter, type RecipientType } from '../services/messageRecipients';
import { classifyMessageLength } from '../utils/messageTemplate';

const DAILY_SEND_ITEM_LIMIT = 500;

const createDraftSchema = z.object({
  name: z.string().min(1),
  messageType: z.enum(['informational', 'marketing']),
  templateId: z.string().optional(),
});

const recipientsSchema = z.object({
  recipientType: z.enum(['all', 'grade', 'course', 'individual']),
  filter: z.object({ gradeLevelId: z.string().optional(), courseId: z.string().optional(), studentIds: z.array(z.string()).optional() }).default({}),
  duplicateStrategy: z.enum(['merge', 'separate']).default('merge'),
});

const contentSchema = z.object({
  bodySource: z.string().min(1),
  mediaIds: z.array(z.string()).default([]),
});

const approveSchema = z.object({
  sendMode: z.enum(['immediate', 'scheduled']),
  scheduledAt: z.iso.datetime().optional(),
  deviceId: z.string().min(1),
  confirmOptOutOverride: z.boolean().default(false),
});

export interface MessageDraftsRouterDeps {
  sessionSecret: string;
}

async function loadDraft(id: string) {
  const [campaign] = await db.select().from(messageCampaigns).where(eq(messageCampaigns.id, id));
  return campaign ?? null;
}

export function createMessageDraftsRouter(deps: MessageDraftsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireMessagingManage = createRequirePermission(PERMISSIONS.MESSAGING_MANAGE);

  router.post('/', requireAuth, requireMessagingManage, async (req, res) => {
    const parsed = parseBody(createDraftSchema, req.body, res, req.requestId);
    if (!parsed) return;

    let bodySource = '';
    if (parsed.templateId) {
      const [template] = await db.select().from(messageTemplates).where(eq(messageTemplates.id, parsed.templateId));
      if (template) bodySource = template.body;
    }

    const [created] = await db
      .insert(messageCampaigns)
      .values({
        name: parsed.name,
        messageType: parsed.messageType,
        templateId: parsed.templateId,
        bodySource,
        recipientType: 'individual',
        idempotencyKey: randomUUID(),
        createdBy: req.admin!.id,
      })
      .returning();

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.get('/:id', requireAuth, requireMessagingManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const campaign = await loadDraft(id);
    if (!campaign) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '초안을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    const media = await db.select().from(messageCampaignMedia).where(eq(messageCampaignMedia.campaignId, id));
    res.json({ data: { ...campaign, media }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/:id/recipients', requireAuth, requireMessagingManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const parsed = parseBody(recipientsSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const campaign = await loadDraft(id);
    if (!campaign) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '초안을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const [updated] = await db
      .update(messageCampaigns)
      .set({ recipientType: parsed.recipientType, filterSnapshot: parsed.filter, duplicateStrategy: parsed.duplicateStrategy, updatedAt: new Date() })
      .where(eq(messageCampaigns.id, id))
      .returning();

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/recipient-preview', requireAuth, requireMessagingManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const campaign = await loadDraft(id);
    if (!campaign) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '초안을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const resolved = await resolveRecipients(
      campaign.recipientType as RecipientType,
      campaign.filterSnapshot as RecipientFilter,
      campaign.duplicateStrategy as DuplicateStrategy,
      campaign.bodySource,
      false
    );

    const includedCount = resolved.filter((r) => r.status === 'included').length;
    const optOutCount = resolved.filter((r) => r.isOptedOut).length;

    res.json({
      data: {
        totalCandidates: resolved.length,
        includedCount,
        excludedCount: resolved.length - includedCount,
        optOutCount,
        sample: resolved.slice(0, 10),
      },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.patch('/:id/content', requireAuth, requireMessagingManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const parsed = parseBody(contentSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const campaign = await loadDraft(id);
    if (!campaign) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '초안을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const [updated] = await db
      .update(messageCampaigns)
      .set({ bodySource: parsed.bodySource, updatedAt: new Date() })
      .where(eq(messageCampaigns.id, id))
      .returning();

    await db.delete(messageCampaignMedia).where(eq(messageCampaignMedia.campaignId, id));
    if (parsed.mediaIds.length > 0) {
      await db.insert(messageCampaignMedia).values(parsed.mediaIds.map((mediaId, index) => ({ campaignId: id, mediaId, sortOrder: index })));
    }

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/render-preview', requireAuth, requireMessagingManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const campaign = await loadDraft(id);
    if (!campaign) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '초안을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const resolved = await resolveRecipients(
      campaign.recipientType as RecipientType,
      campaign.filterSnapshot as RecipientFilter,
      campaign.duplicateStrategy as DuplicateStrategy,
      campaign.bodySource,
      false
    );
    const sample = resolved.find((r) => r.status === 'included') ?? null;
    const renderedBody = sample ? sample.renderedBody : campaign.bodySource;

    res.json({
      data: { renderedBody, messageKind: classifyMessageLength(renderedBody), hasSample: sample !== null },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.post('/:id/validate', requireAuth, requireMessagingManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const campaign = await loadDraft(id);
    if (!campaign) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '초안을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const resolved = await resolveRecipients(
      campaign.recipientType as RecipientType,
      campaign.filterSnapshot as RecipientFilter,
      campaign.duplicateStrategy as DuplicateStrategy,
      campaign.bodySource,
      false
    );
    const includedCount = resolved.filter((r) => r.status === 'included').length;
    const optOutCount = resolved.filter((r) => r.isOptedOut).length;
    const media = await db.select().from(messageCampaignMedia).where(eq(messageCampaignMedia.campaignId, id));
    const sendItemsPerCampaign = includedCount * Math.max(media.length, 1);

    res.json({
      data: {
        includedCount,
        optOutCount,
        estimatedSendItems: sendItemsPerCampaign,
        hasContent: campaign.bodySource.trim().length > 0,
        readyToApprove: includedCount > 0 && campaign.bodySource.trim().length > 0,
      },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.post('/:id/approve', requireAuth, requireMessagingManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const parsed = parseBody(approveSchema, req.body, res, req.requestId);
    if (!parsed) return;
    if (parsed.sendMode === 'scheduled' && !parsed.scheduledAt) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: '예약 발송에는 예약시각이 필요합니다.', fieldErrors: { scheduledAt: ['필수 항목입니다.'] }, requestId: req.requestId },
      });
      return;
    }

    const campaign = await loadDraft(id);
    if (!campaign) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '초안을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    if (campaign.status !== 'draft') {
      res.status(409).json({ error: { code: 'CAMPAIGN_CHANGED', message: '이미 승인되었거나 처리 중인 초안입니다.', requestId: req.requestId } });
      return;
    }

    const resolved = await resolveRecipients(
      campaign.recipientType as RecipientType,
      campaign.filterSnapshot as RecipientFilter,
      campaign.duplicateStrategy as DuplicateStrategy,
      campaign.bodySource,
      parsed.confirmOptOutOverride
    );
    const included = resolved.filter((r) => r.status === 'included');
    const optOutCount = resolved.filter((r) => r.isOptedOut).length;
    if (optOutCount > 0 && !parsed.confirmOptOutOverride) {
      res.status(409).json({
        error: {
          code: 'OPT_OUT_RECIPIENTS',
          message: `수신거부자 ${optOutCount}명이 대상에 포함되어 있습니다. 계속하려면 확인이 필요합니다.`,
          requestId: req.requestId,
        },
        data: { optOutCount },
      });
      return;
    }
    if (included.length === 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '발송 대상이 없습니다.', requestId: req.requestId } });
      return;
    }

    const media = await db.select().from(messageCampaignMedia).where(eq(messageCampaignMedia.campaignId, id)).orderBy(messageCampaignMedia.sortOrder);
    const itemsPerRecipient = Math.max(media.length, 1);
    const totalSendItems = included.length * itemsPerRecipient;

    const todayStart = new Date(`${getTodayKST()}T00:00:00+09:00`);
    const [todayUsage] = await db
      .select({ total: sql<number>`coalesce(sum(${messageCampaigns.totalSendItems}), 0)` })
      .from(messageCampaigns)
      .where(and(gte(messageCampaigns.approvedAt, todayStart), sql`${messageCampaigns.status} not in ('canceled', 'failed')`));
    const todaySendItems = Number(todayUsage?.total ?? 0);
    if (todaySendItems + totalSendItems > DAILY_SEND_ITEM_LIMIT) {
      res.status(409).json({
        error: {
          code: 'DAILY_LIMIT_EXCEEDED',
          message: `오늘 발송 가능한 최대 건수(${DAILY_SEND_ITEM_LIMIT}건)를 초과합니다. 오늘 이미 ${todaySendItems}건이 발송 예정입니다.`,
          requestId: req.requestId,
        },
      });
      return;
    }

    const now = new Date();
    const nextStatus = parsed.sendMode === 'immediate' ? 'queued' : 'scheduled';

    const updated = await db.transaction(async (tx) => {
      const [campaignRow] = await tx
        .update(messageCampaigns)
        .set({
          status: nextStatus,
          sendMode: parsed.sendMode,
          scheduledAt: parsed.scheduledAt ? new Date(parsed.scheduledAt) : null,
          deviceId: parsed.deviceId,
          optOutOverrideConfirmed: parsed.confirmOptOutOverride,
          approvedBy: req.admin!.id,
          approvedAt: now,
          totalStudents: new Set(included.flatMap((r) => r.studentIds)).size,
          totalContacts: included.length,
          totalSendItems,
          excludedCount: resolved.length - included.length,
          updatedAt: now,
        })
        .where(eq(messageCampaigns.id, id))
        .returning();

      for (const recipient of included) {
        const [recipientRow] = await tx
          .insert(messageRecipients)
          .values({
            campaignId: id,
            studentId: recipient.studentIds[0] ?? null,
            guardianId: recipient.guardianId,
            phoneNormalized: recipient.phoneNormalized,
            relationshipSnapshot: recipient.relationshipSnapshot,
            personalizationSnapshot: { studentNames: recipient.studentNames },
            renderedBody: recipient.renderedBody,
            status: 'included',
          })
          .returning();

        if (media.length === 0) {
          await tx.insert(messageSendItems).values({ campaignId: id, recipientId: recipientRow!.id, sequenceNo: 0, idempotencyKey: randomUUID() });
        } else {
          await tx.insert(messageSendItems).values(
            media.map((m, index) => ({
              campaignId: id,
              recipientId: recipientRow!.id,
              mediaId: m.mediaId,
              sequenceNo: index,
              idempotencyKey: randomUUID(),
            }))
          );
        }
      }

      return campaignRow;
    });

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'messageCampaign.approve',
      targetType: 'messageCampaign',
      targetId: id,
      beforeDataSafe: { status: campaign.status },
      afterDataSafe: { status: updated!.status, totalContacts: updated!.totalContacts, optOutOverrideConfirmed: parsed.confirmOptOutOverride },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
