import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, students, gradeLevels, checkIns, checkInChangeLogs } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-checkins-super@example.com';
const PASSWORD = 'test-checkins-password-123';
const TEST_GRADE_NAME = 'test-checkins-grade';
const TEST_STUDENT_NAME = 'test-checkins-학생';

async function seedFixtures() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-checkins-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
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
      phoneNormalized: '01099991111',
      gradeLevelId: grade!.id,
      registrationDate: '2026-08-16',
      statusEffectiveDate: '2026-08-16',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return { studentId: student!.id };
}

async function loginAs(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('login did not return a session cookie');
  return cookie;
}

async function cleanup() {
  const testStudents = await db.select({ id: students.id }).from(students).where(eq(students.name, TEST_STUDENT_NAME));
  for (const s of testStudents) {
    const testCheckIns = await db.select({ id: checkIns.id }).from(checkIns).where(eq(checkIns.studentId, s.id));
    for (const c of testCheckIns) {
      await db.delete(checkInChangeLogs).where(eq(checkInChangeLogs.checkInId, c.id));
    }
    await db.delete(checkIns).where(eq(checkIns.studentId, s.id));
  }
  await db.delete(students).where(eq(students.name, TEST_STUDENT_NAME));
  await db.delete(gradeLevels).where(eq(gradeLevels.name, TEST_GRADE_NAME));

  const adminToDelete = await db.query.admins.findFirst({ where: eq(admins.email, SUPER_EMAIL) });
  if (adminToDelete) {
    const { auditLogs, authSessions, passwordResetTokens } = await import('@shared/schema');
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-checkins-role'));
}

describe('admin check-ins routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/check-ins');
    expect(response.status).toBe(401);
  });

  it('creates a manual check-in, lists it, edits it, and cancels it', async () => {
    const { studentId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/check-ins/manual')
      .set('Cookie', cookie)
      .send({ studentId, reason: '기기 오류로 수동 등록' });
    expect(created.status).toBe(200);
    expect(created.body.data.source).toBe('admin');
    expect(created.body.data.exceptionReason).toBe('기기 오류로 수동 등록');

    const list = await request(app).get(`/api/check-ins?studentId=${studentId}`).set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const edited = await request(app)
      .patch(`/api/check-ins/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ checkInAt: '2026-08-16T09:00:00.000Z', reason: '시간 수정', expectedUpdatedAt: created.body.data.updatedAt });
    expect(edited.status).toBe(200);

    const history = await request(app).get(`/api/check-ins/${created.body.data.id}/history`).set('Cookie', cookie);
    expect(history.status).toBe(200);
    expect(history.body.data.length).toBeGreaterThanOrEqual(2);

    const canceled = await request(app)
      .post(`/api/check-ins/${created.body.data.id}/cancel`)
      .set('Cookie', cookie)
      .send({ reason: '오등록 취소' });
    expect(canceled.status).toBe(200);
    expect(canceled.body.data.status).toBe('canceled');
  });

  it('rejects duplicate manual check-in for the same student and date', async () => {
    const { studentId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app).post('/api/check-ins/manual').set('Cookie', cookie).send({ studentId, reason: '첫 등록' });
    const second = await request(app).post('/api/check-ins/manual').set('Cookie', cookie).send({ studentId, reason: '두번째' });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_CHECKIN');
  });

  it('allows an explicit exception duplicate when allowException is true, and logs it as exception_create', async () => {
    const { studentId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const first = await request(app)
      .post('/api/check-ins/manual')
      .set('Cookie', cookie)
      .send({ studentId, reason: '첫 등록' });
    expect(first.status).toBe(200);

    const withoutOverride = await request(app)
      .post('/api/check-ins/manual')
      .set('Cookie', cookie)
      .send({ studentId, reason: '오후 보강 재등원' });
    expect(withoutOverride.status).toBe(409);

    const exception = await request(app)
      .post('/api/check-ins/manual')
      .set('Cookie', cookie)
      .send({ studentId, reason: '오후 보강 재등원', allowException: true });
    expect(exception.status).toBe(200);
    expect(exception.body.data.id).not.toBe(first.body.data.id);

    const list = await request(app).get(`/api/check-ins?studentId=${studentId}`).set('Cookie', cookie);
    expect(list.body.data).toHaveLength(2);

    const history = await request(app).get(`/api/check-ins/${exception.body.data.id}/history`).set('Cookie', cookie);
    expect(history.body.data[0].action).toBe('exception_create');
  });

  it('rejects a stale PATCH with VERSION_CONFLICT', async () => {
    const { studentId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app).post('/api/check-ins/manual').set('Cookie', cookie).send({ studentId, reason: '등록' });
    await request(app)
      .patch(`/api/check-ins/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ reason: '첫 수정', expectedUpdatedAt: created.body.data.updatedAt });

    const staleEdit = await request(app)
      .patch(`/api/check-ins/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ reason: '두번째 수정', expectedUpdatedAt: created.body.data.updatedAt });

    expect(staleEdit.status).toBe(409);
    expect(staleEdit.body.error.code).toBe('VERSION_CONFLICT');
  });
});
