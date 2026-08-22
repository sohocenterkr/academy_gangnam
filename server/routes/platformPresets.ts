import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { platformPresets } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';
import { isForeignKeyViolation } from '../utils/httpErrors';

const safeAreaSchema = z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() });

const createSchema = z.object({
  platform: z.string().min(1),
  postType: z.string().min(1),
  name: z.string().min(1),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  safeArea: safeAreaSchema.optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  widthPx: z.number().int().positive().optional(),
  heightPx: z.number().int().positive().optional(),
  safeArea: safeAreaSchema.optional(),
  isActive: z.boolean().optional(),
  expectedUpdatedAt: z.iso.datetime(),
});

export interface PlatformPresetsRouterDeps {
  sessionSecret: string;
}

export function createPlatformPresetsRouter(deps: PlatformPresetsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireCardNewsManage = createRequirePermission(PERMISSIONS.CARD_NEWS_MANAGE);

  router.get('/', requireAuth, requireCardNewsManage, async (req, res) => {
    const rows = await db.select().from(platformPresets).where(eq(platformPresets.isActive, true)).orderBy(platformPresets.platform);
    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/', requireAuth, requireCardNewsManage, async (req, res) => {
    const parsed = parseBody(createSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const now = new Date();
    const [created] = await db
      .insert(platformPresets)
      .values({ ...parsed, createdAt: now, updatedAt: now, createdBy: req.admin!.id, updatedBy: req.admin!.id })
      .returning();

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'platformPreset.create',
      targetType: 'platformPreset',
      targetId: created!.id,
      beforeDataSafe: null,
      afterDataSafe: { platform: created!.platform, postType: created!.postType, name: created!.name },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/:id', requireAuth, requireCardNewsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const parsed = parseBody(updateSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(platformPresets).where(eq(platformPresets.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '프리셋을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const { expectedUpdatedAt, ...changes } = parsed;

    const [updated] = await db
      .update(platformPresets)
      .set({ ...changes, updatedAt: new Date(), updatedBy: req.admin!.id })
      .where(and(eq(platformPresets.id, id), eq(platformPresets.updatedAt, new Date(expectedUpdatedAt))))
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
      action: 'platformPreset.update',
      targetType: 'platformPreset',
      targetId: id,
      beforeDataSafe: { name: before.name, widthPx: before.widthPx, heightPx: before.heightPx, isActive: before.isActive },
      afterDataSafe: changes,
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.delete('/:id', requireAuth, requireCardNewsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const [existing] = await db.select().from(platformPresets).where(eq(platformPresets.id, id));
    if (!existing) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '프리셋을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    try {
      await db.delete(platformPresets).where(eq(platformPresets.id, id));
    } catch (error) {
      if (!isForeignKeyViolation(error)) throw error;
      await db
        .update(platformPresets)
        .set({ isActive: false, updatedAt: new Date(), updatedBy: req.admin!.id })
        .where(eq(platformPresets.id, id));
      res.json({
        data: { id, status: 'deactivated' },
        meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
      });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'platformPreset.delete',
      targetType: 'platformPreset',
      targetId: id,
      beforeDataSafe: { name: existing.name },
      afterDataSafe: null,
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: { id, status: 'deleted' }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
