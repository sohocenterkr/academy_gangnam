import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, auditLogs, authSessions, passwordResetTokens, roles, guardians } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-guardians-super@example.com';
const PASSWORD = 'test-guardians-password-123';
const TEST_GUARDIAN_NAME = 'test-guardian-김철수';
const TEST_GUARDIAN_PHONE = '01099998888';

async function seedSuperAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-guardians-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION] })
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
  await db.delete(guardians).where(eq(guardians.name, TEST_GUARDIAN_NAME));
  await db.delete(guardians).where(eq(guardians.phoneNormalized, TEST_GUARDIAN_PHONE));

  const adminToDelete = await db.query.admins.findFirst({
    where: eq(admins.email, SUPER_EMAIL),
  });
  if (adminToDelete) {
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-guardians-role'));
}

describe('guardians routes — list and create', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/guardians');
    expect(response.status).toBe(401);
  });

  it('creates a guardian and returns it in the masked list', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/guardians')
      .set('Cookie', cookie)
      .send({ name: TEST_GUARDIAN_NAME, phone: '010-9999-8888', notes: '테스트' });

    expect(created.status).toBe(200);
    expect(created.body.data.status).toBe('created');
    expect(created.body.data.guardian.phoneNormalized).toBe(TEST_GUARDIAN_PHONE);

    const list = await request(app).get('/api/guardians').set('Cookie', cookie);
    expect(list.status).toBe(200);
    const found = list.body.data.find((g: { id: string }) => g.id === created.body.data.guardian.id);
    expect(found).toBeDefined();
    // maskName keeps only the first and last character of the whole string (shared/masking.test.ts),
    // so a 17-character name (including the "test-guardian-" cleanup prefix) masks down to
    // first char + 15 stars + last char.
    expect(found.name).toBe('t***************수');
    expect(found.phoneNormalized).toBe('010-****-8888');
  });

  it('warns about a duplicate phone instead of creating, until confirmDuplicate is set', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app)
      .post('/api/guardians')
      .set('Cookie', cookie)
      .send({ name: TEST_GUARDIAN_NAME, phone: TEST_GUARDIAN_PHONE });

    const secondAttempt = await request(app)
      .post('/api/guardians')
      .set('Cookie', cookie)
      .send({ name: 'test-guardian-이영희', phone: TEST_GUARDIAN_PHONE });

    expect(secondAttempt.status).toBe(200);
    expect(secondAttempt.body.data.status).toBe('duplicate_warning');
    expect(secondAttempt.body.data.duplicates).toHaveLength(1);
    expect(secondAttempt.body.data.duplicates[0].phoneNormalized).toBe('010-****-8888');

    const listBeforeConfirm = await request(app).get('/api/guardians').set('Cookie', cookie);
    expect(listBeforeConfirm.body.data.filter((g: { phoneNormalized: string }) => g.phoneNormalized === '010-****-8888')).toHaveLength(1);

    const confirmed = await request(app)
      .post('/api/guardians')
      .set('Cookie', cookie)
      .send({ name: 'test-guardian-이영희', phone: TEST_GUARDIAN_PHONE, confirmDuplicate: true });

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe('created');

    await db.delete(guardians).where(and(eq(guardians.name, 'test-guardian-이영희'), eq(guardians.phoneNormalized, TEST_GUARDIAN_PHONE)));
  });

  it('searches the guardian list by name', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app).post('/api/guardians').set('Cookie', cookie).send({ name: TEST_GUARDIAN_NAME, phone: TEST_GUARDIAN_PHONE });

    const searchResult = await request(app).get('/api/guardians?search=김철수').set('Cookie', cookie);
    expect(searchResult.status).toBe(200);
    expect(searchResult.body.data.length).toBeGreaterThanOrEqual(1);

    const noResult = await request(app).get('/api/guardians?search=존재하지않는이름xyz').set('Cookie', cookie);
    expect(noResult.body.data).toHaveLength(0);
  });
});

describe('guardians routes — detail and update', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('returns 404 for a missing guardian', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app).get('/api/guardians/00000000-0000-0000-0000-000000000000').set('Cookie', cookie);
    expect(response.status).toBe(404);
  });

  it('returns full unmasked data on the detail endpoint', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/guardians')
      .set('Cookie', cookie)
      .send({ name: TEST_GUARDIAN_NAME, phone: TEST_GUARDIAN_PHONE });

    const detail = await request(app).get(`/api/guardians/${created.body.data.guardian.id}`).set('Cookie', cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.data.name).toBe(TEST_GUARDIAN_NAME);
    expect(detail.body.data.phoneNormalized).toBe(TEST_GUARDIAN_PHONE);
  });

  it('updates a guardian with optimistic locking', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/guardians')
      .set('Cookie', cookie)
      .send({ name: TEST_GUARDIAN_NAME, phone: TEST_GUARDIAN_PHONE });

    const edited = await request(app)
      .patch(`/api/guardians/${created.body.data.guardian.id}`)
      .set('Cookie', cookie)
      .send({ notes: '수정된 메모', expectedUpdatedAt: created.body.data.guardian.updatedAt });

    expect(edited.status).toBe(200);
    expect(edited.body.data.status).toBe('updated');
    expect(edited.body.data.guardian.notes).toBe('수정된 메모');

    const staleEdit = await request(app)
      .patch(`/api/guardians/${created.body.data.guardian.id}`)
      .set('Cookie', cookie)
      .send({ notes: '또 수정', expectedUpdatedAt: created.body.data.guardian.updatedAt });

    expect(staleEdit.status).toBe(409);
    expect(staleEdit.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('warns about a duplicate phone on update, until confirmDuplicate is set', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app).post('/api/guardians').set('Cookie', cookie).send({ name: TEST_GUARDIAN_NAME, phone: TEST_GUARDIAN_PHONE });
    const second = await request(app)
      .post('/api/guardians')
      .set('Cookie', cookie)
      .send({ name: 'test-guardian-박민수', phone: '01077776666', confirmDuplicate: true });

    const attempt = await request(app)
      .patch(`/api/guardians/${second.body.data.guardian.id}`)
      .set('Cookie', cookie)
      .send({ phone: TEST_GUARDIAN_PHONE, expectedUpdatedAt: second.body.data.guardian.updatedAt });

    expect(attempt.status).toBe(200);
    expect(attempt.body.data.status).toBe('duplicate_warning');

    await db.delete(guardians).where(eq(guardians.name, 'test-guardian-박민수'));
  });
});
