import { and, eq, gte, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString, getTodayKST } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { messageCampaigns, messageRecipients, messageSendItems } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';
import { dispatchCampaign, type DispatchDeps } from '../services/messageDispatch';

const scheduleSchema = z.object({ scheduledAt: z.iso.datetime() });

export interface MessageCampaignsRouterDeps {
  sessionSecret: string;
  dispatch: DispatchDeps;
}

export function createMessageCampaignsRouter(deps: MessageCampaignsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireMessagingManage = createRequirePermission(PERMISSIONS.MESSAGING_MANAGE);

  router.get('/', requireAuth, requireMessagingManage, async (req, res) => {
    const rows = await db.select().from(messageCampaigns).orderBy(sql`${messageCampaigns.createdAt} desc`);
    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.get('/:id', requireAuth, requireMessagingManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const [campaign] = await db.select().from(messageCampaigns).where(eq(messageCampaigns.id, id));
    if (!campaign) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '작업을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    res.json({ data: campaign, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.get('/:id/recipients', requireAuth, requireMessagingManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const rows = await db.select().from(messageRecipients).where(eq(messageRecipients.campaignId, id));
    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/dispatch', requireAuth, requireMessagingManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    let outcome;
    try {
      outcome = await dispatchCampaign(id, deps.dispatch);
    } catch (error) {
      const message = error instanceof Error ? error.message : '발송 처리 중 오류가 발생했습니다.';
      res.status(502).json({ error: { code: 'DISPATCH_FAILED', message, requestId: req.requestId } });
      return;
    }
    if (outcome.status === 'not_found') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '작업을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    if (outcome.status === 'not_ready') {
      res.status(409).json({
        error: { code: 'CAMPAIGN_CHANGED', message: `발송 대기 상태가 아닙니다 (현재: ${outcome.campaignStatus}).`, requestId: req.requestId },
      });
      return;
    }

    const [updated] = await db.select().from(messageCampaigns).where(eq(messageCampaigns.id, id));

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'messageCampaign.dispatch',
      targetType: 'messageCampaign',
      targetId: id,
      beforeDataSafe: null,
      afterDataSafe: { status: updated?.status, failedCount: updated?.failedCount },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/cancel', requireAuth, requireMessagingManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const [campaign] = await db.select().from(messageCampaigns).where(eq(messageCampaigns.id, id));
    if (!campaign) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '작업을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    if (!['draft', 'ready', 'scheduled', 'queued'].includes(campaign.status)) {
      res.status(409).json({
        error: { code: 'CAMPAIGN_CHANGED', message: '이미 처리가 시작되어 취소할 수 없습니다.', requestId: req.requestId },
      });
      return;
    }

    const [updated] = await db
      .update(messageCampaigns)
      .set({ status: 'canceled', finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(messageCampaigns.id, id))
      .returning();

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'messageCampaign.cancel',
      targetType: 'messageCampaign',
      targetId: id,
      beforeDataSafe: { status: campaign.status },
      afterDataSafe: { status: 'canceled' },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/:id/schedule', requireAuth, requireMessagingManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const parsed = parseBody(scheduleSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [campaign] = await db.select().from(messageCampaigns).where(eq(messageCampaigns.id, id));
    if (!campaign) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '작업을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    if (campaign.status !== 'scheduled') {
      res.status(409).json({ error: { code: 'CAMPAIGN_CHANGED', message: '예약 상태가 아닙니다.', requestId: req.requestId } });
      return;
    }

    const [updated] = await db
      .update(messageCampaigns)
      .set({ scheduledAt: new Date(parsed.scheduledAt), updatedAt: new Date() })
      .where(eq(messageCampaigns.id, id))
      .returning();

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/retry', requireAuth, requireMessagingManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const [campaign] = await db.select().from(messageCampaigns).where(eq(messageCampaigns.id, id));
    if (!campaign) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '작업을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    if (!['partial', 'failed'].includes(campaign.status)) {
      res.status(409).json({ error: { code: 'CAMPAIGN_CHANGED', message: '재발송할 실패 건이 없습니다.', requestId: req.requestId } });
      return;
    }

    const failedRecipients = await db
      .select()
      .from(messageRecipients)
      .where(and(eq(messageRecipients.campaignId, id), eq(messageRecipients.status, 'request_failed')));
    const failedRecipientIds = failedRecipients.map((r) => r.id);

    for (const recipientId of failedRecipientIds) {
      await db.update(messageRecipients).set({ status: 'pending', updatedAt: new Date() }).where(eq(messageRecipients.id, recipientId));
      await db
        .update(messageSendItems)
        .set({ status: 'pending', requestedAt: null, completedAt: null, lastErrorCode: null, lastErrorMessageSafe: null })
        .where(and(eq(messageSendItems.recipientId, recipientId), eq(messageSendItems.status, 'request_failed')));
    }

    const [updated] = await db
      .update(messageCampaigns)
      .set({ status: 'queued', updatedAt: new Date() })
      .where(eq(messageCampaigns.id, id))
      .returning();

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'messageCampaign.retry',
      targetType: 'messageCampaign',
      targetId: id,
      beforeDataSafe: { status: campaign.status },
      afterDataSafe: { status: 'queued', retryCount: failedRecipientIds.length },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}

export interface MessageUsageRouterDeps {
  sessionSecret: string;
}

export function createMessageUsageRouter(deps: MessageUsageRouterDeps) {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireMessagingManage = createRequirePermission(PERMISSIONS.MESSAGING_MANAGE);

  router.get('/', requireAuth, requireMessagingManage, async (req, res) => {
    const todayStart = new Date(`${getTodayKST()}T00:00:00+09:00`);
    const [todayUsage] = await db
      .select({ total: sql<number>`coalesce(sum(${messageCampaigns.totalSendItems}), 0)` })
      .from(messageCampaigns)
      .where(and(gte(messageCampaigns.approvedAt, todayStart), sql`${messageCampaigns.status} not in ('canceled', 'failed')`));

    res.json({
      data: { todaySendItems: Number(todayUsage?.total ?? 0), dailyLimit: 500 },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  return router;
}
