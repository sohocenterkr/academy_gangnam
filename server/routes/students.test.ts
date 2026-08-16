import { eq, ilike, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, students, gradeLevels, studentGuardians } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-students-super@example.com';
const PASSWORD = 'test-students-password-123';
const TEST_STUDENT_NAME = 'test-student-김철수';
const TEST_STUDENT_PHONE = '01099998888';
const TEST_GRADE_NAME = 'test-students-grade';

async function seedSuperAdminAndGrade() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-students-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION] })
    .returning();
  await db.insert(admins).values({
    email: SUPER_EMAIL,
    name: '수퍼',
    passwordHash: await hashPassword(PASSWORD),
    roleId: role!.id,
    status: 'active',
  });
  const [grade] = await db.insert(gradeLevels).values({ name: TEST_GRADE_NAME, sortOrder: 0 }).returning();
  return { gradeLevelId: grade!.id };
}

async function loginAs(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('login did not set a session cookie');
  return cookie;
}

async function cleanup() {
  const testStudents = await db.select({ id: students.id }).from(students).where(ilike(students.name, 'test-student-%'));
  if (testStudents.length > 0) {
    await db.delete(studentGuardians).where(
      inArray(
        studentGuardians.studentId,
        testStudents.map((s) => s.id)
      )
    );
  }
  await db.delete(students).where(ilike(students.name, 'test-student-%'));
  await db.delete(gradeLevels).where(eq(gradeLevels.name, TEST_GRADE_NAME));

  const adminToDelete = await db.query.admins.findFirst({ where: eq(admins.email, SUPER_EMAIL) });
  if (adminToDelete) {
    const { auditLogs, authSessions, passwordResetTokens } = await import('@shared/schema');
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-students-role'));
}

describe('students routes — list and create', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/students');
    expect(response.status).toBe(401);
  });

  it('creates a student and returns it in the masked list', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: '010-9999-8888', gradeLevelId });

    expect(created.status).toBe(200);
    expect(created.body.data.status).toBe('created');
    expect(created.body.data.student.phoneNormalized).toBe(TEST_STUDENT_PHONE);
    expect(created.body.data.student.status).toBe('enrolled');

    const list = await request(app).get('/api/students').set('Cookie', cookie);
    expect(list.status).toBe(200);
    const found = list.body.data.find((s: { id: string }) => s.id === created.body.data.student.id);
    expect(found).toBeDefined();
    // maskName keeps only the first and last character of the whole string (shared/masking.test.ts).
    // TEST_STUDENT_NAME is 16 code points ("test-student-" = 13 chars + "김철수" = 3 chars), so it
    // masks down to first char + 14 stars + last char (brief's literal test text asserted 15 stars /
    // 17 total chars, which was verified against shared/masking.ts's maskName and does not match — the
    // "test-student-" prefix is one character shorter than guardians' "test-guardian-" prefix, so the
    // guardians test's 17-char/15-star expectation does not carry over unchanged).
    expect(found.name).toBe('t**************수');
    expect(found.phoneNormalized).toBe('010-****-8888');
  });

  it('rejects creation with a non-existent gradeLevelId', async () => {
    await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId: '00000000-0000-0000-0000-000000000000' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a malformed registrationDate with a clean 400', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId, registrationDate: 'not-a-date' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('warns about a duplicate phone instead of creating, until confirmDuplicate is set', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app).post('/api/students').set('Cookie', cookie).send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });

    const secondAttempt = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: 'test-student-이영희', phone: TEST_STUDENT_PHONE, gradeLevelId });

    expect(secondAttempt.status).toBe(200);
    expect(secondAttempt.body.data.status).toBe('duplicate_warning');
    expect(secondAttempt.body.data.duplicates[0].phoneNormalized).toBe('010-****-8888');

    const confirmed = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: 'test-student-이영희', phone: TEST_STUDENT_PHONE, gradeLevelId, confirmDuplicate: true });

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe('created');
  });

  it('searches the student list by name and filters by status', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app).post('/api/students').set('Cookie', cookie).send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });

    const searchResult = await request(app).get('/api/students?search=김철수').set('Cookie', cookie);
    expect(searchResult.status).toBe(200);
    expect(searchResult.body.data.length).toBeGreaterThanOrEqual(1);

    const statusResult = await request(app).get('/api/students?status=withdrawn').set('Cookie', cookie);
    expect(statusResult.body.data.find((s: { id: string; name: string }) => s.name.includes('*'))).toBeUndefined();
  });
});

