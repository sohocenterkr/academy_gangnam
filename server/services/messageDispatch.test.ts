import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
} from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { dispatchCampaign } from './messageDispatch';
import type { PushbulletSmsClient, SendSmsResult } from './pushbulletSms';
import {
  clearPushbulletIntegration,
  restorePushbulletIntegration,
  snapshotPushbulletIntegration,
  type PushbulletIntegrationSnapshot,
} from '../testUtils/pushbulletIntegrationFixture';

const SUPER_EMAIL = 'test-dispatch-super@example.com';
const TOKEN_KEY = 'test-dispatch-token-encryption-key-32-bytes';

function createFakeSmsClient(shouldFail: (address: string) => boolean): PushbulletSmsClient {
  return {
    sendSms: async (params): Promise<SendSmsResult> => {
      if (shouldFail(params.addresses[0]!)) throw new Error('simulated carrier rejection');
      return { iden: `fake-${params.guid}`, status: 'requested' };
    },
  };
}

async function seedCampaign(recipientPhones: string[]) {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-dispatch-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
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
      encryptedConfig: (await import('../utils/encryption')).encryptToStorage(JSON.stringify({ accessToken: 'fake-token' }), TOKEN_KEY),
      status: 'connected',
      createdBy: admin!.id,
      updatedBy: admin!.id,
    })
    .returning();
  const [device] = await db
    .insert(messagingDevices)
    .values({ integrationId: integration!.id, externalDeviceId: 'dev-x', nickname: '기기', isEnabled: true })
    .returning();
  const [campaign] = await db
    .insert(messageCampaigns)
    .values({
      name: 'test-dispatch-campaign',
      messageType: 'informational',
      bodySource: '안내드립니다.',
      recipientType: 'individual',
      idempotencyKey: crypto.randomUUID(),
      status: 'queued',
      deviceId: device!.id,
      createdBy: admin!.id,
    })
    .returning();

  for (const phone of recipientPhones) {
    const [recipient] = await db
      .insert(messageRecipients)
      .values({ campaignId: campaign!.id, phoneNormalized: phone, renderedBody: '안내드립니다.', status: 'included' })
      .returning();
    await db.insert(messageSendItems).values({ campaignId: campaign!.id, recipientId: recipient!.id, sequenceNo: 0, idempotencyKey: crypto.randomUUID() });
  }

  return { campaignId: campaign!.id, deviceId: device!.id };
}

async function cleanup() {
  const campaigns = await db.select({ id: messageCampaigns.id }).from(messageCampaigns).where(eq(messageCampaigns.name, 'test-dispatch-campaign'));
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
  if (admin) await db.delete(admins).where(eq(admins.id, admin.id));
  await db.delete(roles).where(eq(roles.name, 'test-dispatch-role'));
}

describe('dispatchCampaign', () => {
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

  it('sends every pending item, marks recipients/items device_requested, and completes the campaign', async () => {
    const { campaignId } = await seedCampaign(['01011112222', '01033334444']);

    const outcome = await dispatchCampaign(campaignId, { pushbulletSms: createFakeSmsClient(() => false), tokenEncryptionKey: TOKEN_KEY });
    expect(outcome.status).toBe('dispatched');

    const [campaign] = await db.select().from(messageCampaigns).where(eq(messageCampaigns.id, campaignId));
    expect(campaign!.status).toBe('completed');
    expect(campaign!.failedCount).toBe(0);

    const recipients = await db.select().from(messageRecipients).where(eq(messageRecipients.campaignId, campaignId));
    expect(recipients.every((r) => r.status === 'device_requested')).toBe(true);

    const items = await db.select().from(messageSendItems).where(eq(messageSendItems.campaignId, campaignId));
    expect(items.every((i) => i.status === 'device_requested')).toBe(true);

    const attempts = await db.select().from(messageAttempts);
    expect(attempts.length).toBeGreaterThanOrEqual(2);
  });

  it('marks the campaign partial when some recipients fail, and refuses to re-dispatch a non-queued campaign', async () => {
    const { campaignId } = await seedCampaign(['01011112222', '01099998888']);

    const outcome = await dispatchCampaign(campaignId, {
      pushbulletSms: createFakeSmsClient((address) => address === '01099998888'),
      tokenEncryptionKey: TOKEN_KEY,
    });
    expect(outcome.status).toBe('dispatched');

    const [campaign] = await db.select().from(messageCampaigns).where(eq(messageCampaigns.id, campaignId));
    expect(campaign!.status).toBe('partial');
    expect(campaign!.failedCount).toBe(1);

    // Re-invoking after completion must not re-process — job-lease guard (spec §14.3).
    const second = await dispatchCampaign(campaignId, { pushbulletSms: createFakeSmsClient(() => false), tokenEncryptionKey: TOKEN_KEY });
    expect(second).toEqual({ status: 'not_ready', campaignStatus: 'partial' });
  });
});
