import { and, eq, gte, isNull, lte, ne, or } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getTodayKST, getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { enrollments, students, courses } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';
import { sendVersionConflict } from '../utils/httpErrors';

const createEnrollmentSchema = z.object({
  studentId: z.string().min(1),
  courseId: z.string().min(1),
  startDate: z.string(),
  plannedEndDate: z.string().optional(),
  tuitionAmount: z.number().int().nonnegative().optional(),
  memo: z.string().optional(),
  confirmOverlap: z.boolean().optional(),
});

const updateEnrollmentSchema = z.object({
  startDate: z.string().optional(),
  plannedEndDate: z.string().optional(),
  status: z.enum(['waiting', 'active', 'paused', 'ended', 'canceled']).optional(),
  tuitionAmount: z.number().int().nonnegative().optional(),
  adjustmentNote: z.string().optional(),
  memo: z.string().optional(),
  confirmOverlap: z.boolean().optional(),
  expectedUpdatedAt: z.iso.datetime(),
});

const endEnrollmentSchema = z.object({ reason: z.string().optional() });
const cancelEnrollmentSchema = z.object({ reason: z.string().optional() });

const listQuerySchema = z.object({
  studentId: z.string().optional(),
  courseId: z.string().optional(),
  status: z.enum(['waiting', 'active', 'paused', 'ended', 'canceled']).optional(),
});

const OPEN_STATUSES = ['waiting', 'active', 'paused'] as const;

