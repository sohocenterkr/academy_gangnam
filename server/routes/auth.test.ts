import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, authSessions, roles } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { createApp } from '../app';

const TEST_EMAIL = 'test-auth-route-admin@example.com';
const TEST_PASSWORD = 'correct-password-123';

async function seedAdmin() {
  const [role] = await db.insert(roles).values({ name: 'test-auth-role', permissions: ['x:y'] }).returning();
  if (!role) {
    throw new Error('Role creation failed in test');
  }
  const [admin] = await db
    .insert(admins)
    .values({
      email: TEST_EMAIL,
      name: '인증테스트',
      passwordHash: await hashPassword(TEST_PASSWORD),
      roleId: role.id,
      status: 'active',
    })
    .returning();
  if (!admin) {
    throw new Error('Admin creation failed in test');
  }
  return { role, admin };
}

// Several tests below log in for real, which inserts an auth_sessions row — that row must be
// deleted before the admin it references, or the admin delete fails on the foreign key.
async function cleanup() {
  const [admin] = await db.select().from(admins).where(eq(admins.email, TEST_EMAIL));
  if (admin) {
    await db.delete(authSessions).where(eq(authSessions.adminId, admin.id));
  }
  await db.delete(admins).where(eq(admins.email, TEST_EMAIL));
  await db.delete(roles).where(eq(roles.name, 'test-auth-role'));
}

describe('auth routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('logs in with correct credentials and sets a session cookie', async () => {
    await seedAdmin();
    const app = createApp();

    const response = await request(app).post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.data.email).toBe(TEST_EMAIL);
    expect(response.headers['set-cookie']?.[0]).toContain('academy_session=');
  });

  it('rejects an incorrect password with a generic message', async () => {
    await seedAdmin();
    const app = createApp();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'wrong-password' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a login for an email that does not exist with the same generic message', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'no-such-admin@example.com', password: 'whatever123' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('GET /me returns 401 without a session cookie', async () => {
    const app = createApp();
    const response = await request(app).get('/api/auth/me');
    expect(response.status).toBe(401);
  });

  it('logs in, then GET /me returns the admin, then logout invalidates the session', async () => {
    await seedAdmin();
    const app = createApp();

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const cookie = loginResponse.headers['set-cookie']?.[0];
    if (!cookie) {
      throw new Error('Login did not set a session cookie in test');
    }

    const meResponse = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.data.email).toBe(TEST_EMAIL);

    const logoutResponse = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(logoutResponse.status).toBe(200);

    const meAfterLogout = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(meAfterLogout.status).toBe(401);
  });
});
