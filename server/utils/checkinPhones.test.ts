import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { students, guardians, gradeLevels, studentCheckinPhones } from '@shared/schema';
import {
  syncStudentOwnPhone,
  syncGuardianPhone,
  upsertGuardianLinkPhone,
  removeGuardianLinkPhone,
} from './checkinPhones';

const TEST_GRADE_NAME = `test-checkinphones-grade-${Date.now()}`;
let testGradeId: string;
let testStudentId: string;
let testGuardianId: string;

async function seedStudentAndGuardian() {
  const [grade] = await db.insert(gradeLevels).values({ name: TEST_GRADE_NAME, sortOrder: 0 }).returning();
  testGradeId = grade!.id;
  const [student] = await db
    .insert(students)
    .values({
      name: 'test-checkinphones-학생',
      phoneNormalized: '01011110000',
      gradeLevelId: grade!.id,
      registrationDate: '2026-08-16',
      statusEffectiveDate: '2026-08-16',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  testStudentId = student!.id;
  const [guardian] = await db
    .insert(guardians)
    .values({ name: 'test-checkinphones-보호자', phoneNormalized: '01022220000', createdAt: new Date(), updatedAt: new Date() })
    .returning();
  testGuardianId = guardian!.id;
  return { studentId: student!.id, guardianId: guardian!.id };
}

async function cleanup() {
  // Delete in reverse FK dependency order
  if (testStudentId) {
    await db.delete(studentCheckinPhones).where(eq(studentCheckinPhones.studentId, testStudentId));
    await db.delete(students).where(eq(students.id, testStudentId));
  }
  if (testGuardianId) {
    await db.delete(guardians).where(eq(guardians.id, testGuardianId));
  }
  if (testGradeId) {
    await db.delete(gradeLevels).where(eq(gradeLevels.id, testGradeId));
  }
}

describe('checkinPhones sync helpers', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('syncStudentOwnPhone inserts then updates the student-source row', async () => {
    const { studentId } = await seedStudentAndGuardian();

    await db.transaction((tx) => syncStudentOwnPhone(tx, studentId, '01011110000'));
    let rows = await db.select().from(studentCheckinPhones).where(eq(studentCheckinPhones.studentId, studentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourceType).toBe('student');
    expect(rows[0]!.phoneLast4).toBe('0000');

    await db.transaction((tx) => syncStudentOwnPhone(tx, studentId, '01099998888'));
    rows = await db.select().from(studentCheckinPhones).where(eq(studentCheckinPhones.studentId, studentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.phoneNormalized).toBe('01099998888');
    expect(rows[0]!.phoneLast4).toBe('8888');
  });

  it('upsertGuardianLinkPhone inserts, then removeGuardianLinkPhone deletes', async () => {
    const { studentId, guardianId } = await seedStudentAndGuardian();

    await db.transaction((tx) => upsertGuardianLinkPhone(tx, studentId, guardianId, '01022220000', true));
    let rows = await db
      .select()
      .from(studentCheckinPhones)
      .where(eq(studentCheckinPhones.studentId, studentId));
    expect(rows.filter((r) => r.sourceType === 'guardian')).toHaveLength(1);

    await db.transaction((tx) => removeGuardianLinkPhone(tx, studentId, guardianId));
    rows = await db.select().from(studentCheckinPhones).where(eq(studentCheckinPhones.studentId, studentId));
    expect(rows.filter((r) => r.sourceType === 'guardian')).toHaveLength(0);
  });

  it('upsertGuardianLinkPhone with isActive=false does not create a searchable row', async () => {
    const { studentId, guardianId } = await seedStudentAndGuardian();

    await db.transaction((tx) => upsertGuardianLinkPhone(tx, studentId, guardianId, '01022220000', false));
    const rows = await db
      .select()
      .from(studentCheckinPhones)
      .where(eq(studentCheckinPhones.studentId, studentId));
    const guardianRow = rows.find((r) => r.sourceType === 'guardian');
    expect(guardianRow?.isActive).toBe(false);
  });

  it('syncGuardianPhone updates every row for that guardian across all linked students', async () => {
    const { studentId, guardianId } = await seedStudentAndGuardian();
    await db.transaction((tx) => upsertGuardianLinkPhone(tx, studentId, guardianId, '01022220000', true));

    await db.transaction((tx) => syncGuardianPhone(tx, guardianId, '01077776666'));
    const rows = await db
      .select()
      .from(studentCheckinPhones)
      .where(eq(studentCheckinPhones.sourceId, guardianId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.phoneNormalized).toBe('01077776666');
    expect(rows[0]!.phoneLast4).toBe('6666');
  });

  it('syncStudentOwnPhone is atomic: concurrent calls do not produce duplicate rows', async () => {
    const { studentId } = await seedStudentAndGuardian();

    // Fire two concurrent calls for the same student — both should upsert to the same row
    await Promise.all([
      db.transaction((tx) => syncStudentOwnPhone(tx, studentId, '01011110000')),
      db.transaction((tx) => syncStudentOwnPhone(tx, studentId, '01099998888')),
    ]);

    // Verify exactly one row exists (not duplicates)
    const rows = await db.select().from(studentCheckinPhones).where(eq(studentCheckinPhones.studentId, studentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourceType).toBe('student');
  });

  it('upsertGuardianLinkPhone is atomic: concurrent calls do not produce duplicate rows', async () => {
    const { studentId, guardianId } = await seedStudentAndGuardian();

    // Fire two concurrent calls for the same student+guardian link
    await Promise.all([
      db.transaction((tx) => upsertGuardianLinkPhone(tx, studentId, guardianId, '01022220000', true)),
      db.transaction((tx) => upsertGuardianLinkPhone(tx, studentId, guardianId, '01077776666', false)),
    ]);

    // Verify exactly one row exists (not duplicates)
    const rows = await db
      .select()
      .from(studentCheckinPhones)
      .where(
        and(
          eq(studentCheckinPhones.studentId, studentId),
          eq(studentCheckinPhones.sourceType, 'guardian'),
          eq(studentCheckinPhones.sourceId, guardianId)
        )
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourceType).toBe('guardian');
  });
});
