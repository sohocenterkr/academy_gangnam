import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, instructors } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-instructors-super@example.com';
const PASSWORD = 'test-instructors-password-123';
const TEST_INSTRUCTOR_NAME = 'test-instructors-강사';

async function seedAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-instructors-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
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
}

async function loginAs(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('login did not return a session cookie');
  return cookie;
}

async function cleanup() {
  await db.delete(instructors).where(eq(instructors.name, TEST_INSTRUCTOR_NAME));
  const adminToDelete = await db.query.admins.findFirst({ where: eq(admins.email, SUPER_EMAIL) });
  if (adminToDelete) {
    const { auditLogs, authSessions, passwordResetTokens } = await import('@shared/schema');
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-instructors-role'));
}

describe('instructors routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/instructors');
    expect(response.status).toBe(401);
  });

  it('creates, lists, and updates an instructor with atomic locking', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/instructors')
      .set('Cookie', cookie)
      .send({ name: TEST_INSTRUCTOR_NAME, phone: '01099998888', subjects: ['수학'] });
    expect(created.status).toBe(200);
    expect(created.body.data.status).toBe('active');

    const list = await request(app).get('/api/instructors').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.data.some((row: { id: string }) => row.id === created.body.data.id)).toBe(true);

    const updated = await request(app)
      .patch(`/api/instructors/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ status: 'inactive', expectedUpdatedAt: created.body.data.updatedAt });
    expect(updated.status).toBe(200);
    expect(updated.body.data.status).toBe('inactive');

    const staleUpdate = await request(app)
      .patch(`/api/instructors/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ status: 'active', expectedUpdatedAt: created.body.data.updatedAt });
    expect(staleUpdate.status).toBe(409);
    expect(staleUpdate.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('accepts a dashed/spaced display-format phone on create and normalizes it to digits only', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/instructors')
      .set('Cookie', cookie)
      .send({ name: TEST_INSTRUCTOR_NAME, phone: '010-1234-5678', subjects: ['수학'] });
    expect(created.status).toBe(200);
    expect(created.body.data.phoneNormalized).toBe('01012345678');
  });

  it('rejects a genuinely invalid phone with a 400 and fieldErrors.phone', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/instructors')
      .set('Cookie', cookie)
      .send({ name: TEST_INSTRUCTOR_NAME, phone: '---', subjects: ['수학'] });
    expect(created.status).toBe(400);
    expect(created.body.error.code).toBe('VALIDATION_ERROR');
    expect(created.body.error.fieldErrors.phone).toBeDefined();
  });
});
