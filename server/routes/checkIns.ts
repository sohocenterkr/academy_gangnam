import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString, getTodayKST } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { checkIns, checkInChangeLogs, students } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';
import { sendVersionConflict } from '../utils/httpErrors';

const listQuerySchema = z.object({
  studentId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const manualCreateSchema = z.object({
  studentId: z.string().min(1),
  reason: z.string().min(1),
  allowException: z.boolean().optional(),
});

const updateCheckInSchema = z.object({
  checkInAt: z.iso.datetime().optional(),
  reason: z.string().min(1),
  expectedUpdatedAt: z.iso.datetime(),
});

const cancelSchema = z.object({
  reason: z.string().min(1),
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

export interface CheckInsRouterDeps {
  sessionSecret: string;
}

export function createCheckInsRouter(deps: CheckInsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireCheckinsManage = createRequirePermission(PERMISSIONS.CHECKINS_MANAGE);

  router.get('/', requireAuth, requireCheckinsManage, async (req, res) => {
    const parsedQuery = listQuerySchema.safeParse(req.query);
    const query = parsedQuery.success ? parsedQuery.data : {};

    const conditions = [];
    if (query.studentId) conditions.push(eq(checkIns.studentId, query.studentId));

    const rows = await db
      .select()
      .from(checkIns)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(checkIns.checkInAt));

    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/manual', requireAuth, requireCheckinsManage, async (req, res) => {
    const parsed = parseBody(manualCreateSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [student] = await db.select().from(students).where(eq(students.id, parsed.studentId));
    if (!student || student.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '학생을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const checkInDate = getTodayKST();
    const checkInAt = new Date();
    const isException = parsed.allowException === true;

    let created;
    try {
      [created] = await db
        .insert(checkIns)
        .values({
          studentId: parsed.studentId,
          checkInDate,
          checkInAt,
          source: 'admin',
          status: 'active',
          idempotencyKey: randomUUID(),
          exceptionReason: parsed.reason,
          isException,
          createdBy: req.admin!.id,
          createdAt: checkInAt,
          updatedAt: checkInAt,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, 'check_ins_student_date_active_unique')) {
        res.status(409).json({
          error: {
            code: 'DUPLICATE_CHECKIN',
            message: isException
              ? '등원 등록에 실패했습니다.'
              : '오늘 이미 등원 기록이 있습니다. 예외로 추가 등록하려면 allowException을 사용해 주세요.',
            requestId: req.requestId,
          },
        });
        return;
      }
      throw error;
    }
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '등원 등록에 실패했습니다.', requestId: req.requestId } });
      return;
    }

    await db.insert(checkInChangeLogs).values({
      checkInId: created.id,
      action: isException ? 'exception_create' : 'create',
      beforeData: null,
      afterData: { checkInAt: created.checkInAt, source: 'admin', reason: parsed.reason, isException },
      reason: parsed.reason,
      adminId: req.admin!.id,
      createdAt: new Date(),
    });

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'checkIn.manualCreate',
      targetType: 'checkIn',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { studentId: created.studentId, checkInDate: created.checkInDate },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/:id', requireAuth, requireCheckinsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateCheckInSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(checkIns).where(eq(checkIns.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '등원 기록을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const { expectedUpdatedAt, reason, checkInAt } = parsed;
    const [updated] = await db
      .update(checkIns)
      .set({ ...(checkInAt ? { checkInAt: new Date(checkInAt) } : {}), updatedAt: new Date() })
      .where(and(eq(checkIns.id, id), eq(checkIns.updatedAt, new Date(expectedUpdatedAt))))
      .returning();
    if (!updated) {
      sendVersionConflict(res, req.requestId);
      return;
    }

    await db.insert(checkInChangeLogs).values({
      checkInId: updated.id,
      action: 'update',
      beforeData: { checkInAt: before.checkInAt },
      afterData: { checkInAt: updated.checkInAt },
      reason,
      adminId: req.admin!.id,
      createdAt: new Date(),
    });

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'checkIn.update',
      targetType: 'checkIn',
      targetId: updated.id,
      beforeDataSafe: { checkInAt: before.checkInAt },
      afterDataSafe: { checkInAt: updated.checkInAt },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/cancel', requireAuth, requireCheckinsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(cancelSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(checkIns).where(eq(checkIns.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '등원 기록을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    if (before.status === 'canceled') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '이미 취소된 등원 기록입니다.', requestId: req.requestId } });
      return;
    }

    const [updated] = await db
      .update(checkIns)
      .set({ status: 'canceled', updatedAt: new Date() })
      .where(eq(checkIns.id, id))
      .returning();
    if (!updated) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '취소에 실패했습니다.', requestId: req.requestId } });
      return;
    }

    await db.insert(checkInChangeLogs).values({
      checkInId: updated.id,
      action: 'cancel',
      beforeData: { status: before.status },
      afterData: { status: 'canceled' },
      reason: parsed.reason,
      adminId: req.admin!.id,
      createdAt: new Date(),
    });

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'checkIn.cancel',
      targetType: 'checkIn',
      targetId: updated.id,
      beforeDataSafe: { status: before.status },
      afterDataSafe: { status: 'canceled' },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.get('/:id/history', requireAuth, requireCheckinsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const rows = await db
      .select()
      .from(checkInChangeLogs)
      .where(eq(checkInChangeLogs.checkInId, id))
      .orderBy(desc(checkInChangeLogs.createdAt));

    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
