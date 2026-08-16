import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { studentGuardians } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';
import { unsetOtherPrimaryGuardians } from '../utils/studentGuardians';

const updateLinkSchema = z.object({
  relationship: z.string().optional(),
  isPrimary: z.boolean().optional(),
  receiveMessages: z.boolean().optional(),
  useForCheckin: z.boolean().optional(),
  expectedUpdatedAt: z.iso.datetime(),
});

function isUniqueViolation(error: unknown, indexName: string): boolean {
  let current: unknown = error;
  while (current) {
    if (current instanceof Error) {
      if (current.message.includes(indexName)) return true;
      const constraint = (current as { constraint?: unknown }).constraint;
      if (typeof constraint === 'string' && constraint.includes(indexName)) return true;
      current = current.cause;
      continue;
    }
    break;
  }
  return false;
}

export interface StudentGuardiansRouterDeps {
  sessionSecret: string;
}

export function createStudentGuardiansRouter(deps: StudentGuardiansRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireStudentsManage = createRequirePermission(PERMISSIONS.STUDENTS_MANAGE);

  router.patch('/:id', requireAuth, requireStudentsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateLinkSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(studentGuardians).where(eq(studentGuardians.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '연결 정보를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    const { expectedUpdatedAt, ...changes } = parsed;

    let updated;
    try {
      updated = await db.transaction(async (tx) => {
        if (changes.isPrimary) {
          await unsetOtherPrimaryGuardians(tx, before.studentId);
        }
        const [row] = await tx
          .update(studentGuardians)
          .set({ ...changes, updatedAt: new Date() })
          .where(and(eq(studentGuardians.id, id), eq(studentGuardians.updatedAt, new Date(expectedUpdatedAt))))
          .returning();
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'student_guardians_primary_unique')) {
        res.status(409).json({
          error: { code: 'VALIDATION_ERROR', message: '이미 다른 보호자가 대표로 지정되어 있습니다. 새로고침 후 다시 시도해 주세요.', requestId: req.requestId },
        });
        return;
      }
      throw error;
    }
    if (!updated) {
      res.status(409).json({
        error: { code: 'VERSION_CONFLICT', message: '다른 곳에서 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.', requestId: req.requestId },
      });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'student_guardian.update',
      targetType: 'student_guardian',
      targetId: updated.id,
      beforeDataSafe: { relationship: before.relationship, isPrimary: before.isPrimary },
      afterDataSafe: { relationship: updated.relationship, isPrimary: updated.isPrimary },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.delete('/:id', requireAuth, requireStudentsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [existing] = await db.select().from(studentGuardians).where(eq(studentGuardians.id, id));
    if (!existing) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '연결 정보를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    await db.delete(studentGuardians).where(eq(studentGuardians.id, id));

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'student_guardian.delete',
      targetType: 'student_guardian',
      targetId: id,
      beforeDataSafe: { studentId: existing.studentId, guardianId: existing.guardianId },
      afterDataSafe: null,
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: { success: true }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
