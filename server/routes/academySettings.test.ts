import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, academySettings, auditLogs, authSessions, passwordResetTokens } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-academy-settings-super@example.com';
const PASSWORD = 'test-academy-settings-password-123';

async function seedSuperAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-academy-settings-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION] })
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
  return { role };
}

async function loginAs(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('login did not set a session cookie');
  return cookie;
}

async function cleanup() {
  const adminToDelete = await db.query.admins.findFirst({
    where: eq(admins.email, SUPER_EMAIL),
  });
  if (adminToDelete) {
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.adminId, adminToDelete.id));
    await db.update(academySettings).set({ updatedBy: null }).where(eq(academySettings.updatedBy, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-academy-settings-role'));
}

// The `academy_settings` table is a real singleton row shared with the actual dev
// environment (there is no per-test isolated DB). Any test that PATCHes it must
// snapshot the row's exact content beforehand and restore it afterward, the same
// way this codebase preserves other real/shared rows in tests.
type AcademySettingsRow = typeof academySettings.$inferSelect;

async function snapshotAcademySettings(): Promise<AcademySettingsRow | undefined> {
  const [existing] = await db.select().from(academySettings).limit(1);
  return existing;
}

async function restoreAcademySettings(snapshot: AcademySettingsRow | undefined): Promise<void> {
  if (!snapshot) return;
  await db
    .update(academySettings)
    .set({
      academyName: snapshot.academyName,
      phoneNormalized: snapshot.phoneNormalized,
      address: snapshot.address,
      senderName: snapshot.senderName,
      logoMediaId: snapshot.logoMediaId,
      brandColors: snapshot.brandColors,
      brandFonts: snapshot.brandFonts,
      updatedBy: snapshot.updatedBy,
      updatedAt: snapshot.updatedAt,
    })
    .where(eq(academySettings.id, snapshot.id));
}

describe('academy settings routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/settings/academy');
    expect(response.status).toBe(401);
  });

  it('lazily creates the single settings row on first GET, then returns the same row on subsequent calls', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const first = await request(app).get('/api/settings/academy').set('Cookie', cookie);
    expect(first.status).toBe(200);
    expect(first.body.data.id).toEqual(expect.any(String));

    const second = await request(app).get('/api/settings/academy').set('Cookie', cookie);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);

    const rows = await db.select().from(academySettings);
    expect(rows).toHaveLength(1);
  });

  it('updates the settings and reflects the change on the next GET', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const before = await request(app).get('/api/settings/academy').set('Cookie', cookie);
    const snapshot = await snapshotAcademySettings();

    try {
      const patchResponse = await request(app)
        .patch('/api/settings/academy')
        .set('Cookie', cookie)
        .send({
          academyName: '강남 학원',
          phoneNormalized: '0212345678',
          expectedUpdatedAt: before.body.data.updatedAt,
        });
      expect(patchResponse.status).toBe(200);
      expect(patchResponse.body.data.academyName).toBe('강남 학원');

      const getResponse = await request(app).get('/api/settings/academy').set('Cookie', cookie);
      expect(getResponse.body.data.academyName).toBe('강남 학원');
      expect(getResponse.body.data.phoneNormalized).toBe('0212345678');
    } finally {
      await restoreAcademySettings(snapshot);
    }
  });

  it('rejects a PATCH with a stale expectedUpdatedAt with 409 VERSION_CONFLICT', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const before = await request(app).get('/api/settings/academy').set('Cookie', cookie);
    const snapshot = await snapshotAcademySettings();

    try {
      const staleTimestamp = new Date(Date.parse(before.body.data.updatedAt) - 1000).toISOString();
      const patchResponse = await request(app)
        .patch('/api/settings/academy')
        .set('Cookie', cookie)
        .send({ academyName: '다른 이름', expectedUpdatedAt: staleTimestamp });

      expect(patchResponse.status).toBe(409);
      expect(patchResponse.body.error.code).toBe('VERSION_CONFLICT');
    } finally {
      await restoreAcademySettings(snapshot);
    }
  });
});
