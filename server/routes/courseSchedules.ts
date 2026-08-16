import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { courses, courseSchedules } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);

const createScheduleSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: timeSchema,
  endTime: timeSchema,
  classroom: z.string().optional(),
  instructorId: z.string().optional(),
  repeatStartDate: z.string().optional(),
  repeatEndDate: z.string().optional(),
});

const updateScheduleSchema = createScheduleSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export interface CourseSchedulesRouterDeps {
  sessionSecret: string;
}

export function createCourseSchedulesRouter(deps: CourseSchedulesRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireCoursesManage = createRequirePermission(PERMISSIONS.COURSES_MANAGE);

  router.post('/courses/:id/schedules', requireAuth, requireCoursesManage, async (req, res) => {
    const courseId = req.params.id;
    if (!courseId || Array.isArray(courseId)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(createScheduleSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
    if (!course || course.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '강좌를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const now = new Date();
    const [created] = await db
      .insert(courseSchedules)
      .values({ ...parsed, courseId, isActive: true, createdAt: now, updatedAt: now, createdBy: req.admin!.id, updatedBy: req.admin!.id })
      .returning();
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '일정을 추가하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'courseSchedule.create',
      targetType: 'courseSchedule',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { courseId, dayOfWeek: created.dayOfWeek },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/course-schedules/:id', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateScheduleSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(courseSchedules).where(eq(courseSchedules.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '일정을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const [updated] = await db
      .update(courseSchedules)
      .set({ ...parsed, updatedBy: req.admin!.id, updatedAt: new Date() })
      .where(eq(courseSchedules.id, id))
      .returning();
    if (!updated) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '일정을 수정하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'courseSchedule.update',
      targetType: 'courseSchedule',
      targetId: updated.id,
      beforeDataSafe: { dayOfWeek: before.dayOfWeek },
      afterDataSafe: { dayOfWeek: updated.dayOfWeek },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.delete('/course-schedules/:id', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [existing] = await db.select().from(courseSchedules).where(eq(courseSchedules.id, id));
    if (!existing) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '일정을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    await db.delete(courseSchedules).where(eq(courseSchedules.id, id));

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'courseSchedule.delete',
      targetType: 'courseSchedule',
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
