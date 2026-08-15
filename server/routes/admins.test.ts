import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, auditLogs, authSessions, roles } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { PERMISSIONS, SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-admins-super@example.com';
const PASSWORD = 'test-admins-password-123';
const NEW_ADMIN_EMAIL = 'test-admins-new@example.com';
const MANAGE_ONLY_EMAIL = 'test-admins-manage-only@example.com';
const PLAIN_TARGET_EMAIL = 'test-admins-plain-target@example.com';

const MANAGE_ONLY_ROLE_NAME = 'test-admins-manage-only-role';
const NON_EXISTENT_ROLE_ID = '00000000-0000-0000-0000-000000000000';

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

// Seeds an admin with admins:manage but WITHOUT the wildcard permission — the case that
// distinguishes "lacks admins:manage entirely" (blocked by the permission middleware) from
// "has admins:manage but isn't a super-admin" (blocked by the escalation guard specifically).
async function seedManageOnlyAdmin() {
  const [manageOnlyRole] = await db
    .insert(roles)
    .values({ name: MANAGE_ONLY_ROLE_NAME, permissions: [PERMISSIONS.ADMINS_MANAGE] })
    .returning();
  if (!manageOnlyRole) throw new Error('failed to seed manage-only test role');
  const passwordHash = await hashPassword(PASSWORD);
  await db.insert(admins).values({
    email: MANAGE_ONLY_EMAIL,
    name: '관리자관리자',
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
async function cleanup() {
  const testAdmins = await db
    .select()
    .from(admins)
    .where(inArray(admins.email, [SUPER_EMAIL, NEW_ADMIN_EMAIL, MANAGE_ONLY_EMAIL, PLAIN_TARGET_EMAIL]));
  for (const admin of testAdmins) {
    await db.delete(authSessions).where(eq(authSessions.adminId, admin.id));
    await db.delete(auditLogs).where(eq(auditLogs.adminId, admin.id));
  }
  await db.delete(admins).where(eq(admins.email, SUPER_EMAIL));
  await db.delete(admins).where(eq(admins.email, NEW_ADMIN_EMAIL));
  await db.delete(admins).where(eq(admins.email, MANAGE_ONLY_EMAIL));
  await db.delete(admins).where(eq(admins.email, PLAIN_TARGET_EMAIL));
  await db.delete(roles).where(eq(roles.name, 'test-admins-super-role'));
  await db.delete(roles).where(eq(roles.name, 'test-admins-plain-role'));
  await db.delete(roles).where(eq(roles.name, MANAGE_ONLY_ROLE_NAME));
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

  it('refuses to set the last active super-admin to a non-active status via PATCH', async () => {
    const { admin } = await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);
    // Login itself updates the admin's updatedAt (failedLoginCount/lastLoginAt reset), so re-fetch
    // the current representation instead of reusing the pre-login value from seedSuperAdmin — otherwise
    // the optimistic-lock check would fire first with VERSION_CONFLICT before reaching the guard under test.
    const current = await request(app).get(`/api/admins/${admin.id}`).set('Cookie', cookie);

    const response = await request(app)
      .patch(`/api/admins/${admin.id}`)
      .set('Cookie', cookie)
      .send({ status: 'inactive', expectedUpdatedAt: current.body.data.updatedAt });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('LAST_SUPER_ADMIN');
  });

  it('refuses to move the last active super-admin to a non-super role via PATCH', async () => {
    const { admin } = await seedSuperAdmin();
    const [plainRole] = await db.insert(roles).values({ name: 'test-admins-plain-role', permissions: [] }).returning();
    if (!plainRole) throw new Error('failed to seed plain role');

    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);
    // Same reasoning as above: re-fetch post-login state before computing expectedUpdatedAt.
    const current = await request(app).get(`/api/admins/${admin.id}`).set('Cookie', cookie);

    const response = await request(app)
      .patch(`/api/admins/${admin.id}`)
      .set('Cookie', cookie)
      .send({ roleId: plainRole.id, expectedUpdatedAt: current.body.data.updatedAt });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('LAST_SUPER_ADMIN');
  });

  it('rejects assigning a super-admin role via POST from an admin who is not already a super-admin', async () => {
    const { role: superRole } = await seedSuperAdmin();
    await seedManageOnlyAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, MANAGE_ONLY_EMAIL);

    const response = await request(app)
      .post('/api/admins')
      .set('Cookie', cookie)
      .send({ email: NEW_ADMIN_EMAIL, name: '새관리자', password: 'a-new-password-123', roleId: superRole.id });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects assigning a super-admin role via PATCH from an admin who is not already a super-admin', async () => {
    const { role: superRole } = await seedSuperAdmin();
    const [plainRole] = await db.insert(roles).values({ name: 'test-admins-plain-role', permissions: [] }).returning();
    if (!plainRole) throw new Error('failed to seed plain role');
    const passwordHash = await hashPassword(PASSWORD);
    const [targetAdmin] = await db
      .insert(admins)
      .values({ email: PLAIN_TARGET_EMAIL, name: '대상관리자', passwordHash, roleId: plainRole.id, status: 'active' })
      .returning();
    if (!targetAdmin) throw new Error('failed to seed target admin');
    await seedManageOnlyAdmin();

    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, MANAGE_ONLY_EMAIL);

    const response = await request(app)
      .patch(`/api/admins/${targetAdmin.id}`)
      .set('Cookie', cookie)
      .send({ roleId: superRole.id, expectedUpdatedAt: targetAdmin.updatedAt.toISOString() });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects creating an admin with a duplicate email with a 400 instead of a raw DB error', async () => {
    const { role } = await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app)
      .post('/api/admins')
      .set('Cookie', cookie)
      .send({ email: SUPER_EMAIL, name: '중복', password: 'a-new-password-123', roleId: role.id });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.fieldErrors.email).toBeDefined();
  });

  it('rejects creating an admin with a non-existent roleId with a 400 instead of a raw DB error', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app)
      .post('/api/admins')
      .set('Cookie', cookie)
      .send({ email: NEW_ADMIN_EMAIL, name: '새관리자', password: 'a-new-password-123', roleId: NON_EXISTENT_ROLE_ID });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.fieldErrors.roleId).toBeDefined();
  });
});
