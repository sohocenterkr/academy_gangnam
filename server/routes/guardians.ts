import { and, eq, ilike, isNull, ne, or } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { maskName } from '@shared/masking';
import { maskPhone, normalizePhone } from '@shared/phone';
import { db } from '../db';
import { guardians } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';

const listQuerySchema = z.object({
  search: z.string().optional(),
});

const createGuardianSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  notes: z.string().optional(),
  confirmDuplicate: z.boolean().optional(),
});

const updateGuardianSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  notes: z.string().optional(),
  confirmDuplicate: z.boolean().optional(),
  expectedUpdatedAt: z.iso.datetime(),
});

function toMaskedGuardian(guardian: typeof guardians.$inferSelect) {
  return {
    id: guardian.id,
    name: maskName(guardian.name),
    phoneNormalized: maskPhone(guardian.phoneNormalized),
    notes: guardian.notes,
    updatedAt: guardian.updatedAt,
  };
}

export interface GuardiansRouterDeps {
  sessionSecret: string;
}

export function createGuardiansRouter(deps: GuardiansRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireGuardiansManage = createRequirePermission(PERMISSIONS.GUARDIANS_MANAGE);

  router.get('/', requireAuth, requireGuardiansManage, async (req, res) => {
    const parsedQuery = listQuerySchema.safeParse(req.query);
    const search = parsedQuery.success ? parsedQuery.data.search : undefined;

    const conditions = [isNull(guardians.deletedAt)];
    if (search) {
      const normalizedSearch = normalizePhone(search);
      const searchConditions = [ilike(guardians.name, `%${search}%`)];
      if (normalizedSearch) {
        searchConditions.push(ilike(guardians.phoneNormalized, `%${normalizedSearch}%`));
      }
      conditions.push(or(...searchConditions)!);
    }

    const rows = await db
      .select()
      .from(guardians)
      .where(and(...conditions))
      .orderBy(guardians.name);

    res.json({
      data: rows.map(toMaskedGuardian),
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.post('/', requireAuth, requireGuardiansManage, async (req, res) => {
    const parsed = parseBody(createGuardianSchema, req.body, res, req.requestId);
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
        .from(guardians)
        .where(and(eq(guardians.phoneNormalized, phoneNormalized), isNull(guardians.deletedAt)));

      if (existingMatches.length > 0) {
        res.json({
          data: {
            status: 'duplicate_warning',
            duplicates: existingMatches.map((g) => ({ id: g.id, name: maskName(g.name), phoneNormalized: maskPhone(g.phoneNormalized) })),
          },
          meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
        });
        return;
      }
    }

    const [created] = await db
      .insert(guardians)
      .values({
        name: parsed.name,
        phoneNormalized,
        notes: parsed.notes,
        createdBy: req.admin!.id,
        updatedBy: req.admin!.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '보호자를 등록하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'guardian.create',
      targetType: 'guardian',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { name: created.name, phoneNormalized: maskPhone(created.phoneNormalized) },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({
      data: { status: 'created', guardian: created },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.get('/:id', requireAuth, requireGuardiansManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [guardian] = await db.select().from(guardians).where(eq(guardians.id, id));
    if (!guardian || guardian.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '보호자를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    res.json({ data: guardian, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/:id', requireAuth, requireGuardiansManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateGuardianSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(guardians).where(eq(guardians.id, id));
    if (!before || before.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '보호자를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    let phoneNormalized: string | undefined;
    if (parsed.phone !== undefined) {
      phoneNormalized = normalizePhone(parsed.phone);
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

      if (phoneNormalized !== before.phoneNormalized && !parsed.confirmDuplicate) {
        const existingMatches = await db
          .select()
          .from(guardians)
          .where(and(eq(guardians.phoneNormalized, phoneNormalized), isNull(guardians.deletedAt), ne(guardians.id, id)));

        if (existingMatches.length > 0) {
          res.json({
            data: {
              status: 'duplicate_warning',
              duplicates: existingMatches.map((g) => ({ id: g.id, name: maskName(g.name), phoneNormalized: maskPhone(g.phoneNormalized) })),
            },
            meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
          });
          return;
        }
      }
    }

    const { expectedUpdatedAt, phone: _phone, confirmDuplicate: _confirm, ...rest } = parsed;
    const [updated] = await db
      .update(guardians)
      .set({
        ...rest,
        ...(phoneNormalized !== undefined ? { phoneNormalized } : {}),
        updatedBy: req.admin!.id,
        updatedAt: new Date(),
      })
      .where(and(eq(guardians.id, id), eq(guardians.updatedAt, new Date(expectedUpdatedAt))))
      .returning();
    if (!updated) {
      res.status(409).json({
        error: { code: 'VERSION_CONFLICT', message: '다른 곳에서 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.', requestId: req.requestId },
      });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'guardian.update',
      targetType: 'guardian',
      targetId: updated.id,
      beforeDataSafe: { name: before.name, phoneNormalized: maskPhone(before.phoneNormalized) },
      afterDataSafe: { name: updated.name, phoneNormalized: maskPhone(updated.phoneNormalized) },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({
      data: { status: 'updated', guardian: updated },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  return router;
}
