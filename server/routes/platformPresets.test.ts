import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, auditLogs, authSessions, platformPresets } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-presets-super@example.com';
const PASSWORD = 'test-presets-password-123';
const PRESET_NAME = 'test-presets-인스타그램 정사각형';

async function seedAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-presets-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
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
  await db.delete(platformPresets).where(eq(platformPresets.name, PRESET_NAME));

  const adminToDelete = await db.query.admins.findFirst({ where: eq(admins.email, SUPER_EMAIL) });
  if (adminToDelete) {
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-presets-role'));
}

describe('platform presets routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/platform-presets');
    expect(response.status).toBe(401);
  });

  it('creates, updates, and deactivates-on-conflict a preset', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/platform-presets')
      .set('Cookie', cookie)
      .send({ platform: 'instagram', postType: 'feed', name: PRESET_NAME, widthPx: 1080, heightPx: 1080 });
    expect(created.status).toBe(200);
    expect(created.body.data.isActive).toBe(true);

    const list = await request(app).get('/api/platform-presets').set('Cookie', cookie);
    expect(list.body.data.some((p: { id: string }) => p.id === created.body.data.id)).toBe(true);

    const updated = await request(app)
      .patch(`/api/platform-presets/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ widthPx: 1350, expectedUpdatedAt: created.body.data.updatedAt });
    expect(updated.status).toBe(200);
    expect(updated.body.data.widthPx).toBe(1350);

    const deleted = await request(app).delete(`/api/platform-presets/${created.body.data.id}`).set('Cookie', cookie);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.status).toBe('deleted');
  });
});
