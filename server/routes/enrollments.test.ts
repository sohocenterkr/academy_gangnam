import { eq, like } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, courses, students, gradeLevels, enrollments, auditLogs } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-enrollments-super@example.com';
const PASSWORD = 'test-enrollments-password-123';
const CODE_PREFIX = 'test-enrollments-';
const TEST_STUDENT_NAME = 'test-enrollment-학생';
const TEST_GRADE_NAME = 'test-enrollments-grade';

async function seedFixtures() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-enrollments-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
    .returning();
  await db.insert(admins).values({
    email: SUPER_EMAIL,
    name: '수퍼',
    passwordHash: await hashPassword(PASSWORD),
    roleId: role!.id,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [grade] = await db.insert(gradeLevels).values({ name: TEST_GRADE_NAME, sortOrder: 0 }).returning();
  const [student] = await db
    .insert(students)
    .values({
      name: TEST_STUDENT_NAME,
      phoneNormalized: '010-1111-2222',
      gradeLevelId: grade!.id,
      registrationDate: '2026-01-01',
      statusEffectiveDate: '2026-01-01',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  const [course] = await db
    .insert(courses)
    .values({ code: `${CODE_PREFIX}course-1`, name: '테스트반', createdAt: new Date(), updatedAt: new Date() })
    .returning();
  return { studentId: student!.id, courseId: course!.id };
}

async function loginAs(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('login did not return a session cookie');
  return cookie;
}

async function cleanup() {
  const testStudents = await db.select({ id: students.id }).from(students).where(like(students.name, 'test-enrollment-%'));
  for (const s of testStudents) {
    await db.delete(enrollments).where(eq(enrollments.studentId, s.id));
  }
  await db.delete(students).where(like(students.name, 'test-enrollment-%'));
  await db.delete(courses).where(like(courses.code, `${CODE_PREFIX}%`));
  await db.delete(gradeLevels).where(eq(gradeLevels.name, TEST_GRADE_NAME));

  const adminToDelete = await db.query.admins.findFirst({ where: eq(admins.email, SUPER_EMAIL) });
  if (adminToDelete) {
    const { authSessions, passwordResetTokens } = await import('@shared/schema');
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-enrollments-role'));
}

describe('enrollments routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/enrollments');
    expect(response.status).toBe(401);
  });

  it('creates an enrollment with default active status', async () => {
    const { studentId, courseId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/enrollments')
      .set('Cookie', cookie)
      .send({ studentId, courseId, startDate: '2026-01-01', plannedEndDate: '2026-03-31' });

    expect(created.status).toBe(200);
    expect(created.body.data.status).toBe('active');
    expect(created.body.data.studentId).toBe(studentId);
  });

  it('rejects an overlapping enrollment without confirmOverlap, and accepts it with confirmOverlap', async () => {
    const { studentId, courseId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const first = await request(app)
      .post('/api/enrollments')
      .set('Cookie', cookie)
      .send({ studentId, courseId, startDate: '2026-01-01', plannedEndDate: '2026-03-31' });
    expect(first.status).toBe(200);

    const overlapping = await request(app)
      .post('/api/enrollments')
      .set('Cookie', cookie)
      .send({ studentId, courseId, startDate: '2026-02-01', plannedEndDate: '2026-06-30' });
    expect(overlapping.status).toBe(409);
    expect(overlapping.body.error.code).toBe('PERIOD_OVERLAP');
    const conflictIds: string[] = overlapping.body.data.conflicts.map((c: { id: string }) => c.id);
    expect(conflictIds).toContain(first.body.data.id);

    const confirmed = await request(app)
      .post('/api/enrollments')
      .set('Cookie', cookie)
      .send({ studentId, courseId, startDate: '2026-02-01', plannedEndDate: '2026-06-30', confirmOverlap: true });
    expect(confirmed.status).toBe(200);

    const all = await db.select().from(enrollments).where(eq(enrollments.studentId, studentId));
    expect(all.length).toBe(2);
  });

  it('does not flag a genuinely non-overlapping date range', async () => {
    const { studentId, courseId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const first = await request(app)
      .post('/api/enrollments')
      .set('Cookie', cookie)
      .send({ studentId, courseId, startDate: '2026-01-01', plannedEndDate: '2026-03-31' });
    expect(first.status).toBe(200);

    const nonOverlapping = await request(app)
      .post('/api/enrollments')
      .set('Cookie', cookie)
      .send({ studentId, courseId, startDate: '2026-04-01', plannedEndDate: '2026-06-30' });
    expect(nonOverlapping.status).toBe(200);
  });

  it('updates an enrollment atomically and rejects a stale update', async () => {
    const { studentId, courseId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/enrollments')
      .set('Cookie', cookie)
      .send({ studentId, courseId, startDate: '2026-01-01', tuitionAmount: 100000 });

    const updated = await request(app)
      .patch(`/api/enrollments/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ tuitionAmount: 150000, expectedUpdatedAt: created.body.data.updatedAt });
    expect(updated.status).toBe(200);
    expect(updated.body.data.tuitionAmount).toBe(150000);

    const stale = await request(app)
      .patch(`/api/enrollments/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ tuitionAmount: 999999, expectedUpdatedAt: created.body.data.updatedAt });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('ends an enrollment, setting status to ended and actualEndDate to today', async () => {
    const { studentId, courseId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/enrollments')
      .set('Cookie', cookie)
      .send({ studentId, courseId, startDate: '2026-01-01' });

    const ended = await request(app).post(`/api/enrollments/${created.body.data.id}/end`).set('Cookie', cookie).send({});
    expect(ended.status).toBe(200);
    expect(ended.body.data.status).toBe('ended');
    expect(ended.body.data.actualEndDate).toBeTruthy();
  });

  it('rejects a PATCH that moves an enrollment into overlap with another, and accepts it with confirmOverlap', async () => {
    const { studentId, courseId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const first = await request(app)
      .post('/api/enrollments')
      .set('Cookie', cookie)
      .send({ studentId, courseId, startDate: '2026-01-01', plannedEndDate: '2026-03-31' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/enrollments')
      .set('Cookie', cookie)
      .send({ studentId, courseId, startDate: '2026-04-01', plannedEndDate: '2026-06-30' });
    expect(second.status).toBe(200);

    const patchOverlap = await request(app)
      .patch(`/api/enrollments/${second.body.data.id}`)
      .set('Cookie', cookie)
      .send({ startDate: '2026-02-01', expectedUpdatedAt: second.body.data.updatedAt });
    expect(patchOverlap.status).toBe(409);
    expect(patchOverlap.body.error.code).toBe('PERIOD_OVERLAP');

    const patchConfirmed = await request(app)
      .patch(`/api/enrollments/${second.body.data.id}`)
      .set('Cookie', cookie)
      .send({ startDate: '2026-02-01', confirmOverlap: true, expectedUpdatedAt: second.body.data.updatedAt });
    expect(patchConfirmed.status).toBe(200);
    expect(patchConfirmed.body.data.startDate).toBe('2026-02-01');
  });

  it('sets actualEndDate to today when PATCH transitions status to ended directly (not via /end)', async () => {
    const { studentId, courseId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/enrollments')
      .set('Cookie', cookie)
      .send({ studentId, courseId, startDate: '2026-01-01' });

    const patched = await request(app)
      .patch(`/api/enrollments/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ status: 'ended', expectedUpdatedAt: created.body.data.updatedAt });
    expect(patched.status).toBe(200);
    expect(patched.body.data.status).toBe('ended');
    expect(patched.body.data.actualEndDate).toBeTruthy();
  });

  it('cancels an enrollment, setting status to canceled', async () => {
    const { studentId, courseId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/enrollments')
      .set('Cookie', cookie)
      .send({ studentId, courseId, startDate: '2026-01-01' });

    const canceled = await request(app).post(`/api/enrollments/${created.body.data.id}/cancel`).set('Cookie', cookie).send({});
    expect(canceled.status).toBe(200);
    expect(canceled.body.data.status).toBe('canceled');
  });

  it('lists enrollments filtered by studentId', async () => {
    const { studentId, courseId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/enrollments')
      .set('Cookie', cookie)
      .send({ studentId, courseId, startDate: '2026-01-01' });
    expect(created.status).toBe(200);

    const list = await request(app).get('/api/enrollments').query({ studentId }).set('Cookie', cookie);
    expect(list.status).toBe(200);
    const ids: string[] = list.body.data.map((row: { id: string }) => row.id);
    expect(ids).toContain(created.body.data.id);
  });

  it('returns the full enrollment history for a student via GET /api/students/:id/enrollments, including ended/canceled', async () => {
    const { studentId, courseId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/enrollments')
      .set('Cookie', cookie)
      .send({ studentId, courseId, startDate: '2026-01-01' });
    const ended = await request(app).post(`/api/enrollments/${created.body.data.id}/end`).set('Cookie', cookie).send({});
    expect(ended.status).toBe(200);

    const history = await request(app).get(`/api/students/${studentId}/enrollments`).set('Cookie', cookie);
    expect(history.status).toBe(200);
    const ids: string[] = history.body.data.map((row: { id: string }) => row.id);
    expect(ids).toContain(created.body.data.id);
    const found = history.body.data.find((row: { id: string }) => row.id === created.body.data.id);
    expect(found.status).toBe('ended');
  });
});
