import { eq, ilike, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, students, gradeLevels, guardians, studentGuardians } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-studentguardians-super@example.com';
const PASSWORD = 'test-studentguardians-password-123';
const TEST_GRADE_NAME = 'test-studentguardians-grade';

async function seedFixtures() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-studentguardians-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION] })
    .returning();
  await db.insert(admins).values({
    email: SUPER_EMAIL,
    name: '수퍼',
    passwordHash: await hashPassword(PASSWORD),
    roleId: role!.id,
    status: 'active',
  });
  const [grade] = await db.insert(gradeLevels).values({ name: TEST_GRADE_NAME, sortOrder: 0 }).returning();
  const [student] = await db
    .insert(students)
    .values({
      name: 'test-studentguardians-학생',
      phoneNormalized: '01099990000',
      gradeLevelId: grade!.id,
      registrationDate: '2026-08-15',
      statusEffectiveDate: '2026-08-15',
    })
    .returning();
  const [guardian] = await db.insert(guardians).values({ name: 'test-studentguardians-보호자', phoneNormalized: '01088880000' }).returning();
  return { studentId: student!.id, guardianId: guardian!.id, gradeLevelId: grade!.id };
}

async function loginAs(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('login did not set a session cookie');
  return cookie;
}

async function cleanup() {
  const testStudents = await db.select({ id: students.id }).from(students).where(ilike(students.name, 'test-studentguardians-%'));
  if (testStudents.length > 0) {
    await db.delete(studentGuardians).where(
      inArray(
        studentGuardians.studentId,
        testStudents.map((s) => s.id)
      )
    );
  }
  await db.delete(students).where(ilike(students.name, 'test-studentguardians-%'));
  await db.delete(guardians).where(ilike(guardians.name, 'test-studentguardians-%'));
  await db.delete(gradeLevels).where(eq(gradeLevels.name, TEST_GRADE_NAME));

  const adminToDelete = await db.query.admins.findFirst({ where: eq(admins.email, SUPER_EMAIL) });
  if (adminToDelete) {
    const { auditLogs, authSessions, passwordResetTokens } = await import('@shared/schema');
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-studentguardians-role'));
}

describe('student-guardians routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).patch('/api/student-guardians/00000000-0000-0000-0000-000000000000').send({});
    expect(response.status).toBe(401);
  });

  it('updates a link with optimistic locking', async () => {
    const { studentId, guardianId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const linked = await request(app).post(`/api/students/${studentId}/guardians`).set('Cookie', cookie).send({ guardianId });

    const edited = await request(app)
      .patch(`/api/student-guardians/${linked.body.data.id}`)
      .set('Cookie', cookie)
      .send({ relationship: '부', receiveMessages: false, expectedUpdatedAt: linked.body.data.updatedAt });

    expect(edited.status).toBe(200);
    expect(edited.body.data.relationship).toBe('부');
    expect(edited.body.data.receiveMessages).toBe(false);

    const staleEdit = await request(app)
      .patch(`/api/student-guardians/${linked.body.data.id}`)
      .set('Cookie', cookie)
      .send({ relationship: '모', expectedUpdatedAt: linked.body.data.updatedAt });

    expect(staleEdit.status).toBe(409);
  });

  it('rejects concurrent updates atomically — only one of two simultaneous PATCHes succeeds', async () => {
    const { studentId, guardianId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const linked = await request(app).post(`/api/students/${studentId}/guardians`).set('Cookie', cookie).send({ guardianId });
    const expectedUpdatedAt = linked.body.data.updatedAt;
    const linkId = linked.body.data.id;

    // Warm up the DB connection pool with a concurrent pair first — a cold pool
    // opens a brand-new connection for the second of two simultaneous queries,
    // which takes long enough (network + TLS setup) that the two PATCHes below
    // would otherwise run sequentially instead of actually racing.
    await Promise.all([request(app).get(`/api/students/${studentId}`).set('Cookie', cookie), request(app).get(`/api/students/${studentId}`).set('Cookie', cookie)]);

    const [first, second] = await Promise.all([
      request(app).patch(`/api/student-guardians/${linkId}`).set('Cookie', cookie).send({ relationship: '부', expectedUpdatedAt }),
      request(app).patch(`/api/student-guardians/${linkId}`).set('Cookie', cookie).send({ relationship: '모', expectedUpdatedAt }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('does not let a losing concurrent isPrimary update revert the winning request', async () => {
    const { studentId, guardianId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const linked = await request(app).post(`/api/students/${studentId}/guardians`).set('Cookie', cookie).send({ guardianId });
    const expectedUpdatedAt = linked.body.data.updatedAt;
    const linkId = linked.body.data.id;

    await Promise.all([request(app).get(`/api/students/${studentId}`).set('Cookie', cookie), request(app).get(`/api/students/${studentId}`).set('Cookie', cookie)]);

    const [first, second] = await Promise.all([
      request(app).patch(`/api/student-guardians/${linkId}`).set('Cookie', cookie).send({ isPrimary: true, relationship: '부', expectedUpdatedAt }),
      request(app).patch(`/api/student-guardians/${linkId}`).set('Cookie', cookie).send({ isPrimary: true, relationship: '모', expectedUpdatedAt }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = first.status === 200 ? first : second;

    const detail = await request(app).get(`/api/students/${studentId}`).set('Cookie', cookie);
    const currentLink = detail.body.data.guardians.find((g: { id: string }) => g.id === linkId);
    expect(currentLink.isPrimary).toBe(true);
    expect(currentLink.relationship).toBe(winner.body.data.relationship);
  });

  it('unlinks a guardian from a student', async () => {
    const { studentId, guardianId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const linked = await request(app).post(`/api/students/${studentId}/guardians`).set('Cookie', cookie).send({ guardianId });

    const deleted = await request(app).delete(`/api/student-guardians/${linked.body.data.id}`).set('Cookie', cookie);
    expect(deleted.status).toBe(200);

    const detail = await request(app).get(`/api/students/${studentId}`).set('Cookie', cookie);
    expect(detail.body.data.guardians).toHaveLength(0);
  });
});
