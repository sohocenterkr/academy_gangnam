import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db';
import { students, guardians, studentGuardians, enrollments, optOuts } from '@shared/schema';
import { renderMessageBody } from '../utils/messageTemplate';

export type RecipientType = 'all' | 'grade' | 'course' | 'individual';
export type DuplicateStrategy = 'merge' | 'separate';

export interface RecipientFilter {
  gradeLevelId?: string;
  courseId?: string;
  studentIds?: string[];
}

export interface ResolvedRecipient {
  studentIds: string[];
  studentNames: string[];
  guardianId: string | null;
  phoneNormalized: string;
  relationshipSnapshot: string | null;
  isOptedOut: boolean;
  status: 'included' | 'excluded';
  exclusionReason: string | null;
  renderedBody: string;
}

interface Candidate {
  studentId: string;
  studentName: string;
  guardianId: string | null;
  guardianName: string | null;
  relationship: string | null;
  phoneNormalized: string;
}

async function findTargetStudents(recipientType: RecipientType, filter: RecipientFilter) {
  if (recipientType === 'all') {
    return db.select().from(students).where(and(eq(students.status, 'enrolled'), isNull(students.deletedAt)));
  }
  if (recipientType === 'grade') {
    if (!filter.gradeLevelId) return [];
    return db
      .select()
      .from(students)
      .where(and(eq(students.status, 'enrolled'), isNull(students.deletedAt), eq(students.gradeLevelId, filter.gradeLevelId)));
  }
  if (recipientType === 'course') {
    if (!filter.courseId) return [];
    const activeEnrollments = await db
      .select({ studentId: enrollments.studentId })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, filter.courseId), eq(enrollments.status, 'active')));
    const studentIds = [...new Set(activeEnrollments.map((row) => row.studentId))];
    if (studentIds.length === 0) return [];
    return db
      .select()
      .from(students)
      .where(and(eq(students.status, 'enrolled'), isNull(students.deletedAt), inArray(students.id, studentIds)));
  }
  if (recipientType === 'individual') {
    if (!filter.studentIds || filter.studentIds.length === 0) return [];
    return db
      .select()
      .from(students)
      .where(and(isNull(students.deletedAt), inArray(students.id, filter.studentIds)));
  }
  return [];
}

/**
 * Resolves a campaign's recipient_type/filter into actual guardian phone numbers, applies the
 * admin's chosen duplicate_strategy for guardians shared across siblings, and marks opted-out
 * numbers excluded by default. Recomputed fresh on every preview/validate/approve call rather
 * than cached, per spec's "refresh-triggered, no auto-polling" rule.
 */
export async function resolveRecipients(
  recipientType: RecipientType,
  filter: RecipientFilter,
  duplicateStrategy: DuplicateStrategy,
  bodyTemplate: string,
  includeOptedOut: boolean
): Promise<ResolvedRecipient[]> {
  const targetStudents = await findTargetStudents(recipientType, filter);
  if (targetStudents.length === 0) return [];

  const studentIds = targetStudents.map((s) => s.id);
  const links = await db
    .select({
      studentId: studentGuardians.studentId,
      guardianId: studentGuardians.guardianId,
      relationship: studentGuardians.relationship,
      guardianName: guardians.name,
      guardianPhone: guardians.phoneNormalized,
    })
    .from(studentGuardians)
    .innerJoin(guardians, eq(studentGuardians.guardianId, guardians.id))
    .where(and(inArray(studentGuardians.studentId, studentIds), eq(studentGuardians.receiveMessages, true), isNull(guardians.deletedAt)));

  const linksByStudent = new Map<string, typeof links>();
  for (const link of links) {
    const list = linksByStudent.get(link.studentId) ?? [];
    list.push(link);
    linksByStudent.set(link.studentId, list);
  }

  const candidates: Candidate[] = [];
  for (const student of targetStudents) {
    const studentLinks = linksByStudent.get(student.id) ?? [];
    if (studentLinks.length === 0) {
      // No guardian opted in to receive messages — fall back to the student's own phone.
      candidates.push({ studentId: student.id, studentName: student.name, guardianId: null, guardianName: null, relationship: null, phoneNormalized: student.phoneNormalized });
      continue;
    }
    for (const link of studentLinks) {
      candidates.push({
        studentId: student.id,
        studentName: student.name,
        guardianId: link.guardianId,
        guardianName: link.guardianName,
        relationship: link.relationship,
        phoneNormalized: link.guardianPhone,
      });
    }
  }

  const optedOutPhones = new Set(
    (
      await db
        .select({ phoneNormalized: optOuts.phoneNormalized })
        .from(optOuts)
        .where(eq(optOuts.status, 'active'))
    ).map((row) => row.phoneNormalized)
  );

  const byPhone = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const list = byPhone.get(candidate.phoneNormalized) ?? [];
    list.push(candidate);
    byPhone.set(candidate.phoneNormalized, list);
  }

  const resolved: ResolvedRecipient[] = [];
  for (const [phone, group] of byPhone) {
    const isOptedOut = optedOutPhones.has(phone);
    const groups = duplicateStrategy === 'merge' ? [group] : group.map((c) => [c]);

    for (const g of groups) {
      const studentNames = g.map((c) => c.studentName);
      const renderedBody = renderMessageBody(bodyTemplate, { 이름: studentNames.join(', ') });
      const excluded = isOptedOut && !includeOptedOut;
      resolved.push({
        studentIds: g.map((c) => c.studentId),
        studentNames,
        guardianId: g[0]!.guardianId,
        phoneNormalized: phone,
        relationshipSnapshot: g[0]!.relationship,
        isOptedOut,
        status: excluded ? 'excluded' : 'included',
        exclusionReason: excluded ? 'opt_out' : null,
        renderedBody,
      });
    }
  }

  return resolved;
}
