import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  checkIns,
  students,
  gradeLevels,
  courses,
  enrollments,
  messageCampaigns,
  cardNewsProjects,
} from '@shared/schema';

export interface DateRange {
  from?: string;
  to?: string;
}

export async function getCheckInReport(range: DateRange) {
  const conditions = [eq(checkIns.status, 'active')];
  if (range.from) conditions.push(gte(checkIns.checkInDate, range.from));
  if (range.to) conditions.push(lte(checkIns.checkInDate, range.to));

  const bySource = await db
    .select({ source: checkIns.source, count: sql<number>`count(*)` })
    .from(checkIns)
    .where(and(...conditions))
    .groupBy(checkIns.source);

  const byDate = await db
    .select({ date: checkIns.checkInDate, count: sql<number>`count(*)` })
    .from(checkIns)
    .where(and(...conditions))
    .groupBy(checkIns.checkInDate)
    .orderBy(checkIns.checkInDate);

  return {
    bySource: bySource.map((r) => ({ source: r.source, count: Number(r.count) })),
    byDate: byDate.map((r) => ({ date: r.date, count: Number(r.count) })),
  };
}

export async function getStudentReport() {
  const byStatus = await db
    .select({ status: students.status, count: sql<number>`count(*)` })
    .from(students)
    .where(isNull(students.deletedAt))
    .groupBy(students.status);

  const byGrade = await db
    .select({ gradeName: gradeLevels.name, count: sql<number>`count(*)` })
    .from(students)
    .innerJoin(gradeLevels, eq(students.gradeLevelId, gradeLevels.id))
    .where(and(isNull(students.deletedAt), eq(students.status, 'enrolled')))
    .groupBy(gradeLevels.name);

  return {
    byStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.count) })),
    byGrade: byGrade.map((r) => ({ gradeName: r.gradeName, count: Number(r.count) })),
  };
}

export async function getCourseReport() {
  const rows = await db
    .select({
      courseId: courses.id,
      courseName: courses.name,
      courseStatus: courses.status,
      activeEnrollmentCount: sql<number>`count(${enrollments.id}) filter (where ${enrollments.status} = 'active')`,
    })
    .from(courses)
    .leftJoin(enrollments, eq(enrollments.courseId, courses.id))
    .where(isNull(courses.deletedAt))
    .groupBy(courses.id, courses.name, courses.status)
    .orderBy(courses.name);

  return rows.map((r) => ({ ...r, activeEnrollmentCount: Number(r.activeEnrollmentCount) }));
}

export async function getMessageReport(range: DateRange) {
  const conditions = [];
  if (range.from) conditions.push(gte(messageCampaigns.createdAt, new Date(range.from)));
  if (range.to) conditions.push(lte(messageCampaigns.createdAt, new Date(range.to)));

  const byStatus = await db
    .select({
      status: messageCampaigns.status,
      campaignCount: sql<number>`count(*)`,
      totalSendItems: sql<number>`coalesce(sum(${messageCampaigns.totalSendItems}), 0)`,
      totalFailed: sql<number>`coalesce(sum(${messageCampaigns.failedCount}), 0)`,
      totalExcluded: sql<number>`coalesce(sum(${messageCampaigns.excludedCount}), 0)`,
    })
    .from(messageCampaigns)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(messageCampaigns.status);

  return byStatus.map((r) => ({
    status: r.status,
    campaignCount: Number(r.campaignCount),
    totalSendItems: Number(r.totalSendItems),
    totalFailed: Number(r.totalFailed),
    totalExcluded: Number(r.totalExcluded),
  }));
}

export async function getCardNewsReport() {
  const byStatus = await db
    .select({ status: cardNewsProjects.status, count: sql<number>`count(*)` })
    .from(cardNewsProjects)
    .where(isNull(cardNewsProjects.deletedAt))
    .groupBy(cardNewsProjects.status);

  return byStatus.map((r) => ({ status: r.status, count: Number(r.count) }));
}
