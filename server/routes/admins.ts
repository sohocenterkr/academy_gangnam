import { and, eq, isNull, ne } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS, SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { db } from '../db';
import { admins, roles } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';
import { revokeAllSessionsForAdmin } from '../services/session';
import { requestPasswordReset } from '../services/passwordReset';
import type { EmailAdapter } from '../services/email';

const createAdminSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  roleId: z.string().uuid(),
});

const updateAdminSchema = z.object({
  name: z.string().min(1).optional(),
  roleId: z.string().uuid().optional(),
  status: z.enum(['active', 'inactive', 'locked']).optional(),
  expectedUpdatedAt: z.string(),
});

function toSafeAdmin(admin: typeof admins.$inferSelect) {
  const { passwordHash: _passwordHash, ...safe } = admin;
  return safe;
}

async function isLastActiveSuperAdmin(adminId: string, roleId: string): Promise<boolean> {
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId));
  if (!role || !role.permissions.includes(SUPER_ADMIN_WILDCARD_PERMISSION)) {
    return false;
  }

  const otherActiveSuperAdmins = await db
    .select({ id: admins.id })
    .from(admins)
    .where(and(eq(admins.roleId, roleId), eq(admins.status, 'active'), ne(admins.id, adminId), isNull(admins.deletedAt)));

  return otherActiveSuperAdmins.length === 0;
}

export interface AdminsRouterDeps {
  sessionSecret: string;
  appUrl: string;
  emailAdapter: EmailAdapter;
}

export function createAdminsRouter(deps: AdminsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireAdminsManage = createRequirePermission(PERMISSIONS.ADMINS_MANAGE);

  router.get('/', requireAuth, requireAdminsManage, async (req, res) => {
    const rows = await db.select().from(admins).where(isNull(admins.deletedAt));
    res.json({
      data: rows.map(toSafeAdmin),
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.post('/', requireAuth, requireAdminsManage, async (req, res) => {
    const parsed = parseBody(createAdminSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const passwordHash = await hashPassword(parsed.password);
    const [created] = await db
      .insert(admins)
      .values({ email: parsed.email, name: parsed.name, passwordHash, roleId: parsed.roleId, status: 'active' })
      .returning();
    if (!created) {
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: '관리자를 생성하지 못했습니다.', requestId: req.requestId },
      });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'admin.create',
      targetType: 'admin',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { email: created.email, name: created.name, roleId: created.roleId },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: toSafeAdmin(created), meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.get('/:id', requireAuth, requireAdminsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [admin] = await db.select().from(admins).where(eq(admins.id, id));
    if (!admin || admin.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '관리자를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    res.json({ data: toSafeAdmin(admin), meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/:id', requireAuth, requireAdminsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateAdminSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(admins).where(eq(admins.id, id));
    if (!before || before.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '관리자를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    if (before.updatedAt.toISOString() !== parsed.expectedUpdatedAt) {
      res.status(409).json({
        error: { code: 'VERSION_CONFLICT', message: '다른 곳에서 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.', requestId: req.requestId },
      });
      return;
    }

    const { expectedUpdatedAt: _expected, ...changes } = parsed;
    const [updated] = await db
      .update(admins)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(admins.id, id))
      .returning();
    if (!updated) {
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: '관리자를 수정하지 못했습니다.', requestId: req.requestId },
      });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'admin.update',
      targetType: 'admin',
      targetId: updated.id,
      beforeDataSafe: { name: before.name, roleId: before.roleId, status: before.status },
      afterDataSafe: { name: updated.name, roleId: updated.roleId, status: updated.status },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: toSafeAdmin(updated), meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/deactivate', requireAuth, requireAdminsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [admin] = await db.select().from(admins).where(eq(admins.id, id));
    if (!admin || admin.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '관리자를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    if (await isLastActiveSuperAdmin(admin.id, admin.roleId)) {
      res.status(409).json({
        error: { code: 'LAST_SUPER_ADMIN', message: '마지막 최고관리자는 비활성화할 수 없습니다.', requestId: req.requestId },
      });
      return;
    }

    const [updated] = await db
      .update(admins)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(eq(admins.id, admin.id))
      .returning();
    if (!updated) {
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: '관리자를 비활성화하지 못했습니다.', requestId: req.requestId },
      });
      return;
    }
    await revokeAllSessionsForAdmin(admin.id);

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'admin.deactivate',
      targetType: 'admin',
      targetId: admin.id,
      beforeDataSafe: { status: admin.status },
      afterDataSafe: { status: 'inactive' },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: toSafeAdmin(updated), meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/send-reset', requireAuth, requireAdminsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [admin] = await db.select().from(admins).where(eq(admins.id, id));
    if (!admin || admin.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '관리자를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    await requestPasswordReset(admin.email, deps.appUrl, deps.emailAdapter);

    res.json({
      data: { message: '재설정 안내 메일을 보냈습니다.' },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  return router;
}
