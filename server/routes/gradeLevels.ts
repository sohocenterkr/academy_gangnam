import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { gradeLevels } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';

const createGradeLevelSchema = z.object({
  name: z.string().min(1),
  sortOrder: z.number().int().optional(),
});

const updateGradeLevelSchema = z.object({
  name: z.string().min(1).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  expectedUpdatedAt: z.string(),
});

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

export interface GradeLevelsRouterDeps {
  sessionSecret: string;
}

export function createGradeLevelsRouter(deps: GradeLevelsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireAcademyManage = createRequirePermission(PERMISSIONS.ACADEMY_MANAGE);

  router.get('/', requireAuth, requireAcademyManage, async (req, res) => {
    const rows = await db.select().from(gradeLevels).orderBy(gradeLevels.sortOrder);
    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/', requireAuth, requireAcademyManage, async (req, res) => {
    const parsed = parseBody(createGradeLevelSchema, req.body, res, req.requestId);
    if (!parsed) return;

    let created;
    try {
      [created] = await db
        .insert(gradeLevels)
        .values({
          name: parsed.name,
          sortOrder: parsed.sortOrder ?? 0,
          createdBy: req.admin!.id,
          updatedBy: req.admin!.id,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, 'grade_levels_active_name_unique')) {
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
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '학년을 등록하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'gradeLevel.create',
      targetType: 'gradeLevel',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { name: created.name },
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

    const parsed = parseBody(updateGradeLevelSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(gradeLevels).where(eq(gradeLevels.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '학년을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    if (before.updatedAt.toISOString() !== parsed.expectedUpdatedAt) {
      res.status(409).json({
        error: { code: 'VERSION_CONFLICT', message: '다른 곳에서 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.', requestId: req.requestId },
      });
      return;
    }

    const { expectedUpdatedAt: _expected, ...changes } = parsed;

    let updated;
    try {
      [updated] = await db
        .update(gradeLevels)
        .set({ ...changes, updatedBy: req.admin!.id, updatedAt: new Date() })
        .where(eq(gradeLevels.id, id))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, 'grade_levels_active_name_unique')) {
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
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '학년을 수정하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'gradeLevel.update',
      targetType: 'gradeLevel',
      targetId: updated.id,
      beforeDataSafe: { name: before.name, isActive: before.isActive },
      afterDataSafe: { name: updated.name, isActive: updated.isActive },
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

    const [existing] = await db.select().from(gradeLevels).where(eq(gradeLevels.id, id));
    if (!existing) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '학년을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    try {
      await db.delete(gradeLevels).where(eq(gradeLevels.id, id));
    } catch {
      res.status(409).json({
        error: {
          code: 'IN_USE',
          message: '이 학년을 사용 중인 데이터가 있어 삭제할 수 없습니다. 비활성화를 이용해 주세요.',
          requestId: req.requestId,
        },
      });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'gradeLevel.delete',
      targetType: 'gradeLevel',
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
