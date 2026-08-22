import { and, eq, isNull } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { messageTemplates } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';

const createSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  messageType: z.enum(['informational', 'marketing']),
  body: z.string().min(1),
  description: z.string().optional(),
  defaultMediaId: z.string().optional(),
  allowedRoles: z.array(z.string()).optional(),
});

const updateSchema = createSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});

export interface MessageTemplatesRouterDeps {
  sessionSecret: string;
}

export function createMessageTemplatesRouter(deps: MessageTemplatesRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireMessagingManage = createRequirePermission(PERMISSIONS.MESSAGING_MANAGE);

  router.get('/', requireAuth, requireMessagingManage, async (req, res) => {
    const rows = await db.select().from(messageTemplates).where(isNull(messageTemplates.deletedAt)).orderBy(messageTemplates.name);
    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.get('/:id', requireAuth, requireMessagingManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const [row] = await db
      .select()
      .from(messageTemplates)
      .where(and(eq(messageTemplates.id, id), isNull(messageTemplates.deletedAt)));
    if (!row) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '템플릿을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    res.json({ data: row, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/', requireAuth, requireMessagingManage, async (req, res) => {
    const parsed = parseBody(createSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [created] = await db
      .insert(messageTemplates)
      .values({ ...parsed, allowedRoles: parsed.allowedRoles ?? [], createdBy: req.admin!.id, updatedBy: req.admin!.id })
      .returning();

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'messageTemplate.create',
      targetType: 'messageTemplate',
      targetId: created!.id,
      beforeDataSafe: null,
      afterDataSafe: { name: created!.name, messageType: created!.messageType },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/:id', requireAuth, requireMessagingManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const parsed = parseBody(updateSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(messageTemplates).where(and(eq(messageTemplates.id, id), isNull(messageTemplates.deletedAt)));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '템플릿을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const [updated] = await db
      .update(messageTemplates)
      .set({ ...parsed, updatedAt: new Date(), updatedBy: req.admin!.id })
      .where(eq(messageTemplates.id, id))
      .returning();

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'messageTemplate.update',
      targetType: 'messageTemplate',
      targetId: id,
      beforeDataSafe: { name: before.name, body: before.body },
      afterDataSafe: parsed,
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/copy', requireAuth, requireMessagingManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const [source] = await db
      .select()
      .from(messageTemplates)
      .where(and(eq(messageTemplates.id, id), isNull(messageTemplates.deletedAt)));
    if (!source) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '템플릿을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const [copy] = await db
      .insert(messageTemplates)
      .values({
        name: `${source.name} 사본`,
        category: source.category,
        messageType: source.messageType,
        body: source.body,
        description: source.description,
        defaultMediaId: source.defaultMediaId,
        allowedRoles: source.allowedRoles,
        status: 'active',
        createdBy: req.admin!.id,
        updatedBy: req.admin!.id,
      })
      .returning();

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'messageTemplate.copy',
      targetType: 'messageTemplate',
      targetId: copy!.id,
      beforeDataSafe: null,
      afterDataSafe: { sourceId: source.id, name: copy!.name },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: copy, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.delete('/:id', requireAuth, requireMessagingManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const [before] = await db.select().from(messageTemplates).where(and(eq(messageTemplates.id, id), isNull(messageTemplates.deletedAt)));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '템플릿을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    await db
      .update(messageTemplates)
      .set({ deletedAt: new Date(), status: 'inactive', updatedAt: new Date(), updatedBy: req.admin!.id })
      .where(eq(messageTemplates.id, id));

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'messageTemplate.delete',
      targetType: 'messageTemplate',
      targetId: id,
      beforeDataSafe: { name: before.name },
      afterDataSafe: null,
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: { id, status: 'deleted' }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
