import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { courses, courseExceptions } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);

const createExceptionSchema = z.object({
  scheduleId: z.string().optional(),
  exceptionType: z.enum(['cancellation', 'makeup']),
  eventDate: z.string(),
  startTime: timeSchema.optional(),
  endTime: timeSchema.optional(),
  reason: z.string().optional(),
});

const updateExceptionSchema = createExceptionSchema.partial();

export interface CourseExceptionsRouterDeps {
  sessionSecret: string;
}

export function createCourseExceptionsRouter(deps: CourseExceptionsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireCoursesManage = createRequirePermission(PERMISSIONS.COURSES_MANAGE);

  router.post('/courses/:id/exceptions', requireAuth, requireCoursesManage, async (req, res) => {
    const courseId = req.params.id;
    if (!courseId || Array.isArray(courseId)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(createExceptionSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
    if (!course || course.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '강좌를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const now = new Date();
    const [created] = await db
      .insert(courseExceptions)
      .values({ ...parsed, courseId, createdAt: now, updatedAt: now, createdBy: req.admin!.id, updatedBy: req.admin!.id })
      .returning();
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '예외 일정을 추가하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'courseException.create',
      targetType: 'courseException',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { courseId, exceptionType: created.exceptionType },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/course-exceptions/:id', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateExceptionSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(courseExceptions).where(eq(courseExceptions.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '예외 일정을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const [updated] = await db
      .update(courseExceptions)
      .set({ ...parsed, updatedBy: req.admin!.id, updatedAt: new Date() })
      .where(eq(courseExceptions.id, id))
      .returning();
    if (!updated) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '예외 일정을 수정하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'courseException.update',
      targetType: 'courseException',
      targetId: updated.id,
      beforeDataSafe: { exceptionType: before.exceptionType },
      afterDataSafe: { exceptionType: updated.exceptionType },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.delete('/course-exceptions/:id', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [existing] = await db.select().from(courseExceptions).where(eq(courseExceptions.id, id));
    if (!existing) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '예외 일정을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    await db.delete(courseExceptions).where(eq(courseExceptions.id, id));

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'courseException.delete',
      targetType: 'courseException',
      targetId: id,
      beforeDataSafe: { courseId: existing.courseId },
      afterDataSafe: null,
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: { success: true }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
