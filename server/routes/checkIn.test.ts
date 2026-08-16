import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { students, gradeLevels, checkIns, studentCheckinPhones } from '@shared/schema';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const TEST_GRADE_NAME = 'test-checkin-grade';
const TEST_STUDENT_NAME = 'test-checkin-학생';
const TEST_STUDENT_PHONE = '01099990000';

async function seedStudent() {
  const [grade] = await db.insert(gradeLevels).values({ name: TEST_GRADE_NAME, sortOrder: 0 }).returning();
  const [student] = await db
    .insert(students)
    .values({
      name: TEST_STUDENT_NAME,
      phoneNormalized: TEST_STUDENT_PHONE,
      gradeLevelId: grade!.id,
      registrationDate: '2026-08-16',
      statusEffectiveDate: '2026-08-16',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  await db.insert(studentCheckinPhones).values({
    studentId: student!.id,
    sourceType: 'student',
    sourceId: student!.id,
    phoneNormalized: TEST_STUDENT_PHONE,
    phoneLast4: TEST_STUDENT_PHONE.slice(-4),
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { studentId: student!.id };
}

async function cleanup() {
  const testStudents = await db.select({ id: students.id }).from(students).where(eq(students.name, TEST_STUDENT_NAME));
  for (const s of testStudents) {
    await db.delete(checkIns).where(eq(checkIns.studentId, s.id));
    await db.delete(studentCheckinPhones).where(eq(studentCheckinPhones.studentId, s.id));
  }
  await db.delete(students).where(eq(students.name, TEST_STUDENT_NAME));
  await db.delete(gradeLevels).where(eq(gradeLevels.name, TEST_GRADE_NAME));
}

describe('public check-in routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('returns no_match for an unknown last-4', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).post('/api/check-in/search').send({ last4: '0000' });
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('no_match');
  });

  it('returns a masked candidate and confirms a check-in', async () => {
    const { studentId } = await seedStudent();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });

    const search = await request(app).post('/api/check-in/search').send({ last4: '0000' });
    expect(search.status).toBe(200);
    expect(search.body.data.status).toBe('candidates');
    expect(search.body.data.candidates).toHaveLength(1);
    expect(search.body.data.candidates[0].maskedName).toBe('t*************생');
    expect(search.body.data.candidates[0]).not.toHaveProperty('phoneNormalized');
    expect(search.body.data.candidates[0]).not.toHaveProperty('studentId');

    const confirm = await request(app)
      .post('/api/check-in/confirm')
      .send({ selectionToken: search.body.data.candidates[0].selectionToken });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.status).toBe('confirmed');

    const rows = await db.select().from(checkIns).where(eq(checkIns.studentId, studentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe('kiosk');
    expect(rows[0]!.status).toBe('active');
  });

  it('rejects a second confirm the same day with already_checked_in', async () => {
    await seedStudent();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });

    const firstSearch = await request(app).post('/api/check-in/search').send({ last4: '0000' });
    await request(app).post('/api/check-in/confirm').send({ selectionToken: firstSearch.body.data.candidates[0].selectionToken });

    const secondSearch = await request(app).post('/api/check-in/search').send({ last4: '0000' });
    const secondConfirm = await request(app)
      .post('/api/check-in/confirm')
      .send({ selectionToken: secondSearch.body.data.candidates[0].selectionToken });

    expect(secondConfirm.status).toBe(409);
    expect(secondConfirm.body.error.code).toBe('DUPLICATE_CHECKIN');
  });

  it('rejects an expired or invalid selection token', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).post('/api/check-in/confirm').send({ selectionToken: 'garbage-not-a-real-token' });
    expect(response.status).toBe(410);
    expect(response.body.error.code).toBe('SELECTION_EXPIRED');
  });

  it('rejects a malformed last4', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).post('/api/check-in/search').send({ last4: 'abcd' });
    expect(response.status).toBe(400);
  });
});
