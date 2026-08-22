import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import {
  admins,
  roles,
  messageCampaigns,
  messageRecipients,
  messageSendItems,
  messageAttempts,
  messagingDevices,
  integrationSettings,
  platformPresets,
  cardNewsProjects,
  cardNewsMedia,
  mediaAssets,
  uploadSessions,
} from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';
import { encryptToStorage } from '../utils/encryption';
import type { PushbulletSmsClient } from '../services/pushbulletSms';
import type { CloudinaryClient } from '../services/cloudinary';
import {
  clearPushbulletIntegration,
  restorePushbulletIntegration,
  snapshotPushbulletIntegration,
  type PushbulletIntegrationSnapshot,
} from '../testUtils/pushbulletIntegrationFixture';

const SUPER_EMAIL = 'test-cron-super@example.com';
const TOKEN_KEY = 'test-cron-token-encryption-key-32-b';
const CRON_SECRET = 'test-cron-secret-value';
const CAMPAIGN_NAME = 'test-cron-campaign';
const PRESET_NAME = 'test-cron-preset';
const PROJECT_NAME = 'test-cron-project';

function fakeSms(): PushbulletSmsClient {
  return { sendSms: async (params) => ({ iden: `fake-${params.guid}`, status: 'requested' }) };
}

function fakeCloudinary(): CloudinaryClient {
  return {
    sign: () => 'fake-signature',
    getResource: async () => null,
    destroy: async () => {},
    uploadBuffer: async () => {
      throw new Error('uploadBuffer not used by cron routes tests');
    },
  };
}

async function seedAdminAndDevice() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-cron-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
    .returning();
  const [admin] = await db
    .insert(admins)
    .values({ email: SUPER_EMAIL, name: '수퍼', passwordHash: await hashPassword('irrelevant-password-123'), roleId: role!.id, status: 'active', createdAt: new Date(), updatedAt: new Date() })
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
  return { adminId: admin!.id, deviceId: device!.id };
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

  const projects = await db.select({ id: cardNewsProjects.id }).from(cardNewsProjects).where(eq(cardNewsProjects.name, PROJECT_NAME));
  for (const p of projects) {
    await db.delete(cardNewsMedia).where(eq(cardNewsMedia.projectId, p.id));
    await db.delete(cardNewsProjects).where(eq(cardNewsProjects.id, p.id));
  }
  await db.delete(mediaAssets).where(eq(mediaAssets.purpose, 'test-cron'));
  await db.delete(platformPresets).where(eq(platformPresets.name, PRESET_NAME));
  await db.delete(uploadSessions).where(eq(uploadSessions.purpose, 'test-cron'));
}

async function cleanupAdmin() {
  const admin = await db.query.admins.findFirst({ where: eq(admins.email, SUPER_EMAIL) });
  if (admin) await db.delete(admins).where(eq(admins.id, admin.id));
  await db.delete(roles).where(eq(roles.name, 'test-cron-role'));
}

describe('cron routes', () => {
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

  it('rejects a request with the wrong cron secret', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter(), cronSecret: CRON_SECRET, pushbulletSms: fakeSms(), pushbulletTokenEncryptionKey: TOKEN_KEY });
    const response = await request(app).post('/api/cron/process-message-queue').set('Authorization', 'Bearer wrong-secret');
    expect(response.status).toBe(401);
  });

  it('dispatches a due scheduled campaign', async () => {
    const { deviceId } = await seedAdminAndDevice();
    const [campaign] = await db
      .insert(messageCampaigns)
      .values({
        name: CAMPAIGN_NAME,
        messageType: 'informational',
        bodySource: '안내',
        recipientType: 'individual',
        idempotencyKey: crypto.randomUUID(),
        status: 'scheduled',
        scheduledAt: new Date(Date.now() - 60_000),
        deviceId,
      })
      .returning();
    const [recipient] = await db
      .insert(messageRecipients)
      .values({ campaignId: campaign!.id, phoneNormalized: '01011112222', renderedBody: '안내', status: 'included' })
      .returning();
    await db.insert(messageSendItems).values({ campaignId: campaign!.id, recipientId: recipient!.id, sequenceNo: 0, idempotencyKey: crypto.randomUUID() });

    const app = createApp({ emailAdapter: createFakeEmailAdapter(), cronSecret: CRON_SECRET, pushbulletSms: fakeSms(), pushbulletTokenEncryptionKey: TOKEN_KEY });
    const response = await request(app).post('/api/cron/process-message-queue').set('Authorization', `Bearer ${CRON_SECRET}`);
    expect(response.status).toBe(200);
    expect(response.body.data.processed).toBe(1);
    expect(response.body.data.results[0].outcome).toBe('dispatched');

    const [updated] = await db.select().from(messageCampaigns).where(eq(messageCampaigns.id, campaign!.id));
    expect(updated!.status).toBe('completed');
  });

  it('expires a card-news project past its 7-day cutoff and deletes its Cloudinary media', async () => {
    const { adminId } = await seedAdminAndDevice();
    const [preset] = await db
      .insert(platformPresets)
      .values({ platform: 'instagram', postType: 'feed', name: PRESET_NAME, widthPx: 1080, heightPx: 1080, createdBy: adminId, updatedBy: adminId })
      .returning();
    const [media] = await db
      .insert(mediaAssets)
      .values({
        ownerAdminId: adminId,
        purpose: 'test-cron',
        targetType: 'cardNewsProject',
        cloudinaryPublicId: 'test-cron/photo',
        secureUrl: 'https://res.cloudinary.com/test/image/upload/photo.jpg',
        resourceType: 'image',
        bytes: 100,
        status: 'active',
      })
      .returning();
    const [project] = await db
      .insert(cardNewsProjects)
      .values({
        name: PROJECT_NAME,
        presetId: preset!.id,
        status: 'ready',
        expiresAt: new Date(Date.now() - 1000),
        createdBy: adminId,
        updatedBy: adminId,
      })
      .returning();
    await db.insert(cardNewsMedia).values({ projectId: project!.id, mediaId: media!.id, role: 'source', sortOrder: 0 });

    const app = createApp({ emailAdapter: createFakeEmailAdapter(), cronSecret: CRON_SECRET, cloudinary: fakeCloudinary() });
    const response = await request(app).post('/api/cron/cleanup-card-news').set('Authorization', `Bearer ${CRON_SECRET}`);
    expect(response.status).toBe(200);
    expect(response.body.data.processed).toBe(1);
    expect(response.body.data.mediaDeleted).toBe(1);

    const [updatedProject] = await db.select().from(cardNewsProjects).where(eq(cardNewsProjects.id, project!.id));
    expect(updatedProject!.status).toBe('expired');
    const [updatedMedia] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, media!.id));
    expect(updatedMedia!.status).toBe('deleted');
  });

  it('flags upload sessions past their expiry as expired', async () => {
    const { adminId } = await seedAdminAndDevice();
    await db.insert(uploadSessions).values({
      ownerAdminId: adminId,
      purpose: 'test-cron',
      targetType: 'test',
      expectedResourceType: 'image',
      expectedFolder: 'test-cron/x',
      status: 'pending',
      expiresAt: new Date(Date.now() - 1000),
    });

    const app = createApp({ emailAdapter: createFakeEmailAdapter(), cronSecret: CRON_SECRET });
    const response = await request(app).post('/api/cron/scan-orphan-media').set('Authorization', `Bearer ${CRON_SECRET}`);
    expect(response.status).toBe(200);
    expect(response.body.data.flagged).toBe(1);
  });
});