describe('students routes — detail and update', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('returns 404 for a missing student', async () => {
    await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app).get('/api/students/00000000-0000-0000-0000-000000000000').set('Cookie', cookie);
    expect(response.status).toBe(404);
  });

  it('returns full unmasked data with an empty guardians array on the detail endpoint', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });

    const detail = await request(app).get(`/api/students/${created.body.data.student.id}`).set('Cookie', cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.data.name).toBe(TEST_STUDENT_NAME);
    expect(detail.body.data.phoneNormalized).toBe(TEST_STUDENT_PHONE);
    expect(detail.body.data.guardians).toEqual([]);
  });

  it('updates a student with optimistic locking', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });

    const edited = await request(app)
      .patch(`/api/students/${created.body.data.student.id}`)
      .set('Cookie', cookie)
      .send({ specialNotes: '수정된 메모', expectedUpdatedAt: created.body.data.student.updatedAt });

    expect(edited.status).toBe(200);
    expect(edited.body.data.status).toBe('updated');
    expect(edited.body.data.student.specialNotes).toBe('수정된 메모');

    const staleEdit = await request(app)
      .patch(`/api/students/${created.body.data.student.id}`)
      .set('Cookie', cookie)
      .send({ specialNotes: '또 수정', expectedUpdatedAt: created.body.data.student.updatedAt });

    expect(staleEdit.status).toBe(409);
    expect(staleEdit.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('warns about a duplicate phone on update, until confirmDuplicate is set', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app).post('/api/students').set('Cookie', cookie).send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });
    const second = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: 'test-student-박민수', phone: '01077776666', gradeLevelId, confirmDuplicate: true });

    const attempt = await request(app)
      .patch(`/api/students/${second.body.data.student.id}`)
      .set('Cookie', cookie)
      .send({ phone: TEST_STUDENT_PHONE, expectedUpdatedAt: second.body.data.student.updatedAt });

    expect(attempt.status).toBe(200);
    expect(attempt.body.data.status).toBe('duplicate_warning');
  });

  it('rejects concurrent updates atomically — only one of two simultaneous PATCHes succeeds', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });
    const expectedUpdatedAt = created.body.data.student.updatedAt;
    const studentId = created.body.data.student.id;

    // Warm up the DB connection pool with a concurrent pair first — a cold pool
    // opens a brand-new connection for the second of two simultaneous queries,
    // which takes long enough (network + TLS setup) that the two PATCHes below
    // would otherwise run sequentially instead of actually racing.
    await Promise.all([request(app).get('/api/students').set('Cookie', cookie), request(app).get('/api/students').set('Cookie', cookie)]);

    const [first, second] = await Promise.all([
      request(app).patch(`/api/students/${studentId}`).set('Cookie', cookie).send({ specialNotes: '메모 A', expectedUpdatedAt }),
      request(app).patch(`/api/students/${studentId}`).set('Cookie', cookie).send({ specialNotes: '메모 B', expectedUpdatedAt }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
  });
});

