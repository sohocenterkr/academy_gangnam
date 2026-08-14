import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { roles } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';

const createRoleSchema = z.object({
  name: z.string().min(1),
  permissions: z.array(z.string()),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).optional(),
  permissions: z.array(z.string()).optional(),
});

export interface RolesRouterDeps {
  sessionSecret: string;
}

export function createRolesRouter(deps: RolesRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireRolesManage = createRequirePermission(PERMISSIONS.ROLES_MANAGE);

  router.get('/', requireAuth, requireRolesManage, async (req, res) => {
    const rows = await db.select().from(roles);
    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/', requireAuth, requireRolesManage, async (req, res) => {
    const parsed = parseBody(createRoleSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [created] = await db
      .insert(roles)
      .values({ name: parsed.name, permissions: parsed.permissions })
      .returning();
    if (!created) {
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: '역할을 생성하지 못했습니다.', requestId: req.requestId },
      });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'role.create',
      targetType: 'role',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { name: created.name, permissions: created.permissions },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/:id', requireAuth, requireRolesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateRoleSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(roles).where(eq(roles.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '역할을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const [updated] = await db
      .update(roles)
      .set({ ...parsed, updatedAt: new Date() })
      .where(eq(roles.id, id))
      .returning();
    if (!updated) {
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: '역할을 수정하지 못했습니다.', requestId: req.requestId },
      });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'role.update',
      targetType: 'role',
      targetId: updated.id,
      beforeDataSafe: { name: before.name, permissions: before.permissions },
      afterDataSafe: { name: updated.name, permissions: updated.permissions },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
