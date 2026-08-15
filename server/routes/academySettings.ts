import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { academySettings } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';

const DEFAULT_ACADEMY_NAME = '학원';

const updateAcademySettingsSchema = z.object({
  academyName: z.string().min(1).optional(),
  phoneNormalized: z.string().optional(),
  address: z.string().optional(),
  senderName: z.string().optional(),
  expectedUpdatedAt: z.string(),
});

async function getOrCreateAcademySettings() {
  const [existing] = await db.select().from(academySettings).limit(1);
  if (existing) return existing;

  const [created] = await db.insert(academySettings).values({ academyName: DEFAULT_ACADEMY_NAME }).returning();
  if (!created) {
    throw new Error('Failed to create the default academy settings row.');
  }
  return created;
}

export interface AcademySettingsRouterDeps {
  sessionSecret: string;
}

export function createAcademySettingsRouter(deps: AcademySettingsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireAcademyManage = createRequirePermission(PERMISSIONS.ACADEMY_MANAGE);

  router.get('/', requireAuth, requireAcademyManage, async (req, res) => {
    const settings = await getOrCreateAcademySettings();
    res.json({ data: settings, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/', requireAuth, requireAcademyManage, async (req, res) => {
    const parsed = parseBody(updateAcademySettingsSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const settings = await getOrCreateAcademySettings();
    if (settings.updatedAt.toISOString() !== parsed.expectedUpdatedAt) {
      res.status(409).json({
        error: { code: 'VERSION_CONFLICT', message: '다른 곳에서 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.', requestId: req.requestId },
      });
      return;
    }

    const { expectedUpdatedAt: _expected, ...changes } = parsed;

    const [updated] = await db
      .update(academySettings)
      .set({ ...changes, updatedBy: req.admin!.id, updatedAt: new Date() })
      .where(eq(academySettings.id, settings.id))
      .returning();
    if (!updated) {
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: '설정을 저장하지 못했습니다.', requestId: req.requestId },
      });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'academySettings.update',
      targetType: 'academySettings',
      targetId: updated.id,
      beforeDataSafe: { academyName: settings.academyName, phoneNormalized: settings.phoneNormalized },
      afterDataSafe: { academyName: updated.academyName, phoneNormalized: updated.phoneNormalized },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
