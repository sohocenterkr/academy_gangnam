import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { schools } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';

const createSchoolSchema = z.object({
  name: z.string().min(1),
  region: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

const updateSchoolSchema = z.object({
  name: z.string().min(1).optional(),
  region: z.string().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  expectedUpdatedAt: z.iso.datetime(),
});

function isForeignKeyViolation(error: unknown): boolean {
  // Same `.cause`-walking approach as isUniqueViolation below, but checking for
  // Postgres error code 23503 (foreign_key_violation) instead of a constraint name,
  // so genuine connection/timeout/other errors are never misreported as IN_USE.
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

function isUniqueViolation(error: unknown, indexName: string): boolean {
  // drizzle-orm wraps the underlying pg error in a DrizzleQueryError whose own
  // `.message` is just "Failed query: ...\nparams: ..." — the real Postgres
  // error (with the constraint name, either in `.message` or `.constraint`)
  // lives on `.cause`. Walk the cause chain so this works regardless of
  // whether drizzle wraps the error or the raw pg error is thrown directly.
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

export interface SchoolsRouterDeps {
  sessionSecret: string;
}

export function createSchoolsRouter(deps: SchoolsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireAcademyManage = createRequirePermission(PERMISSIONS.ACADEMY_MANAGE);

  router.get('/', requireAuth, requireAcademyManage, async (req, res) => {
    const rows = await db.select().from(schools).orderBy(schools.sortOrder);
    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/', requireAuth, requireAcademyManage, async (req, res) => {
    const parsed = parseBody(createSchoolSchema, req.body, res, req.requestId);
    if (!parsed) return;

    let created;
    try {
      [created] = await db
        .insert(schools)
        .values({
          name: parsed.name,
          region: parsed.region,
          sortOrder: parsed.sortOrder ?? 0,
          createdBy: req.admin!.id,
          updatedBy: req.admin!.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, 'schools_active_name_unique')) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: '입력값을 확인해 주세요.',
            fieldErrors: { name: ['이미 사용 중인 이름입니다.'] },
            requestId: req.requestId,
          },
        });
        return;
      }
      throw error;
    }
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '학교를 등록하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'school.create',
      targetType: 'school',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { name: created.name, region: created.region },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/:id', requireAuth, requireAcademyManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateSchoolSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(schools).where(eq(schools.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '학교를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const { expectedUpdatedAt, ...changes } = parsed;

    let updated;
    try {
      [updated] = await db
        .update(schools)
        .set({ ...changes, updatedBy: req.admin!.id, updatedAt: new Date() })
        .where(and(eq(schools.id, id), eq(schools.updatedAt, new Date(expectedUpdatedAt))))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, 'schools_active_name_unique')) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: '입력값을 확인해 주세요.',
            fieldErrors: { name: ['이미 사용 중인 이름입니다.'] },
            requestId: req.requestId,
          },
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
      action: 'school.update',
      targetType: 'school',
      targetId: updated.id,
      beforeDataSafe: { name: before.name, region: before.region, isActive: before.isActive },
      afterDataSafe: { name: updated.name, region: updated.region, isActive: updated.isActive },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.delete('/:id', requireAuth, requireAcademyManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [existing] = await db.select().from(schools).where(eq(schools.id, id));
    if (!existing) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '학교를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    try {
      await db.delete(schools).where(eq(schools.id, id));
    } catch (error) {
      if (!isForeignKeyViolation(error)) throw error;
      res.status(409).json({
        error: {
          code: 'IN_USE',
          message: '이 학교를 사용 중인 데이터가 있어 삭제할 수 없습니다. 비활성화를 이용해 주세요.',
          requestId: req.requestId,
        },
      });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'school.delete',
      targetType: 'school',
      targetId: id,
      beforeDataSafe: { name: existing.name },
      afterDataSafe: null,
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: { success: true }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
