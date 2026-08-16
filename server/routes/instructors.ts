import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { normalizePhone } from '@shared/phone';
import { db } from '../db';
import { instructors } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';
import { sendVersionConflict } from '../utils/httpErrors';

const createInstructorSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  subjects: z.array(z.string()).default([]),
  adminId: z.string().optional(),
  notes: z.string().optional(),
});

const updateInstructorSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  subjects: z.array(z.string()).optional(),
  adminId: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  notes: z.string().optional(),
  expectedUpdatedAt: z.iso.datetime(),
});

function invalidPhoneError(requestId: string) {
  return {
    error: {
      code: 'VALIDATION_ERROR',
      message: '입력값을 확인해 주세요.',
      fieldErrors: { phone: ['전화번호를 확인해 주세요.'] },
      requestId,
    },
  };
}

export interface InstructorsRouterDeps {
  sessionSecret: string;
}

export function createInstructorsRouter(deps: InstructorsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireCoursesManage = createRequirePermission(PERMISSIONS.COURSES_MANAGE);

  router.get('/', requireAuth, requireCoursesManage, async (req, res) => {
    const rows = await db.select().from(instructors);
    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/', requireAuth, requireCoursesManage, async (req, res) => {
    const parsed = parseBody(createInstructorSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const phoneNormalized = normalizePhone(parsed.phone);
    if (!phoneNormalized) {
      res.status(400).json(invalidPhoneError(req.requestId));
      return;
    }

    const now = new Date();
    const { phone: _phone, ...rest } = parsed;
    const [created] = await db
      .insert(instructors)
      .values({ ...rest, phoneNormalized, status: 'active', createdAt: now, updatedAt: now, createdBy: req.admin!.id, updatedBy: req.admin!.id })
      .returning();
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '강사를 등록하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'instructor.create',
      targetType: 'instructor',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { name: created.name, phoneNormalized: created.phoneNormalized },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/:id', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateInstructorSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(instructors).where(eq(instructors.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '강사를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    let phoneNormalized: string | undefined;
    if (parsed.phone !== undefined) {
      phoneNormalized = normalizePhone(parsed.phone);
      if (!phoneNormalized) {
        res.status(400).json(invalidPhoneError(req.requestId));
        return;
      }
    }

    const { expectedUpdatedAt, phone: _phone, ...changes } = parsed;
    const [updated] = await db
      .update(instructors)
      .set({
        ...changes,
        ...(phoneNormalized !== undefined ? { phoneNormalized } : {}),
        updatedBy: req.admin!.id,
        updatedAt: new Date(),
      })
      .where(and(eq(instructors.id, id), eq(instructors.updatedAt, new Date(expectedUpdatedAt))))
      .returning();
    if (!updated) {
      sendVersionConflict(res, req.requestId);
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'instructor.update',
      targetType: 'instructor',
      targetId: updated.id,
      beforeDataSafe: { name: before.name, status: before.status },
      afterDataSafe: { name: updated.name, status: updated.status },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
