import { and, desc, eq, lt } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { auditLogs } from '@shared/schema';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';

const PAGE_SIZE = 50;

const listQuerySchema = z.object({
  targetType: z.string().optional(),
  action: z.string().optional(),
  adminId: z.string().optional(),
  before: z.iso.datetime().optional(),
});

export interface AuditLogsRouterDeps {
  sessionSecret: string;
}

export function createAuditLogsRouter(deps: AuditLogsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireAuditView = createRequirePermission(PERMISSIONS.AUDIT_VIEW);

  router.get('/', requireAuth, requireAuditView, async (req, res) => {
    const parsedQuery = listQuerySchema.safeParse(req.query);
    const query = parsedQuery.success ? parsedQuery.data : {};

    const conditions = [];
    if (query.targetType) conditions.push(eq(auditLogs.targetType, query.targetType));
    if (query.action) conditions.push(eq(auditLogs.action, query.action));
    if (query.adminId) conditions.push(eq(auditLogs.adminId, query.adminId));
    if (query.before) conditions.push(lt(auditLogs.createdAt, new Date(query.before)));

    const rows = await db
      .select()
      .from(auditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(PAGE_SIZE + 1);

    const hasMore = rows.length > PAGE_SIZE;
    const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

    res.json({
      data: page,
      meta: {
        requestId: req.requestId,
        kstTimestamp: getNowKSTISOString(),
        hasMore,
        nextBefore: hasMore ? page[page.length - 1]!.createdAt.toISOString() : null,
      },
    });
  });

  router.get('/:id', requireAuth, requireAuditView, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.id, id));
    if (!row) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '감사 기록을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    res.json({ data: row, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
