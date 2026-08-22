import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { getCheckInReport, getStudentReport, getCourseReport, getMessageReport, getCardNewsReport } from '../services/reports';

const dateRangeSchema = z.object({ from: z.string().optional(), to: z.string().optional() });

export interface ReportsRouterDeps {
  sessionSecret: string;
}

export function createReportsRouter(deps: ReportsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireAuditView = createRequirePermission(PERMISSIONS.AUDIT_VIEW);

  router.get('/check-ins', requireAuth, requireAuditView, async (req, res) => {
    const query = dateRangeSchema.safeParse(req.query);
    const data = await getCheckInReport(query.success ? query.data : {});
    res.json({ data, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.get('/students', requireAuth, requireAuditView, async (req, res) => {
    const data = await getStudentReport();
    res.json({ data, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.get('/courses', requireAuth, requireAuditView, async (req, res) => {
    const data = await getCourseReport();
    res.json({ data, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.get('/messages', requireAuth, requireAuditView, async (req, res) => {
    const query = dateRangeSchema.safeParse(req.query);
    const data = await getMessageReport(query.success ? query.data : {});
    res.json({ data, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.get('/card-news', requireAuth, requireAuditView, async (req, res) => {
    const data = await getCardNewsReport();
    res.json({ data, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
