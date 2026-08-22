import { and, eq, isNull } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { cardNewsProjects, cardNewsMedia, cardNewsCards, aiGenerationLogs, mediaAssets, platformPresets } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';
import type { OpenAIClient } from '../services/openaiCardNews';

const PROJECT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const createSchema = z.object({
  name: z.string().min(1),
  presetId: z.string().min(1),
  title: z.string().optional(),
  story: z.string().optional(),
  eventDate: z.string().optional(),
  relatedCourseId: z.string().optional(),
  relatedStudentId: z.string().optional(),
  studentNameDisplayMode: z.enum(['full', 'masked', 'hidden']).optional(),
  hashtags: z.array(z.string()).optional(),
  showAcademyInfo: z.boolean().optional(),
});

const updateSchema = z.object({
  title: z.string().optional(),
  story: z.string().optional(),
  eventDate: z.string().optional(),
  studentNameDisplayMode: z.enum(['full', 'masked', 'hidden']).optional(),
  hashtags: z.array(z.string()).optional(),
  showAcademyInfo: z.boolean().optional(),
  aiProvider: z.string().optional(),
  aiModel: z.string().optional(),
  sendPhotosToAi: z.boolean().optional(),
  // Required only when turning sendPhotosToAi on — the admin must explicitly confirm no PII is
  // exposed before any photo is sent to an external AI provider (spec §13.7 step 4).
  privacyConfirmed: z.boolean().optional(),
  expectedUpdatedAt: z.iso.datetime(),
});

const addMediaSchema = z.object({
  mediaId: z.string().min(1),
  role: z.enum(['source', 'background', 'logo', 'output']),
  sortOrder: z.number().int().optional(),
});

const generateSchema = z.object({
  cardCount: z.number().int().min(1).max(10).default(3),
});

const saveCardsSchema = z.object({
  cards: z.array(z.object({ title: z.string().optional(), body: z.string().optional(), layoutJson: z.unknown().optional() })).min(1),
});

// Rough per-card token estimate used only to show a cost figure before generating — see
// services/openaiCardNews.ts for why this can't be billing-accurate.
const ESTIMATED_TOKENS_PER_CARD = { prompt: 300, completion: 150 };
const ESTIMATED_TOKENS_PER_PHOTO = 400;
const PRICE_PER_MILLION_TOKENS = { input: 0.15, output: 0.6 };

export interface CardNewsRouterDeps {
  sessionSecret: string;
  openai?: OpenAIClient;
}

