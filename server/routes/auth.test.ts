import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, authSessions, passwordResetTokens, roles } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { createApp } from '../app';
import { createFakeEmailAdapter } from '../services/email';

const TEST_EMAIL = 'test-auth-route-admin@example.com';
const TEST_PASSWORD = 'correct-password-123';
const MIXED_CASE_EMAIL = 'Test-Auth-Mixed-Case@Example.com';
const MIXED_CASE_ROLE_NAME = 'test-auth-mixed-case-role';

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

// Several tests below log in for real (which inserts an auth_sessions row) or request/complete a
// password reset (which inserts a password_reset_tokens row) — those rows must be deleted before
// the admin they reference, or the admin delete fails on the foreign key.
async function cleanup() {
  const [admin] = await db.select().from(admins).where(eq(admins.email, TEST_EMAIL));
  if (admin) {
    await db.delete(authSessions).where(eq(authSessions.adminId, admin.id));
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.adminId, admin.id));
  }
  await db.delete(admins).where(eq(admins.email, TEST_EMAIL));
  await db.delete(roles).where(eq(roles.name, 'test-auth-role'));

  // Stored normalized (lowercase) since the admin was created via normalizeEmail; look it up
  // that way too, but also sweep the raw mixed-case value just in case normalization ever
  // regresses and leaves a differently-cased row behind.
  const mixedCaseCandidates = await db
    .select()
    .from(admins)
    .where(inArray(admins.email, [MIXED_CASE_EMAIL, MIXED_CASE_EMAIL.toLowerCase()]));
  for (const candidate of mixedCaseCandidates) {
    await db.delete(authSessions).where(eq(authSessions.adminId, candidate.id));
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.adminId, candidate.id));
    await db.delete(admins).where(eq(admins.id, candidate.id));
  }
  await db.delete(roles).where(eq(roles.name, MIXED_CASE_ROLE_NAME));
}

describe('auth routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('logs in with correct credentials and sets a session cookie', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });

    const response = await request(app).post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.data.email).toBe(TEST_EMAIL);
    expect(response.headers['set-cookie']?.[0]).toContain('academy_session=');
  });

  it('rejects an incorrect password with a generic message', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'wrong-password' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a login for an email that does not exist with the same generic message', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'no-such-admin@example.com', password: 'whatever123' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('logs in successfully with a differently-cased email than how the admin was created', async () => {
    const [role] = await db
      .insert(roles)
      .values({ name: MIXED_CASE_ROLE_NAME, permissions: ['x:y'] })
      .returning();
    if (!role) {
      throw new Error('Role creation failed in test');
    }
    // Every real write path (bootstrapAdmin, POST /api/admins) normalizes the email to
    // lowercase before storing it, so the admin is always stored lowercase in practice —
    // seed it that way here too, and log in with a differently-cased variant to prove the
    // login lookup also normalizes and still finds the (lowercase-stored) row.
    await db.insert(admins).values({
      email: MIXED_CASE_EMAIL.toLowerCase(),
      name: '대소문자테스트',
      passwordHash: await hashPassword(TEST_PASSWORD),
      roleId: role.id,
      status: 'active',
    });
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: MIXED_CASE_EMAIL, password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.data.email).toBe(MIXED_CASE_EMAIL.toLowerCase());
  });

  it('GET /me returns 401 without a session cookie', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/auth/me');
    expect(response.status).toBe(401);
  });

  it('logs in, then GET /me returns the admin, then logout invalidates the session', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });

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

describe('forgot-password / reset-password', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('always returns the same success message whether or not the email exists', async () => {
    const fakeEmailAdapter = createFakeEmailAdapter();
    const app = createApp({ emailAdapter: fakeEmailAdapter });

    const knownResponse = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'no-such-admin@example.com' });
    expect(knownResponse.status).toBe(200);
    expect(fakeEmailAdapter.sentEmails).toHaveLength(0);
  });

  it('sends a reset email for an existing admin and the token successfully resets the password', async () => {
    await seedAdmin();
    const fakeEmailAdapter = createFakeEmailAdapter();
    const app = createApp({ emailAdapter: fakeEmailAdapter });

    await request(app).post('/api/auth/forgot-password').send({ email: TEST_EMAIL });
    expect(fakeEmailAdapter.sentEmails).toHaveLength(1);
    const [sent] = fakeEmailAdapter.sentEmails;
    if (!sent) {
      throw new Error('Expected an email to have been sent in test');
    }
    const token = new URL(sent.resetUrl).searchParams.get('token');

    const resetResponse = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'a-brand-new-password-999' });
    expect(resetResponse.status).toBe(200);

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'a-brand-new-password-999' });
    expect(loginResponse.status).toBe(200);
  });

  it('rejects an invalid reset token', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'not-a-real-token', newPassword: 'whatever-password-123' });
    expect(response.status).toBe(400);
  });
});
