import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import {
  admins,
  roles,
  auditLogs,
  authSessions,
  messageCampaigns,
  messageRecipients,
  messageSendItems,
  messageAttempts,
  messagingDevices,
  integrationSettings,
} from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';
import { encryptToStorage } from '../utils/encryption';
import type { PushbulletSmsClient } from '../services/pushbulletSms';
import {
  clearPushbulletIntegration,
  restorePushbulletIntegration,
  snapshotPushbulletIntegration,
  type PushbulletIntegrationSnapshot,
} from '../testUtils/pushbulletIntegrationFixture';

const SUPER_EMAIL = 'test-campaigns-super@example.com';
const PASSWORD = 'test-campaigns-password-123';
const TOKEN_KEY = 'test-campaigns-token-encryption-key-32';
const CAMPAIGN_NAME = 'test-campaigns-run';

function fakeSms(): PushbulletSmsClient {
  return { sendSms: async (params) => ({ iden: `fake-${params.guid}`, status: 'requested' }) };
}

async function seedFixtures() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-campaigns-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
    .returning();
  const [admin] = await db
    .insert(admins)
    .values({ email: SUPER_EMAIL, name: '수퍼', passwordHash: await hashPassword(PASSWORD), roleId: role!.id, status: 'active', createdAt: new Date(), updatedAt: new Date() })
    .returning();
  const [integration] = await db
    .insert(integrationSettings)
    .values({
      provider: 'pushbullet',
      displayName: 'test',
      encryptedConfig: encryptToStorage(JSON.stringify({ accessToken: 'fake-token' }), TOKEN_KEY),
      status: 'connected',
      createdBy: admin!.id,
      updatedBy: admin!.id,
    })
    .returning();
  const [device] = await db
    .insert(messagingDevices)
    .values({ integrationId: integration!.id, externalDeviceId: 'dev-x', nickname: '기기', isEnabled: true })
    .returning();
  return { deviceId: device!.id };
}

async function seedCampaign(status: 'queued' | 'ready', deviceId: string, withOneRecipient: boolean) {
  const [campaign] = await db
    .insert(messageCampaigns)
    .values({ name: CAMPAIGN_NAME, messageType: 'informational', bodySource: '안내', recipientType: 'individual', idempotencyKey: crypto.randomUUID(), status, deviceId })
    .returning();
  if (withOneRecipient) {
    const [recipient] = await db
      .insert(messageRecipients)
      .values({ campaignId: campaign!.id, phoneNormalized: '01011112222', renderedBody: '안내', status: 'included' })
      .returning();
    await db.insert(messageSendItems).values({ campaignId: campaign!.id, recipientId: recipient!.id, sequenceNo: 0, idempotencyKey: crypto.randomUUID() });
  }
  return campaign!.id;
}

async function loginAs(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('login did not return a session cookie');
  return cookie;
}

async function cleanup() {
  const campaigns = await db.select({ id: messageCampaigns.id }).from(messageCampaigns).where(eq(messageCampaigns.name, CAMPAIGN_NAME));
  for (const c of campaigns) {
    const recipients = await db.select({ id: messageRecipients.id }).from(messageRecipients).where(eq(messageRecipients.campaignId, c.id));
    for (const r of recipients) {
      const items = await db.select({ id: messageSendItems.id }).from(messageSendItems).where(eq(messageSendItems.recipientId, r.id));
      for (const item of items) await db.delete(messageAttempts).where(eq(messageAttempts.sendItemId, item.id));
    }
    await db.delete(messageSendItems).where(eq(messageSendItems.campaignId, c.id));
    await db.delete(messageRecipients).where(eq(messageRecipients.campaignId, c.id));
    await db.delete(messageCampaigns).where(eq(messageCampaigns.id, c.id));
  }
}

async function cleanupAdmin() {
  const admin = await db.query.admins.findFirst({ where: eq(admins.email, SUPER_EMAIL) });
  if (admin) {
    await db.delete(auditLogs).where(eq(auditLogs.adminId, admin.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, admin.id));
    await db.delete(admins).where(eq(admins.id, admin.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-campaigns-role'));
}

describe('message campaigns routes', () => {
  let preExistingIntegration: PushbulletIntegrationSnapshot;

  beforeAll(async () => {
    preExistingIntegration = await snapshotPushbulletIntegration();
  });

  beforeEach(async () => {
    await clearPushbulletIntegration();
  });

  afterEach(async () => {
    await cleanup();
    await clearPushbulletIntegration();
    await cleanupAdmin();
  });

  afterAll(async () => {
    await restorePushbulletIntegration(preExistingIntegration);
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/message-campaigns');
    expect(response.status).toBe(401);
  });

  it('dispatches a queued campaign end to end via the API', async () => {
    const { deviceId } = await seedFixtures();
    const campaignId = await seedCampaign('queued', deviceId, true);
    const app = createApp({ emailAdapter: createFakeEmailAdapter(), pushbulletSms: fakeSms(), pushbulletTokenEncryptionKey: TOKEN_KEY });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const dispatched = await request(app).post(`/api/message-campaigns/${campaignId}/dispatch`).set('Cookie', cookie);
    expect(dispatched.status).toBe(200);
    expect(dispatched.body.data.status).toBe('completed');

    const list = await request(app).get('/api/message-campaigns').set('Cookie', cookie);
    expect(list.body.data.some((c: { id: string }) => c.id === campaignId)).toBe(true);

    const recipients = await request(app).get(`/api/message-campaigns/${campaignId}/recipients`).set('Cookie', cookie);
    expect(recipients.body.data[0].status).toBe('device_requested');
  });

  it('cancels a ready campaign and refuses to cancel one already dispatching', async () => {
    const { deviceId } = await seedFixtures();
    const campaignId = await seedCampaign('ready', deviceId, false);
    const app = createApp({ emailAdapter: createFakeEmailAdapter(), pushbulletSms: fakeSms(), pushbulletTokenEncryptionKey: TOKEN_KEY });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const canceled = await request(app).post(`/api/message-campaigns/${campaignId}/cancel`).set('Cookie', cookie);
    expect(canceled.status).toBe(200);
    expect(canceled.body.data.status).toBe('canceled');

    const secondCancel = await request(app).post(`/api/message-campaigns/${campaignId}/cancel`).set('Cookie', cookie);
    expect(secondCancel.status).toBe(409);
  });
});
