import { and, eq, ilike, isNull, or } from 'drizzle-orm';
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
            duplicates: existingMatches.map((g) => ({ id: g.id, name: g.name, phoneNormalized: maskPhone(g.phoneNormalized) })),
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

  return router;
}
