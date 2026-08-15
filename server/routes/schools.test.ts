import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, auditLogs, authSessions, passwordResetTokens, roles, schools } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-schools-super@example.com';
const PASSWORD = 'test-schools-password-123';
const TEST_SCHOOL_NAME = 'test-school-일반중학교';
const TEST_SCHOOL_NAME_2 = 'test-school-이름변경중학교';

async function seedSuperAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-schools-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION] })
    .returning();
  await db.insert(admins).values({
    email: SUPER_EMAIL,
    name: '수퍼',
    passwordHash: await hashPassword(PASSWORD),
    roleId: role!.id,
    status: 'active',
  });
}

async function loginAs(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('login did not set a session cookie');
  return cookie;
}

async function cleanup() {
  await db.delete(schools).where(eq(schools.name, TEST_SCHOOL_NAME));
  await db.delete(schools).where(eq(schools.name, TEST_SCHOOL_NAME_2));

  const adminToDelete = await db.query.admins.findFirst({
    where: eq(admins.email, SUPER_EMAIL),
  });
  if (adminToDelete) {
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-schools-role'));
}

describe('schools routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/schools');
    expect(response.status).toBe(401);
  });

  it('creates, lists, edits, and deletes a school end to end', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/schools')
      .set('Cookie', cookie)
      .send({ name: TEST_SCHOOL_NAME, region: '서울 강남구', sortOrder: 1 });
    expect(created.status).toBe(200);
    expect(created.body.data.name).toBe(TEST_SCHOOL_NAME);
    expect(created.body.data.isActive).toBe(true);

    const list = await request(app).get('/api/schools').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.data.some((s: { id: string }) => s.id === created.body.data.id)).toBe(true);

    const edited = await request(app)
      .patch(`/api/schools/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ name: TEST_SCHOOL_NAME_2, expectedUpdatedAt: created.body.data.updatedAt });
    expect(edited.status).toBe(200);
    expect(edited.body.data.name).toBe(TEST_SCHOOL_NAME_2);

    const staleEdit = await request(app)
      .patch(`/api/schools/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ name: 'test-school-또변경', expectedUpdatedAt: created.body.data.updatedAt });
    expect(staleEdit.status).toBe(409);
    expect(staleEdit.body.error.code).toBe('VERSION_CONFLICT');

    const deleted = await request(app).delete(`/api/schools/${created.body.data.id}`).set('Cookie', cookie);
    expect(deleted.status).toBe(200);

    const listAfterDelete = await request(app).get('/api/schools').set('Cookie', cookie);
    expect(listAfterDelete.body.data.some((s: { id: string }) => s.id === created.body.data.id)).toBe(false);
  });

  it('rejects creating a second active school with the same name', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app).post('/api/schools').set('Cookie', cookie).send({ name: TEST_SCHOOL_NAME });
    const duplicate = await request(app).post('/api/schools').set('Cookie', cookie).send({ name: TEST_SCHOOL_NAME });

    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('can deactivate a school via PATCH without deleting it', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app).post('/api/schools').set('Cookie', cookie).send({ name: TEST_SCHOOL_NAME });

    const deactivated = await request(app)
      .patch(`/api/schools/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ isActive: false, expectedUpdatedAt: created.body.data.updatedAt });

    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.isActive).toBe(false);
  });
});
