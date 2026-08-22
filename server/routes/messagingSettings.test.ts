import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, auditLogs, authSessions, integrationSettings, messagingDevices } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';
import type { PushbulletClient } from '../services/pushbullet';

const SUPER_EMAIL = 'test-messaging-super@example.com';
const PASSWORD = 'test-messaging-password-123';
const TOKEN_KEY = 'test-messaging-token-encryption-key-32-bytes';

function createFakePushbulletClient(valid: boolean): PushbulletClient {
  return {
    getUser: async () => (valid ? { email: 'device-owner@example.com', name: '기기 소유자' } : null),
    // PushbulletClient.listDevices is documented to already fall back to the device id when
    // Pushbullet reports no nickname (see services/pushbullet.ts) — mirror that here.
    listDevices: async () => [
      { iden: 'dev-1', nickname: '카운터 폰', type: 'android', active: true },
      { iden: 'dev-2', nickname: 'dev-2', type: 'android', active: true },
    ],
  };
}

async function seedAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-messaging-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
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

// integration_settings has one row per provider (unique constraint), so this suite's own
// connect/sync/disconnect calls operate on the *same* singleton row a real Pushbullet
// connection would use. Snapshot whatever's there before the suite runs and restore it
// exactly afterward, rather than unconditionally deleting — otherwise these tests would
// wipe out a real admin's live connection (see incident: this happened once in dev).
async function snapshotPushbulletIntegration() {
  const integration = await db.query.integrationSettings.findFirst({ where: eq(integrationSettings.provider, 'pushbullet') });
  if (!integration) return null;
  const devices = await db.select().from(messagingDevices).where(eq(messagingDevices.integrationId, integration.id));
  return { integration, devices };
}

async function clearPushbulletIntegration() {
  const current = await db.query.integrationSettings.findFirst({ where: eq(integrationSettings.provider, 'pushbullet') });
  if (current) {
    await db.delete(messagingDevices).where(eq(messagingDevices.integrationId, current.id));
    await db.delete(integrationSettings).where(eq(integrationSettings.id, current.id));
  }
}

async function restorePushbulletIntegration(snapshot: Awaited<ReturnType<typeof snapshotPushbulletIntegration>>) {
  await clearPushbulletIntegration();
  if (snapshot) {
    await db.insert(integrationSettings).values(snapshot.integration);
    if (snapshot.devices.length > 0) {
      await db.insert(messagingDevices).values(snapshot.devices);
    }
  }
}

async function cleanupAdminFixtures() {
  const adminToDelete = await db.query.admins.findFirst({ where: eq(admins.email, SUPER_EMAIL) });
  if (adminToDelete) {
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-messaging-role'));
}

describe('messaging settings routes', () => {
  let preExistingIntegration: Awaited<ReturnType<typeof snapshotPushbulletIntegration>>;

  beforeAll(async () => {
    preExistingIntegration = await snapshotPushbulletIntegration();
  });

  beforeEach(async () => {
    // Each test needs a clean slate — a pre-existing real connection would otherwise share
    // the same singleton row/device pool as whatever the test connects, breaking its assertions.
    await clearPushbulletIntegration();
  });

  afterEach(async () => {
    // Clear before deleting the test admin: a test-created integration_settings row
    // references it via created_by/updated_by, so the FK would block the admin delete otherwise.
    await clearPushbulletIntegration();
    await cleanupAdminFixtures();
  });

  afterAll(async () => {
    await restorePushbulletIntegration(preExistingIntegration);
  });

  it('rejects connecting an invalid Pushbullet token', async () => {
    await seedAdmin();
    const app = createApp({
      emailAdapter: createFakeEmailAdapter(),
      pushbullet: createFakePushbulletClient(false),
      pushbulletTokenEncryptionKey: TOKEN_KEY,
    });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app).post('/api/messaging/pushbullet/connect').set('Cookie', cookie).send({ accessToken: 'bad-token' });
    expect(response.status).toBe(400);
  });

  it('connects Pushbullet, syncs devices, enables one, sets it default, and disconnects', async () => {
    await seedAdmin();
    const app = createApp({
      emailAdapter: createFakeEmailAdapter(),
      pushbullet: createFakePushbulletClient(true),
      pushbulletTokenEncryptionKey: TOKEN_KEY,
    });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const connected = await request(app).post('/api/messaging/pushbullet/connect').set('Cookie', cookie).send({ accessToken: 'good-token' });
    expect(connected.status).toBe(200);
    expect(connected.body.data.status).toBe('connected');

    const settings = await request(app).get('/api/messaging/settings').set('Cookie', cookie);
    expect(settings.body.data.pushbullet.status).toBe('connected');
    expect(settings.body.data.pushbullet.displayName).toBe('device-owner@example.com');

    const synced = await request(app).post('/api/messaging/devices/sync').set('Cookie', cookie);
    expect(synced.status).toBe(200);
    expect(synced.body.data).toHaveLength(2);
    // A device with no Pushbullet nickname falls back to its external id so the admin still sees something.
    expect(synced.body.data.find((d: { externalDeviceId: string }) => d.externalDeviceId === 'dev-2').nickname).toBe('dev-2');
    // Newly synced devices must start disabled — the admin opts a device in explicitly before it can send.
    expect(synced.body.data.every((d: { isEnabled: boolean }) => d.isEnabled === false)).toBe(true);

    const targetDeviceId = synced.body.data[0].id;
    const patched = await request(app)
      .patch(`/api/messaging/devices/${targetDeviceId}`)
      .set('Cookie', cookie)
      .send({ nickname: '카운터 폰(1층)', isEnabled: true, isDefault: true });
    expect(patched.status).toBe(200);
    expect(patched.body.data.isDefault).toBe(true);

    const disconnected = await request(app).delete('/api/messaging/pushbullet').set('Cookie', cookie);
    expect(disconnected.status).toBe(200);

    const devicesAfterDisconnect = await request(app).get('/api/messaging/devices').set('Cookie', cookie);
    expect(devicesAfterDisconnect.body.data).toHaveLength(0);
  });
});
