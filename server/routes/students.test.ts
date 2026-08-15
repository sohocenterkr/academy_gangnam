import { eq, ilike } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, students, gradeLevels } from '@shared/schema';
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
