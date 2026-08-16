import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
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
    // Finding #8: a non-exception manual create must not store the reason in exception_reason
    // (the column is meant only for actual exceptions) — the reason is preserved either way in
    // check_in_change_logs.reason.
    expect(created.body.data.exceptionReason).toBeNull();

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

  it('includes a masked studentName on each list row (finding #6)', async () => {
    const { studentId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app).post('/api/check-ins/manual').set('Cookie', cookie).send({ studentId, reason: '등록' });

    const list = await request(app).get(`/api/check-ins?studentId=${studentId}`).set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].studentName).toBe('t**************생');
    expect(list.body.data[0].studentName).not.toBe(TEST_STUDENT_NAME);
  });

  it('filters the list by from/to check-in date (finding #13)', async () => {
    const { studentId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app).post('/api/check-ins/manual').set('Cookie', cookie).send({ studentId, reason: '등록' });

    const withinRange = await request(app)
      .get(`/api/check-ins?studentId=${studentId}&from=2000-01-01&to=2999-12-31`)
      .set('Cookie', cookie);
    expect(withinRange.body.data).toHaveLength(1);

    const outsideRange = await request(app)
      .get(`/api/check-ins?studentId=${studentId}&from=2000-01-01&to=2000-01-02`)
      .set('Cookie', cookie);
    expect(outsideRange.body.data).toHaveLength(0);
  });

  it('rejects concurrent double-cancel — only one of two simultaneous cancels succeeds (finding #10)', async () => {
    const { studentId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app).post('/api/check-ins/manual').set('Cookie', cookie).send({ studentId, reason: '등록' });

    await Promise.all([request(app).get('/api/check-ins').set('Cookie', cookie), request(app).get('/api/check-ins').set('Cookie', cookie)]);

    const [first, second] = await Promise.all([
      request(app).post(`/api/check-ins/${created.body.data.id}/cancel`).set('Cookie', cookie).send({ reason: '취소 A' }),
      request(app).post(`/api/check-ins/${created.body.data.id}/cancel`).set('Cookie', cookie).send({ reason: '취소 B' }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 400]);

    const changeLogs = await db.select().from(checkInChangeLogs).where(eq(checkInChangeLogs.checkInId, created.body.data.id));
    expect(changeLogs.filter((log) => log.action === 'cancel')).toHaveLength(1);
  });

  it('rejects editing an already-canceled check-in with VALIDATION_ERROR (finding #3)', async () => {
    const { studentId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app).post('/api/check-ins/manual').set('Cookie', cookie).send({ studentId, reason: '등록' });
    await request(app).post(`/api/check-ins/${created.body.data.id}/cancel`).set('Cookie', cookie).send({ reason: '취소' });

    const edit = await request(app)
      .patch(`/api/check-ins/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ reason: '취소된 걸 수정 시도', expectedUpdatedAt: created.body.data.updatedAt });

    expect(edit.status).toBe(400);
    expect(edit.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('recomputes checkInDate when a PATCH moves checkInAt across a KST midnight (finding #3)', async () => {
    const { studentId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app).post('/api/check-ins/manual').set('Cookie', cookie).send({ studentId, reason: '등록' });

    // 2026-08-16T15:30:00Z is 2026-08-17T00:30:00+09:00 in KST — moves the business date forward a day.
    const edited = await request(app)
      .patch(`/api/check-ins/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ checkInAt: '2026-08-16T15:30:00.000Z', reason: '자정 이동', expectedUpdatedAt: created.body.data.updatedAt });

    expect(edited.status).toBe(200);
    expect(edited.body.data.checkInDate).toBe('2026-08-17');

    const rows = await db.select().from(checkIns).where(eq(checkIns.id, created.body.data.id));
    expect(rows[0]!.checkInDate).toBe('2026-08-17');
  });

  it('returns 409 DUPLICATE_CHECKIN when a PATCH moves checkInAt onto a date with another active check-in (finding #3)', async () => {
    const { studentId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    // The duplicate-prevention unique index only covers non-exception active rows, and the
    // manual-create API always stamps "today" as checkInDate, so to get two non-exception active
    // rows on two DIFFERENT dates for the same student (the setup needed to prove the PATCH-time
    // collision) this seeds the second row directly rather than going through two real days.
    const other = new Date('2026-08-10T01:00:00.000Z');
    const [otherRow] = await db
      .insert(checkIns)
      .values({
        studentId,
        checkInDate: '2026-08-10',
        checkInAt: other,
        source: 'admin',
        status: 'active',
        idempotencyKey: randomUUID(),
        isException: false,
        createdBy: null,
        createdAt: other,
        updatedAt: other,
      })
      .returning();

    const created = await request(app).post('/api/check-ins/manual').set('Cookie', cookie).send({ studentId, reason: '등록' });

    // Move `created`'s checkInAt onto otherRow's KST date — collides with otherRow's active,
    // non-exception row on (studentId, checkInDate).
    const collide = await request(app)
      .patch(`/api/check-ins/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ checkInAt: '2026-08-10T01:00:00.000Z', reason: '충돌 시도', expectedUpdatedAt: created.body.data.updatedAt });

    expect(collide.status).toBe(409);
    expect(collide.body.error.code).toBe('DUPLICATE_CHECKIN');

    await db.delete(checkInChangeLogs).where(eq(checkInChangeLogs.checkInId, otherRow!.id));
    await db.delete(checkIns).where(eq(checkIns.id, otherRow!.id));
  });
});
