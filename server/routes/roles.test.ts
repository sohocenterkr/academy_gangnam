import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, auditLogs, authSessions, roles } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { PERMISSIONS, SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-roles-super@example.com';
const PLAIN_EMAIL = 'test-roles-plain@example.com';
const PASSWORD = 'test-roles-password-123';

async function seedAdmins() {
  const [superRole] = await db
    .insert(roles)
    .values({ name: 'test-roles-super-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION] })
    .returning();
  const [plainRole] = await db
    .insert(roles)
    .values({ name: 'test-roles-plain-role', permissions: [] })
    .returning();
  if (!superRole || !plainRole) throw new Error('failed to seed test roles');
  const passwordHash = await hashPassword(PASSWORD);
  await db.insert(admins).values([
    { email: SUPER_EMAIL, name: '수퍼', passwordHash, roleId: superRole.id, status: 'active' },
    { email: PLAIN_EMAIL, name: '일반', passwordHash, roleId: plainRole.id, status: 'active' },
  ]);
  return { superRole, plainRole };
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
async function cleanup(extraRoleNames: string[] = []) {
  const testAdmins = await db.select().from(admins).where(inArray(admins.email, [SUPER_EMAIL, PLAIN_EMAIL]));
  for (const admin of testAdmins) {
    await db.delete(authSessions).where(eq(authSessions.adminId, admin.id));
    await db.delete(auditLogs).where(eq(auditLogs.adminId, admin.id));
  }
  await db.delete(admins).where(eq(admins.email, SUPER_EMAIL));
  await db.delete(admins).where(eq(admins.email, PLAIN_EMAIL));
  await db.delete(roles).where(eq(roles.name, 'test-roles-super-role'));
  await db.delete(roles).where(eq(roles.name, 'test-roles-plain-role'));
  for (const name of extraRoleNames) {
    await db.delete(roles).where(eq(roles.name, name));
  }
}

describe('roles routes', () => {
  afterEach(async () => {
    await cleanup(['test-roles-new-role']);
  });

  it('allows a super-admin to create a role', async () => {
    await seedAdmins();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app)
      .post('/api/roles')
      .set('Cookie', cookie)
      .send({ name: 'test-roles-new-role', permissions: [PERMISSIONS.ADMINS_MANAGE] });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('test-roles-new-role');
  });

  it('rejects a non-super-admin without roles:manage permission', async () => {
    await seedAdmins();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, PLAIN_EMAIL);

    const response = await request(app)
      .post('/api/roles')
      .set('Cookie', cookie)
      .send({ name: 'test-roles-new-role', permissions: [] });

    expect(response.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/roles');
    expect(response.status).toBe(401);
  });

  it('refuses to strip the wildcard permission from the last active super-admin role', async () => {
    const { superRole } = await seedAdmins();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app)
      .patch(`/api/roles/${superRole.id}`)
      .set('Cookie', cookie)
      .send({ permissions: [] });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('LAST_SUPER_ADMIN');
  });
});
