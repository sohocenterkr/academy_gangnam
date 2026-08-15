import { and, eq, isNull } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS, SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { db } from '../db';
import { admins, roles } from '@shared/schema';
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
  expectedUpdatedAt: z.string(),
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

    if (
      parsed.permissions.includes(SUPER_ADMIN_WILDCARD_PERMISSION) &&
      !req.admin!.permissions.includes(SUPER_ADMIN_WILDCARD_PERMISSION)
    ) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: '최고관리자 권한을 부여할 권한이 없습니다.',
          requestId: req.requestId,
        },
      });
      return;
    }

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

    if (before.isSystem) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: '시스템 역할은 수정할 수 없습니다.', requestId: req.requestId },
      });
      return;
    }

    if (before.updatedAt.toISOString() !== parsed.expectedUpdatedAt) {
      res.status(409).json({
        error: { code: 'VERSION_CONFLICT', message: '다른 곳에서 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.', requestId: req.requestId },
      });
      return;
    }

    if (
      parsed.permissions !== undefined &&
      parsed.permissions.includes(SUPER_ADMIN_WILDCARD_PERMISSION) &&
      !req.admin!.permissions.includes(SUPER_ADMIN_WILDCARD_PERMISSION)
    ) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: '최고관리자 권한을 부여할 권한이 없습니다.',
          requestId: req.requestId,
        },
      });
      return;
    }

    const removingWildcard =
      parsed.permissions !== undefined &&
      before.permissions.includes(SUPER_ADMIN_WILDCARD_PERMISSION) &&
      !parsed.permissions.includes(SUPER_ADMIN_WILDCARD_PERMISSION);

    if (removingWildcard) {
      const activeAdminsUnderThisRole = await db
        .select({ id: admins.id })
        .from(admins)
        .where(and(eq(admins.roleId, before.id), eq(admins.status, 'active'), isNull(admins.deletedAt)));

      if (activeAdminsUnderThisRole.length > 0) {
        res.status(409).json({
          error: {
            code: 'LAST_SUPER_ADMIN',
            message: '마지막 최고관리자 권한을 제거할 수 없습니다.',
            requestId: req.requestId,
          },
        });
        return;
      }
    }

    const { expectedUpdatedAt: _expected, ...changes } = parsed;
    const [updated] = await db
      .update(roles)
      .set({ ...changes, updatedAt: new Date() })
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