export function createCardNewsRouter(deps: CardNewsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireCardNewsManage = createRequirePermission(PERMISSIONS.CARD_NEWS_MANAGE);

  router.get('/', requireAuth, requireCardNewsManage, async (req, res) => {
    const rows = await db.select().from(cardNewsProjects).where(isNull(cardNewsProjects.deletedAt)).orderBy(cardNewsProjects.createdAt);
    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/', requireAuth, requireCardNewsManage, async (req, res) => {
    const parsed = parseBody(createSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [preset] = await db.select().from(platformPresets).where(and(eq(platformPresets.id, parsed.presetId), eq(platformPresets.isActive, true)));
    if (!preset) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: '입력값을 확인해 주세요.', fieldErrors: { presetId: ['사용할 수 없는 프리셋입니다.'] }, requestId: req.requestId },
      });
      return;
    }

    const now = new Date();
    const [created] = await db
      .insert(cardNewsProjects)
      .values({
        ...parsed,
        hashtags: parsed.hashtags ?? [],
        status: 'draft',
        expiresAt: new Date(now.getTime() + PROJECT_TTL_MS),
        createdAt: now,
        updatedAt: now,
        createdBy: req.admin!.id,
        updatedBy: req.admin!.id,
      })
      .returning();

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'cardNewsProject.create',
      targetType: 'cardNewsProject',
      targetId: created!.id,
      beforeDataSafe: null,
      afterDataSafe: { name: created!.name, presetId: created!.presetId },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.get('/:id', requireAuth, requireCardNewsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const [project] = await db.select().from(cardNewsProjects).where(and(eq(cardNewsProjects.id, id), isNull(cardNewsProjects.deletedAt)));
    if (!project) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const media = await db
      .select({
        id: cardNewsMedia.id,
        mediaId: cardNewsMedia.mediaId,
        role: cardNewsMedia.role,
        sortOrder: cardNewsMedia.sortOrder,
        secureUrl: mediaAssets.secureUrl,
        resourceType: mediaAssets.resourceType,
      })
      .from(cardNewsMedia)
      .innerJoin(mediaAssets, eq(cardNewsMedia.mediaId, mediaAssets.id))
      .where(eq(cardNewsMedia.projectId, id))
      .orderBy(cardNewsMedia.sortOrder);

    const cards = await db.select().from(cardNewsCards).where(eq(cardNewsCards.projectId, id)).orderBy(cardNewsCards.sortOrder);

    res.json({ data: { ...project, media, cards }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/:id', requireAuth, requireCardNewsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const parsed = parseBody(updateSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(cardNewsProjects).where(and(eq(cardNewsProjects.id, id), isNull(cardNewsProjects.deletedAt)));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    if (parsed.sendPhotosToAi === true && !parsed.privacyConfirmed) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: '사진을 AI에 전달하려면 개인정보 확인에 먼저 동의해야 합니다.',
          fieldErrors: { privacyConfirmed: ['필수 확인 항목입니다.'] },
          requestId: req.requestId,
        },
      });
      return;
    }

    const { expectedUpdatedAt, privacyConfirmed: _privacyConfirmed, ...changes } = parsed;
    const now = new Date();

    const [updated] = await db
      .update(cardNewsProjects)
      .set({
        ...changes,
        ...(parsed.sendPhotosToAi === true ? { privacyConfirmedBy: req.admin!.id, privacyConfirmedAt: now } : {}),
        ...(parsed.sendPhotosToAi === false ? { privacyConfirmedBy: null, privacyConfirmedAt: null } : {}),
        updatedAt: now,
        updatedBy: req.admin!.id,
      })
      .where(and(eq(cardNewsProjects.id, id), eq(cardNewsProjects.updatedAt, new Date(expectedUpdatedAt))))
      .returning();
    if (!updated) {
      res.status(409).json({
        error: { code: 'VERSION_CONFLICT', message: '다른 곳에서 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.', requestId: req.requestId },
      });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'cardNewsProject.update',
      targetType: 'cardNewsProject',
      targetId: id,
      beforeDataSafe: { title: before.title, sendPhotosToAi: before.sendPhotosToAi },
      afterDataSafe: { title: updated.title, sendPhotosToAi: updated.sendPhotosToAi },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/media', requireAuth, requireCardNewsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const parsed = parseBody(addMediaSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [project] = await db.select().from(cardNewsProjects).where(and(eq(cardNewsProjects.id, id), isNull(cardNewsProjects.deletedAt)));
    if (!project) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const [media] = await db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, parsed.mediaId), eq(mediaAssets.status, 'active')));
    if (!media) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '연결할 파일을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const [linked] = await db
      .insert(cardNewsMedia)
      .values({ projectId: id, mediaId: parsed.mediaId, role: parsed.role, sortOrder: parsed.sortOrder ?? 0 })
      .returning();

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'cardNewsProject.mediaLink',
      targetType: 'cardNewsProject',
      targetId: id,
      beforeDataSafe: null,
      afterDataSafe: { mediaId: parsed.mediaId, role: parsed.role },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: linked, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.delete('/:id/media/:mediaId', requireAuth, requireCardNewsManage, async (req, res) => {
    const { id, mediaId } = req.params;
    if (!id || Array.isArray(id) || !mediaId || Array.isArray(mediaId)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [deleted] = await db
      .delete(cardNewsMedia)
      .where(and(eq(cardNewsMedia.projectId, id), eq(cardNewsMedia.mediaId, mediaId)))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '연결된 파일을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'cardNewsProject.mediaUnlink',
      targetType: 'cardNewsProject',
      targetId: id,
      beforeDataSafe: { mediaId },
      afterDataSafe: null,
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: { success: true }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/cost-estimate', requireAuth, requireCardNewsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const parsed = parseBody(generateSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [project] = await db.select().from(cardNewsProjects).where(and(eq(cardNewsProjects.id, id), isNull(cardNewsProjects.deletedAt)));
    if (!project) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const photoCount = project.sendPhotosToAi
      ? (await db.select().from(cardNewsMedia).where(and(eq(cardNewsMedia.projectId, id), eq(cardNewsMedia.role, 'source')))).length
      : 0;
    const promptTokens = ESTIMATED_TOKENS_PER_CARD.prompt * parsed.cardCount + ESTIMATED_TOKENS_PER_PHOTO * photoCount;
    const completionTokens = ESTIMATED_TOKENS_PER_CARD.completion * parsed.cardCount;
    const estimatedCostUsd =
      (promptTokens / 1_000_000) * PRICE_PER_MILLION_TOKENS.input + (completionTokens / 1_000_000) * PRICE_PER_MILLION_TOKENS.output;

    res.json({
      data: { cardCount: parsed.cardCount, photoCount, estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)) },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.post('/:id/generate', requireAuth, requireCardNewsManage, async (req, res) => {
    if (!deps.openai) {
      res.status(503).json({ error: { code: 'AI_NOT_CONFIGURED', message: 'AI 공급자가 설정되지 않았습니다.', requestId: req.requestId } });
      return;
    }
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const parsed = parseBody(generateSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [project] = await db.select().from(cardNewsProjects).where(and(eq(cardNewsProjects.id, id), isNull(cardNewsProjects.deletedAt)));
    if (!project) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    let photoUrls: string[] = [];
    if (project.sendPhotosToAi) {
      if (!project.privacyConfirmedAt) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: '사진 전달 개인정보 확인이 되어 있지 않습니다.', requestId: req.requestId },
        });
        return;
      }
      const sourceMedia = await db
        .select({ secureUrl: mediaAssets.secureUrl, resourceType: mediaAssets.resourceType })
        .from(cardNewsMedia)
        .innerJoin(mediaAssets, eq(cardNewsMedia.mediaId, mediaAssets.id))
        .where(and(eq(cardNewsMedia.projectId, id), eq(cardNewsMedia.role, 'source')));
      photoUrls = sourceMedia.filter((m) => m.resourceType === 'image').map((m) => m.secureUrl);
    }

    await db.update(cardNewsProjects).set({ status: 'generating', updatedAt: new Date() }).where(eq(cardNewsProjects.id, id));

    let result;
    try {
      result = await deps.openai.generateCardNewsCopy({
        title: project.title,
        story: project.story,
        hashtags: project.hashtags,
        cardCount: parsed.cardCount,
        photoUrls,
      });
    } catch {
      await db.update(cardNewsProjects).set({ status: 'partial_error', updatedAt: new Date() }).where(eq(cardNewsProjects.id, id));
      await db.insert(aiGenerationLogs).values({
        projectId: id,
        provider: 'openai',
        model: 'gpt-4o-mini',
        photosSent: photoUrls.length,
        inputSummarySafe: `카드 ${parsed.cardCount}장 생성 요청`,
        status: 'failed',
        errorCode: 'OPENAI_REQUEST_FAILED',
        createdBy: req.admin!.id,
      });
      res.status(502).json({
        error: { code: 'AI_GENERATION_FAILED', message: 'AI 생성에 실패했습니다.', requestId: req.requestId },
      });
      return;
    }

    await db.delete(cardNewsCards).where(eq(cardNewsCards.projectId, id));
    const insertedCards =
      result.cards.length > 0
        ? await db
            .insert(cardNewsCards)
            .values(
              result.cards.map((card, index) => ({
                projectId: id,
                sortOrder: index,
                title: card.title,
                body: card.body,
                status: 'draft' as const,
                createdBy: req.admin!.id,
                updatedBy: req.admin!.id,
              }))
            )
            .returning()
        : [];

    const estimatedCostCents = Math.round(result.estimatedCostUsd * 100);
    await db
      .update(cardNewsProjects)
      .set({
        status: 'editing',
        aiProvider: 'openai',
        aiModel: result.model,
        actualUsage: { promptTokens: result.promptTokens, completionTokens: result.completionTokens },
        estimatedCost: estimatedCostCents,
        updatedAt: new Date(),
      })
      .where(eq(cardNewsProjects.id, id));

    await db.insert(aiGenerationLogs).values({
      projectId: id,
      provider: 'openai',
      model: result.model,
      photosSent: photoUrls.length,
      inputSummarySafe: `카드 ${parsed.cardCount}장 생성`,
      outputJson: { cards: result.cards },
      usageJson: { promptTokens: result.promptTokens, completionTokens: result.completionTokens },
      estimatedCost: estimatedCostCents,
      actualCost: estimatedCostCents,
      status: 'success',
      createdBy: req.admin!.id,
    });

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'cardNewsProject.generate',
      targetType: 'cardNewsProject',
      targetId: id,
      beforeDataSafe: null,
      afterDataSafe: { cardCount: insertedCards.length, photosSent: photoUrls.length },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: { cards: insertedCards, estimatedCostUsd: result.estimatedCostUsd }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.put('/:id/cards', requireAuth, requireCardNewsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const parsed = parseBody(saveCardsSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [project] = await db.select().from(cardNewsProjects).where(and(eq(cardNewsProjects.id, id), isNull(cardNewsProjects.deletedAt)));
    if (!project) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    await db.delete(cardNewsCards).where(eq(cardNewsCards.projectId, id));
    const saved = await db
      .insert(cardNewsCards)
      .values(
        parsed.cards.map((card, index) => ({
          projectId: id,
          sortOrder: index,
          title: card.title,
          body: card.body,
          layoutJson: card.layoutJson,
          status: 'ready' as const,
          createdBy: req.admin!.id,
          updatedBy: req.admin!.id,
        }))
      )
      .returning();

    res.json({ data: saved, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.delete('/:id', requireAuth, requireCardNewsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const [before] = await db.select().from(cardNewsProjects).where(and(eq(cardNewsProjects.id, id), isNull(cardNewsProjects.deletedAt)));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    await db
      .update(cardNewsProjects)
      .set({ status: 'deleted', deletedAt: new Date(), updatedAt: new Date(), updatedBy: req.admin!.id })
      .where(eq(cardNewsProjects.id, id));

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'cardNewsProject.delete',
      targetType: 'cardNewsProject',
      targetId: id,
      beforeDataSafe: { name: before.name },
      afterDataSafe: null,
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: { id, status: 'deleted' }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
