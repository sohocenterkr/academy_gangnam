import { and, eq, ilike, isNull, or } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString, getTodayKST } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { maskName } from '@shared/masking';
import { maskPhone, normalizePhone } from '@shared/phone';
import { db } from '../db';
import { students } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';

const STATUS_VALUES = ['enrolled', 'paused', 'withdrawn', 'graduated'] as const;

const listQuerySchema = z.object({
  search: z.string().optional(),
  status: z.enum(STATUS_VALUES).optional(),
  gradeLevelId: z.string().optional(),
});

const createStudentSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  gradeLevelId: z.string().min(1),
  schoolId: z.string().optional(),
  birthDate: z.string().optional(),
  address: z.string().optional(),
  registrationDate: z.string().optional(),
  specialNotes: z.string().optional(),
  counselingNotes: z.string().optional(),
  confirmDuplicate: z.boolean().optional(),
});

function toMaskedStudent(student: typeof students.$inferSelect) {
  return {
    id: student.id,
    name: maskName(student.name),
    phoneNormalized: maskPhone(student.phoneNormalized),
    schoolId: student.schoolId,
    gradeLevelId: student.gradeLevelId,
    status: student.status,
    registrationDate: student.registrationDate,
    updatedAt: student.updatedAt,
  };
}

function isForeignKeyViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current) {
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      if (code === '23503') return true;
      current = current.cause;
      continue;
    }
    break;
  }
  return false;
}

export interface StudentsRouterDeps {
  sessionSecret: string;
}

export function createStudentsRouter(deps: StudentsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireStudentsManage = createRequirePermission(PERMISSIONS.STUDENTS_MANAGE);

  router.get('/', requireAuth, requireStudentsManage, async (req, res) => {
    const parsedQuery = listQuerySchema.safeParse(req.query);
    const query = parsedQuery.success ? parsedQuery.data : {};

    const conditions = [isNull(students.deletedAt)];
    if (query.search) {
      const normalizedSearch = normalizePhone(query.search);
      const searchConditions = [ilike(students.name, `%${query.search}%`)];
      if (normalizedSearch) {
        searchConditions.push(ilike(students.phoneNormalized, `%${normalizedSearch}%`));
      }
      conditions.push(or(...searchConditions)!);
    }
    if (query.status) {
      conditions.push(eq(students.status, query.status));
    }
    if (query.gradeLevelId) {
      conditions.push(eq(students.gradeLevelId, query.gradeLevelId));
    }

    const rows = await db
      .select()
      .from(students)
      .where(and(...conditions))
      .orderBy(students.name);

    res.json({
      data: rows.map(toMaskedStudent),
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.post('/', requireAuth, requireStudentsManage, async (req, res) => {
    const parsed = parseBody(createStudentSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const phoneNormalized = normalizePhone(parsed.phone);
    if (!phoneNormalized) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: '입력값을 확인해 주세요.',
          fieldErrors: { phone: ['전화번호를 확인해 주세요.'] },
          requestId: req.requestId,
        },
      });
      return;
    }

    if (!parsed.confirmDuplicate) {
      const existingMatches = await db
        .select()
        .from(students)
        .where(and(eq(students.phoneNormalized, phoneNormalized), isNull(students.deletedAt)));

      if (existingMatches.length > 0) {
        res.json({
          data: {
            status: 'duplicate_warning',
            duplicates: existingMatches.map((s) => ({ id: s.id, name: maskName(s.name), phoneNormalized: maskPhone(s.phoneNormalized) })),
          },
          meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
        });
        return;
      }
    }

    const registrationDate = parsed.registrationDate ?? getTodayKST();

    let created;
    try {
      [created] = await db
        .insert(students)
        .values({
          name: parsed.name,
          phoneNormalized,
          gradeLevelId: parsed.gradeLevelId,
          schoolId: parsed.schoolId,
          birthDate: parsed.birthDate,
          address: parsed.address,
          registrationDate,
          statusEffectiveDate: registrationDate,
          specialNotes: parsed.specialNotes,
          counselingNotes: parsed.counselingNotes,
          createdBy: req.admin!.id,
          updatedBy: req.admin!.id,
        })
        .returning();
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: '입력값을 확인해 주세요.',
            fieldErrors: { gradeLevelId: ['학년을 확인해 주세요.'] },
            requestId: req.requestId,
          },
        });
        return;
      }
      throw error;
    }
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '학생을 등록하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'student.create',
      targetType: 'student',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { name: created.name, phoneNormalized: maskPhone(created.phoneNormalized) },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({
      data: { status: 'created', student: created },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  return router;
}