async function findOverlap(studentId: string, courseId: string, startDate: string, plannedEndDate: string | undefined, excludeId?: string) {
  const conditions = [
    eq(enrollments.studentId, studentId),
    eq(enrollments.courseId, courseId),
    or(...OPEN_STATUSES.map((s) => eq(enrollments.status, s)))!,
    plannedEndDate ? lte(enrollments.startDate, plannedEndDate) : undefined,
    or(isNull(enrollments.plannedEndDate), gte(enrollments.plannedEndDate, startDate))!,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  if (excludeId) conditions.push(ne(enrollments.id, excludeId));

  return db.select().from(enrollments).where(and(...conditions));
}

export interface EnrollmentsRouterDeps {
  sessionSecret: string;
}

export function createEnrollmentsRouter(deps: EnrollmentsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireCoursesManage = createRequirePermission(PERMISSIONS.COURSES_MANAGE);

  router.get('/', requireAuth, requireCoursesManage, async (req, res) => {
    const parsedQuery = listQuerySchema.safeParse(req.query);
    const query = parsedQuery.success ? parsedQuery.data : {};

    const conditions = [];
    if (query.studentId) conditions.push(eq(enrollments.studentId, query.studentId));
    if (query.courseId) conditions.push(eq(enrollments.courseId, query.courseId));
    if (query.status) conditions.push(eq(enrollments.status, query.status));

    const rows = await db
      .select()
      .from(enrollments)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/', requireAuth, requireCoursesManage, async (req, res) => {
    const parsed = parseBody(createEnrollmentSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [student] = await db.select().from(students).where(eq(students.id, parsed.studentId));
    if (!student || student.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '학생을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    const [course] = await db.select().from(courses).where(eq(courses.id, parsed.courseId));
    if (!course || course.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '강좌를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    if (!parsed.confirmOverlap) {
      const overlaps = await findOverlap(parsed.studentId, parsed.courseId, parsed.startDate, parsed.plannedEndDate);
      if (overlaps.length > 0) {
        res.status(409).json({
          error: {
            code: 'PERIOD_OVERLAP',
            message: '기존 수강 기간과 겹칩니다. 계속하려면 확인이 필요합니다.',
            requestId: req.requestId,
          },
          data: { conflicts: overlaps.map((o) => ({ id: o.id, startDate: o.startDate, plannedEndDate: o.plannedEndDate })) },
        });
        return;
      }
    }

    const now = new Date();
    const [created] = await db
      .insert(enrollments)
      .values({
        studentId: parsed.studentId,
        courseId: parsed.courseId,
        startDate: parsed.startDate,
        plannedEndDate: parsed.plannedEndDate,
        tuitionAmount: parsed.tuitionAmount,
        memo: parsed.memo,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        createdBy: req.admin!.id,
        updatedBy: req.admin!.id,
      })
      .returning();
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '수강등록에 실패했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'enrollment.create',
      targetType: 'enrollment',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { studentId: created.studentId, courseId: created.courseId },
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

    const parsed = parseBody(updateEnrollmentSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(enrollments).where(eq(enrollments.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '수강 기록을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const { expectedUpdatedAt, confirmOverlap, ...changes } = parsed;

    // Only a change to the period or status can newly create an overlap; ending/canceling never can.
    const newStatus = changes.status ?? before.status;
    const willBeOpen = (OPEN_STATUSES as readonly string[]).includes(newStatus);
    const periodOrStatusChanged = changes.startDate !== undefined || changes.plannedEndDate !== undefined || changes.status !== undefined;

    if (willBeOpen && periodOrStatusChanged && !confirmOverlap) {
      const overlaps = await findOverlap(
        before.studentId,
        before.courseId,
        changes.startDate ?? before.startDate,
        changes.plannedEndDate ?? before.plannedEndDate ?? undefined,
        id
      );
      if (overlaps.length > 0) {
        res.status(409).json({
          error: {
            code: 'PERIOD_OVERLAP',
            message: '기존 수강 기간과 겹칩니다. 계속하려면 확인이 필요합니다.',
            requestId: req.requestId,
          },
          data: { conflicts: overlaps.map((o) => ({ id: o.id, startDate: o.startDate, plannedEndDate: o.plannedEndDate })) },
        });
        return;
      }
    }

    // Keep actualEndDate consistent with POST /:id/end regardless of which route is used to end
    // (or cancel) an enrollment: it represents "when did they stop attending."
    const actualEndDateChange =
      changes.status !== undefined && changes.status !== before.status && (changes.status === 'ended' || changes.status === 'canceled')
        ? { actualEndDate: getTodayKST() }
        : {};

    const [updated] = await db
      .update(enrollments)
      .set({ ...changes, ...actualEndDateChange, updatedBy: req.admin!.id, updatedAt: new Date() })
      .where(and(eq(enrollments.id, id), eq(enrollments.updatedAt, new Date(expectedUpdatedAt))))
      .returning();
    if (!updated) {
      sendVersionConflict(res, req.requestId);
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'enrollment.update',
      targetType: 'enrollment',
      targetId: updated.id,
      beforeDataSafe: { status: before.status, tuitionAmount: before.tuitionAmount },
      afterDataSafe: { status: updated.status, tuitionAmount: updated.tuitionAmount },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/end', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const parsed = parseBody(endEnrollmentSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(enrollments).where(eq(enrollments.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '수강 기록을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const [updated] = await db
      .update(enrollments)
      .set({ status: 'ended', actualEndDate: getTodayKST(), adjustmentNote: parsed.reason, updatedBy: req.admin!.id, updatedAt: new Date() })
      .where(eq(enrollments.id, id))
      .returning();
    if (!updated) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '종료 처리에 실패했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'enrollment.end',
      targetType: 'enrollment',
      targetId: updated.id,
      beforeDataSafe: { status: before.status },
      afterDataSafe: { status: 'ended' },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/cancel', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const parsed = parseBody(cancelEnrollmentSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(enrollments).where(eq(enrollments.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '수강 기록을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const [updated] = await db
      .update(enrollments)
      .set({ status: 'canceled', adjustmentNote: parsed.reason, updatedBy: req.admin!.id, updatedAt: new Date() })
      .where(eq(enrollments.id, id))
      .returning();
    if (!updated) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '취소 처리에 실패했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'enrollment.cancel',
      targetType: 'enrollment',
      targetId: updated.id,
      beforeDataSafe: { status: before.status },
      afterDataSafe: { status: 'canceled' },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
