import { and, count, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import { getNowKSTISOString, getTodayKST } from '@shared/kst';
import { db } from '../db';
import { students, enrollments, checkIns, messageCampaigns, cardNewsProjects } from '@shared/schema';
import { createRequireAuth } from '../middleware/auth';

export interface DashboardRouterDeps {
  sessionSecret: string;
}

export function createDashboardRouter(deps: DashboardRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);

  router.get('/', requireAuth, async (req, res) => {
    const today = getTodayKST();
    const todayStart = new Date(`${today}T00:00:00+09:00`);

    const [[activeStudents], [activeEnrollments], [todayCheckIns], [pendingMessages], [todayUsage], [activeCardNews]] = await Promise.all([
      db.select({ value: count() }).from(students).where(and(eq(students.status, 'enrolled'), isNull(students.deletedAt))),
      db.select({ value: count() }).from(enrollments).where(eq(enrollments.status, 'active')),
      db.select({ value: count() }).from(checkIns).where(and(eq(checkIns.checkInDate, today), eq(checkIns.status, 'active'))),
      db.select({ value: count() }).from(messageCampaigns).where(inArray(messageCampaigns.status, ['queued', 'scheduled', 'dispatching'])),
      db
        .select({ value: sql<number>`coalesce(sum(${messageCampaigns.totalSendItems}), 0)` })
        .from(messageCampaigns)
        .where(and(gte(messageCampaigns.approvedAt, todayStart), sql`${messageCampaigns.status} not in ('canceled', 'failed')`)),
      db.select({ value: count() }).from(cardNewsProjects).where(and(isNull(cardNewsProjects.deletedAt), sql`${cardNewsProjects.status} != 'deleted'`)),
    ]);

    res.json({
      data: {
        activeStudentCount: activeStudents?.value ?? 0,
        activeEnrollmentCount: activeEnrollments?.value ?? 0,
        todayCheckInCount: todayCheckIns?.value ?? 0,
        pendingMessageCampaignCount: pendingMessages?.value ?? 0,
        todayMessageSendItemCount: Number(todayUsage?.value ?? 0),
        dailyMessageLimit: 500,
        activeCardNewsProjectCount: activeCardNews?.value ?? 0,
      },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  return router;
}
