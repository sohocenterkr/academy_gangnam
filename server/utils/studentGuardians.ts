import { and, eq, ne } from 'drizzle-orm';
import { db } from '../db';
import { studentGuardians } from '@shared/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Unsets `isPrimary` on whichever guardian link currently holds the primary slot for a
 * student, excluding `excludeId` (the row this same transaction is about to insert/update) so
 * a losing request in a concurrent race can never unset the winning request's own row out
 * from under it. Scoped to `isPrimary = true` so it only touches the one row that was actually
 * primary, rather than bumping `updatedAt` on every sibling link for that student (which
 * would spuriously invalidate other links' optimistic-locking tokens).
 */
export async function unsetOtherPrimaryGuardians(tx: Tx, studentId: string, excludeId?: string): Promise<void> {
  const conditions = [eq(studentGuardians.studentId, studentId), eq(studentGuardians.isPrimary, true)];
  if (excludeId) {
    conditions.push(ne(studentGuardians.id, excludeId));
  }
  await tx.update(studentGuardians).set({ isPrimary: false, updatedAt: new Date() }).where(and(...conditions));
}