describe('students routes — status, delete, restore', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('changes status and records the effective date', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });

    const response = await request(app)
      .post(`/api/students/${created.body.data.student.id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'paused', effectiveDate: '2026-09-01' });

    expect(response.status).toBe(200);
    expect(response.body.data.student.status).toBe('paused');
    expect(response.body.data.student.statusEffectiveDate).toBe('2026-09-01');
  });

  it('rejects an invalid status value', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });

    const response = await request(app)
      .post(`/api/students/${created.body.data.student.id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'not-a-real-status' });

    expect(response.status).toBe(400);
  });

  it('soft-deletes and restores a student', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });
    const studentId = created.body.data.student.id;

    const deleted = await request(app).delete(`/api/students/${studentId}`).set('Cookie', cookie);
    expect(deleted.status).toBe(200);

    const afterDelete = await request(app).get(`/api/students/${studentId}`).set('Cookie', cookie);
    expect(afterDelete.status).toBe(404);

    const restored = await request(app).post(`/api/students/${studentId}/restore`).set('Cookie', cookie);
    expect(restored.status).toBe(200);

    const afterRestore = await request(app).get(`/api/students/${studentId}`).set('Cookie', cookie);
    expect(afterRestore.status).toBe(200);
  });
});

describe('students routes — guardian linking', () => {
  afterEach(async () => {
    await cleanup();
    const { guardians } = await import('@shared/schema');
    await db.delete(guardians).where(ilike(guardians.name, 'test-student-guardian-%'));
  });

  it('links a guardian to a student and returns it in the detail view', async () => {
    const { guardians } = await import('@shared/schema');
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const student = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });
    const [guardian] = await db
      .insert(guardians)
      .values({ name: 'test-student-guardian-김보호', phoneNormalized: '01011112222' })
      .returning();

    const linked = await request(app)
      .post(`/api/students/${student.body.data.student.id}/guardians`)
      .set('Cookie', cookie)
      .send({ guardianId: guardian!.id, relationship: '모', isPrimary: true });

    expect(linked.status).toBe(200);
    expect(linked.body.data.isPrimary).toBe(true);

    const detail = await request(app).get(`/api/students/${student.body.data.student.id}`).set('Cookie', cookie);
    expect(detail.body.data.guardians).toHaveLength(1);
    expect(detail.body.data.guardians[0].guardian.name).toBe('test-student-guardian-김보호');
  });

  it('rejects linking the same guardian to the same student twice', async () => {
    const { guardians } = await import('@shared/schema');
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const student = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });
    const [guardian] = await db
      .insert(guardians)
      .values({ name: 'test-student-guardian-이보호', phoneNormalized: '01033334444' })
      .returning();

    await request(app).post(`/api/students/${student.body.data.student.id}/guardians`).set('Cookie', cookie).send({ guardianId: guardian!.id });
    const secondAttempt = await request(app)
      .post(`/api/students/${student.body.data.student.id}/guardians`)
      .set('Cookie', cookie)
      .send({ guardianId: guardian!.id });

    expect(secondAttempt.status).toBe(409);
    expect(secondAttempt.body.error.code).toBe('DUPLICATE_LINK');
  });

  it('moving isPrimary to a new link unsets the old primary', async () => {
    const { guardians } = await import('@shared/schema');
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const student = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });
    const [guardianA] = await db
      .insert(guardians)
      .values({ name: 'test-student-guardian-박부모A', phoneNormalized: '01055556666' })
      .returning();
    const [guardianB] = await db
      .insert(guardians)
      .values({ name: 'test-student-guardian-박부모B', phoneNormalized: '01077778888' })
      .returning();

    const linkA = await request(app)
      .post(`/api/students/${student.body.data.student.id}/guardians`)
      .set('Cookie', cookie)
      .send({ guardianId: guardianA!.id, isPrimary: true });

    const linkB = await request(app)
      .post(`/api/students/${student.body.data.student.id}/guardians`)
      .set('Cookie', cookie)
      .send({ guardianId: guardianB!.id, isPrimary: true });

    expect(linkB.body.data.isPrimary).toBe(true);

    const detail = await request(app).get(`/api/students/${student.body.data.student.id}`).set('Cookie', cookie);
    const linkAAfter = detail.body.data.guardians.find((g: { id: string }) => g.id === linkA.body.data.id);
    expect(linkAAfter.isPrimary).toBe(false);
  });
});
