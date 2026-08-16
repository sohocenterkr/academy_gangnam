import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { studentCheckinPhones } from '@shared/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function last4(phoneNormalized: string): string {
  return phoneNormalized.slice(-4);
}

/**
 * Upserts the single `source_type = 'student'` row for a student's own check-in-searchable
 * phone. A student's own phone is always check-in-eligible (unlike a guardian's, which is
 * gated by `student_guardians.use_for_checkin`), so this never needs an `isActive` argument.
 * Uses atomic onConflictDoUpdate to prevent concurrent-upsert race conditions.
 */
export async function syncStudentOwnPhone(tx: Tx, studentId: string, phoneNormalized: string): Promise<void> {
  await tx
    .insert(studentCheckinPhones)
    .values({
      studentId,
      sourceType: 'student',
      sourceId: studentId,
      phoneNormalized,
      phoneLast4: last4(phoneNormalized),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [studentCheckinPhones.studentId, studentCheckinPhones.sourceType, studentCheckinPhones.sourceId],
      set: { phoneNormalized, phoneLast4: last4(phoneNormalized), updatedAt: new Date() },
    });
}

/**
 * Updates every `source_type = 'guardian'` row for this guardian, across every student they're
 * linked to (a guardian can be a sibling's shared contact) — called whenever a guardian's own
 * phone number changes.
 */
export async function syncGuardianPhone(tx: Tx, guardianId: string, phoneNormalized: string): Promise<void> {
  await tx
    .update(studentCheckinPhones)
    .set({ phoneNormalized, phoneLast4: last4(phoneNormalized), updatedAt: new Date() })
    .where(and(eq(studentCheckinPhones.sourceType, 'guardian'), eq(studentCheckinPhones.sourceId, guardianId)));
}

/**
 * Upserts the `source_type = 'guardian'` row for one specific student+guardian link — called
 * when a link is created, or when its `use_for_checkin` flag is toggled. `isActive` mirrors
 * the link's `use_for_checkin` value directly.
 * Uses atomic onConflictDoUpdate to prevent concurrent-upsert race conditions.
 */
export async function upsertGuardianLinkPhone(
  tx: Tx,
  studentId: string,
  guardianId: string,
  phoneNormalized: string,
  isActive: boolean
): Promise<void> {
  await tx
    .insert(studentCheckinPhones)
    .values({
      studentId,
      sourceType: 'guardian',
      sourceId: guardianId,
      phoneNormalized,
      phoneLast4: last4(phoneNormalized),
      isActive,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [studentCheckinPhones.studentId, studentCheckinPhones.sourceType, studentCheckinPhones.sourceId],
      set: { phoneNormalized, phoneLast4: last4(phoneNormalized), isActive, updatedAt: new Date() },
    });
}

/** Removes the `source_type = 'guardian'` row for a link that was unlinked/deleted entirely. */
export async function removeGuardianLinkPhone(tx: Tx, studentId: string, guardianId: string): Promise<void> {
  await tx
    .delete(studentCheckinPhones)
    .where(
      and(
        eq(studentCheckinPhones.studentId, studentId),
        eq(studentCheckinPhones.sourceType, 'guardian'),
        eq(studentCheckinPhones.sourceId, guardianId)
      )
    );
}
