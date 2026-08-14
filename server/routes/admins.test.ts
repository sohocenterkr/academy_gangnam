import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, auditLogs, authSessions, roles } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-admins-super@example.com';
const PASSWORD = 'test-admins-password-123';
const NEW_ADMIN_EMAIL = 'test-admins-new@example.com';

async function seedSuperAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-admins-super-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION] })
    .returning();
  if (!role) throw new Error('failed to seed test role');
  const [admin] = await db
    .insert(admins)
    .values({
      email: SUPER_EMAIL,
      name: '수퍼',
      passwordHash: await hashPassword(PASSWORD),
      roleId: role.id,
      status: 'active',
    })
    .returning();
  if (!admin) throw new Error('failed to seed test admin');
  return { role, admin };
}

async function loginAs(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('login did not set a session cookie');
  return cookie;
}

// Deletes auth_sessions and audit_logs for both test admins first — several tests below log in
// for real and write audit log rows, and a leftover row in either table would block deleting the
// admin it references via the foreign key.
async function cleanup() {
  const testAdmins = await db
    .select()
    .from(admins)
    .where(inArray(admins.email, [SUPER_EMAIL, NEW_ADMIN_EMAIL]));
  for (const admin of testAdmins) {
    await db.delete(authSessions).where(eq(authSessions.adminId, admin.id));
    await db.delete(auditLogs).where(eq(auditLogs.adminId, admin.id));
  }
  await db.delete(admins).where(eq(admins.email, SUPER_EMAIL));
  await db.delete(admins).where(eq(admins.email, NEW_ADMIN_EMAIL));
  await db.delete(roles).where(eq(roles.name, 'test-admins-super-role'));
}

describe('admins routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('creates a new admin under the same role', async () => {
    const { role } = await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app)
      .post('/api/admins')
      .set('Cookie', cookie)
      .send({ email: NEW_ADMIN_EMAIL, name: '새관리자', password: 'a-new-password-123', roleId: role.id });

    expect(response.status).toBe(200);
    expect(response.body.data.email).toBe(NEW_ADMIN_EMAIL);
    expect(response.body.data.passwordHash).toBeUndefined();
  });

  it('lists admins', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app).get('/api/admins').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('refuses to deactivate the last active super-admin', async () => {
    const { admin } = await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app).post(`/api/admins/${admin.id}/deactivate`).set('Cookie', cookie).send();

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('LAST_SUPER_ADMIN');
  });

  it('edits an admin with optimistic locking via updatedAt', async () => {
    const { role } = await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/admins')
      .set('Cookie', cookie)
      .send({ email: NEW_ADMIN_EMAIL, name: '새관리자', password: 'a-new-password-123', roleId: role.id });

    const editResponse = await request(app)
      .patch(`/api/admins/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ name: '수정된이름', expectedUpdatedAt: created.body.data.updatedAt });
    expect(editResponse.status).toBe(200);
    expect(editResponse.body.data.name).toBe('수정된이름');

    const staleEditResponse = await request(app)
      .patch(`/api/admins/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ name: '또수정', expectedUpdatedAt: created.body.data.updatedAt });
    expect(staleEditResponse.status).toBe(409);
    expect(staleEditResponse.body.error.code).toBe('VERSION_CONFLICT');
  });
});
