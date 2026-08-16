import { and, count, eq, ilike, isNull } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { courses, courseSchedules, enrollments } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';
import { sendVersionConflict, isUniqueViolation } from '../utils/httpErrors';

const createCourseSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.string().optional(),
  targetGradeIds: z.array(z.string()).default([]),
  instructorId: z.string().optional(),
  classroom: z.string().optional(),
  capacity: z.number().int().positive().optional(),
  baseFee: z.number().int().nonnegative().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  description: z.string().optional(),
});

// NOTE: deliberately NOT derived via createCourseSchema.partial() — in the installed Zod 4,
// .partial() does not suppress an inner .default(), so a partial() of createCourseSchema would
// still produce targetGradeIds: [] when the field is omitted from a PATCH body, silently wiping
// the course's real target grade levels on every partial update that doesn't touch this field.
const updateCourseSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  category: z.string().optional(),
  targetGradeIds: z.array(z.string()).optional(),
  instructorId: z.string().optional(),
  classroom: z.string().optional(),
  capacity: z.number().int().positive().optional(),
  baseFee: z.number().int().nonnegative().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  description: z.string().optional(),
  expectedUpdatedAt: z.iso.datetime(),
});

const statusChangeSchema = z.object({
  status: z.enum(['recruiting', 'closed', 'ended', 'inactive']),
  expectedUpdatedAt: z.iso.datetime(),
});

const copyCourseSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1).optional(),
});

const listQuerySchema = z.object({
  status: z.enum(['recruiting', 'closed', 'ended', 'inactive']).optional(),
  instructorId: z.string().optional(),
  name: z.string().optional(),
});

function courseValidationError(requestId: string) {
  return {
    error: {
      code: 'VALIDATION_ERROR',
      message: '입력값을 확인해 주세요.',
      fieldErrors: { code: ['이미 사용 중인 강좌 코드입니다.'] },
      requestId,
    },
  };
}

export interface CoursesRouterDeps {
  sessionSecret: string;
}

export function createCoursesRouter(deps: CoursesRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireCoursesManage = createRequirePermission(PERMISSIONS.COURSES_MANAGE);

  router.get('/', requireAuth, requireCoursesManage, async (req, res) => {
    const parsedQuery = listQuerySchema.safeParse(req.query);
    const query = parsedQuery.success ? parsedQuery.data : {};

    const conditions = [isNull(courses.deletedAt)];
    if (query.status) conditions.push(eq(courses.status, query.status));
    if (query.instructorId) conditions.push(eq(courses.instructorId, query.instructorId));
    if (query.name) conditions.push(ilike(courses.name, `%${query.name}%`));

    const rows = await db.select().from(courses).where(and(...conditions));
    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/', requireAuth, requireCoursesManage, async (req, res) => {
    const parsed = parseBody(createCourseSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const now = new Date();
    let created;
    try {
      [created] = await db
        .insert(courses)
        .values({
          ...parsed,
          targetGradeIds: parsed.targetGradeIds ?? [],
          status: 'recruiting',
          createdAt: now,
          updatedAt: now,
          createdBy: req.admin!.id,
          updatedBy: req.admin!.id,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, 'courses_code_unique')) {
        res.status(400).json(courseValidationError(req.requestId));
        return;
      }
      throw error;
    }
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '강좌를 등록하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'course.create',
      targetType: 'course',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { code: created.code, name: created.name },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.get('/:id', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [course] = await db.select().from(courses).where(eq(courses.id, id));
    if (!course || course.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '강좌를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const schedules = await db.select().from(courseSchedules).where(eq(courseSchedules.courseId, id));
    const [activeCountRow] = await db
      .select({ value: count() })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, id), eq(enrollments.status, 'active')));

    res.json({
      data: { ...course, schedules, activeEnrollmentCount: activeCountRow?.value ?? 0 },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.patch('/:id', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateCourseSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(courses).where(eq(courses.id, id));
    if (!before || before.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '강좌를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const { expectedUpdatedAt, ...changes } = parsed;
    let updated;
    try {
      [updated] = await db
        .update(courses)
        .set({ ...changes, updatedBy: req.admin!.id, updatedAt: new Date() })
        .where(and(eq(courses.id, id), eq(courses.updatedAt, new Date(expectedUpdatedAt))))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, 'courses_code_unique')) {
        res.status(400).json(courseValidationError(req.requestId));
        return;
      }
      throw error;
    }
    if (!updated) {
      sendVersionConflict(res, req.requestId);
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'course.update',
      targetType: 'course',
      targetId: updated.id,
      beforeDataSafe: { name: before.name, status: before.status },
      afterDataSafe: { name: updated.name, status: updated.status },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/status', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(statusChangeSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(courses).where(eq(courses.id, id));
    if (!before || before.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '강좌를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const [updated] = await db
      .update(courses)
      .set({ status: parsed.status, updatedBy: req.admin!.id, updatedAt: new Date() })
      .where(and(eq(courses.id, id), eq(courses.updatedAt, new Date(parsed.expectedUpdatedAt))))
      .returning();
    if (!updated) {
      sendVersionConflict(res, req.requestId);
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'course.statusChange',
      targetType: 'course',
      targetId: updated.id,
      beforeDataSafe: { status: before.status },
      afterDataSafe: { status: updated.status },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/copy', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(copyCourseSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [source] = await db.select().from(courses).where(eq(courses.id, id));
    if (!source || source.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '강좌를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const now = new Date();
    let created;
    try {
      [created] = await db
        .insert(courses)
        .values({
          code: parsed.code,
          name: parsed.name ?? source.name,
          category: source.category,
          targetGradeIds: source.targetGradeIds,
          instructorId: source.instructorId,
          classroom: source.classroom,
          capacity: source.capacity,
          baseFee: source.baseFee,
          startDate: source.startDate,
          endDate: source.endDate,
          status: 'recruiting',
          description: source.description,
          createdAt: now,
          updatedAt: now,
          createdBy: req.admin!.id,
          updatedBy: req.admin!.id,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, 'courses_code_unique')) {
        res.status(400).json(courseValidationError(req.requestId));
        return;
      }
      throw error;
    }
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '강좌를 복사하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'course.copy',
      targetType: 'course',
      targetId: created.id,
      beforeDataSafe: { sourceCourseId: source.id },
      afterDataSafe: { code: created.code, name: created.name },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
