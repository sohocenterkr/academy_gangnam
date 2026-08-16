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
const MANAGE_ONLY_EMAIL = 'test-roles-manage-only@example.com';
const PASSWORD = 'test-roles-password-123';

const MANAGE_ONLY_ROLE_NAME = 'test-roles-manage-only-role';
const SYSTEM_ROLE_NAME = 'test-roles-system-role';

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

// Seeds an admin with roles:manage but WITHOUT the wildcard permission — the case that
// distinguishes "lacks roles:manage entirely" (blocked by the permission middleware) from
// "has roles:manage but isn't a super-admin" (blocked by the escalation guard specifically).
async function seedManageOnlyAdmin() {
  const [manageOnlyRole] = await db
    .insert(roles)
    .values({ name: MANAGE_ONLY_ROLE_NAME, permissions: [PERMISSIONS.ROLES_MANAGE] })
    .returning();
  if (!manageOnlyRole) throw new Error('failed to seed manage-only test role');
  const passwordHash = await hashPassword(PASSWORD);
  await db.insert(admins).values({
    email: MANAGE_ONLY_EMAIL,
    name: '역할관리자',
    passwordHash,
    roleId: manageOnlyRole.id,
    status: 'active',
  });
  return { manageOnlyRole };
}

async function loginAs(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('login did not set a session cookie');
  return cookie;
}

// Deletes auth_sessions and audit_logs for all test admins first — several tests below log in
// for real and write audit log rows, and a leftover row in either table would block deleting the
// admin it references via the foreign key.
async function cleanup(extraRoleNames: string[] = []) {
  const testAdmins = await db
    .select()
    .from(admins)
    .where(inArray(admins.email, [SUPER_EMAIL, PLAIN_EMAIL, MANAGE_ONLY_EMAIL]));
  for (const admin of testAdmins) {
    await db.delete(authSessions).where(eq(authSessions.adminId, admin.id));
    await db.delete(auditLogs).where(eq(auditLogs.adminId, admin.id));
  }
  await db.delete(admins).where(eq(admins.email, SUPER_EMAIL));
  await db.delete(admins).where(eq(admins.email, PLAIN_EMAIL));
  await db.delete(admins).where(eq(admins.email, MANAGE_ONLY_EMAIL));
  await db.delete(roles).where(eq(roles.name, 'test-roles-super-role'));
  await db.delete(roles).where(eq(roles.name, 'test-roles-plain-role'));
  await db.delete(roles).where(eq(roles.name, MANAGE_ONLY_ROLE_NAME));
  await db.delete(roles).where(eq(roles.name, SYSTEM_ROLE_NAME));
  for (const name of extraRoleNames) {
    await db.delete(roles).where(eq(roles.name, name));
  }
}

describe('roles routes', () => {
  afterEach(async () => {
    await cleanup(['test-roles-new-role', 'test-roles-new-role-a', 'test-roles-new-role-b']);
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
      .send({ permissions: [], expectedUpdatedAt: superRole.updatedAt.toISOString() });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('LAST_SUPER_ADMIN');
  });

  it('rejects granting the wildcard permission via POST from an admin who is not already a super-admin', async () => {
    await seedManageOnlyAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, MANAGE_ONLY_EMAIL);

    const response = await request(app)
      .post('/api/roles')
      .set('Cookie', cookie)
      .send({ name: 'test-roles-new-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION] });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects granting the wildcard permission via PATCH from an admin who is not already a super-admin', async () => {
    const { plainRole } = await seedAdmins();
    await seedManageOnlyAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, MANAGE_ONLY_EMAIL);

    const response = await request(app)
      .patch(`/api/roles/${plainRole.id}`)
      .set('Cookie', cookie)
      .send({ permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], expectedUpdatedAt: plainRole.updatedAt.toISOString() });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('refuses to PATCH a system role', async () => {
    await seedAdmins();
    const [systemRole] = await db
      .insert(roles)
      .values({ name: SYSTEM_ROLE_NAME, permissions: [], isSystem: true })
      .returning();
    if (!systemRole) throw new Error('failed to seed system test role');

    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app)
      .patch(`/api/roles/${systemRole.id}`)
      .set('Cookie', cookie)
      .send({ name: 'renamed', expectedUpdatedAt: systemRole.updatedAt.toISOString() });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects concurrent updates atomically — only one of two simultaneous PATCHes succeeds', async () => {
    await seedAdmins();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/roles')
      .set('Cookie', cookie)
      .send({ name: 'test-roles-new-role', permissions: [PERMISSIONS.ADMINS_MANAGE] });
    const expectedUpdatedAt = created.body.data.updatedAt;

    // Warm up the DB connection pool with a concurrent pair first — a cold pool
    // opens a brand-new connection for the second of two simultaneous queries,
    // which takes long enough (network + TLS setup) that the two PATCHes below
    // would otherwise run sequentially instead of actually racing.
    await Promise.all([request(app).get('/api/roles').set('Cookie', cookie), request(app).get('/api/roles').set('Cookie', cookie)]);

    const [first, second] = await Promise.all([
      request(app)
        .patch(`/api/roles/${created.body.data.id}`)
        .set('Cookie', cookie)
        .send({ name: 'test-roles-new-role-a', expectedUpdatedAt }),
      request(app)
        .patch(`/api/roles/${created.body.data.id}`)
        .set('Cookie', cookie)
        .send({ name: 'test-roles-new-role-b', expectedUpdatedAt }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('rejects a malformed expectedUpdatedAt with a clean 400', async () => {
    await seedAdmins();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/roles')
      .set('Cookie', cookie)
      .send({ name: 'test-roles-new-role', permissions: [] });

    const response = await request(app)
      .patch(`/api/roles/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ name: '새이름', expectedUpdatedAt: 'not-a-date' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
