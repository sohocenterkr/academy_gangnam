import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import {
  messageCampaigns,
  messageRecipients,
  messageSendItems,
  messageAttempts,
  messagingDevices,
  integrationSettings,
  mediaAssets,
} from '@shared/schema';
import { decryptFromStorage } from '../utils/encryption';
import type { PushbulletSmsClient } from './pushbulletSms';

const BATCH_SIZE = 20;
const BATCH_DELAY_MIN_MS = 250;
const BATCH_DELAY_MAX_MS = 500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function batchDelay() {
  return BATCH_DELAY_MIN_MS + Math.random() * (BATCH_DELAY_MAX_MS - BATCH_DELAY_MIN_MS);
}

export interface DispatchDeps {
  pushbulletSms: PushbulletSmsClient;
  tokenEncryptionKey: string;
}

export type DispatchOutcome = { status: 'not_found' } | { status: 'not_ready'; campaignStatus: string } | { status: 'dispatched' };

/**
 * Sends every pending message_send_item for a campaign through Pushbullet, 20 recipients at a
 * time with a 250-500ms random gap between batches (per the user's confirmed policy — matches
 * their other SMS site's smsgateway.ts/scheduler.ts). Safe to re-invoke: claims the campaign
 * with a conditional status update first (job-lease pattern, spec §14.3) so two concurrent
 * dispatches can't both process it, and only touches send_items still in 'pending'.
 */
export async function dispatchCampaign(campaignId: string, deps: DispatchDeps): Promise<DispatchOutcome> {
  const [campaign] = await db.select().from(messageCampaigns).where(eq(messageCampaigns.id, campaignId));
  if (!campaign) return { status: 'not_found' };
  if (campaign.status !== 'queued' && campaign.status !== 'scheduled') {
    return { status: 'not_ready', campaignStatus: campaign.status };
  }

  const [claimed] = await db
    .update(messageCampaigns)
    .set({ status: 'dispatching', startedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(messageCampaigns.id, campaignId), inArray(messageCampaigns.status, ['queued', 'scheduled'])))
    .returning();
  if (!claimed) return { status: 'not_ready', campaignStatus: campaign.status };

  if (!campaign.deviceId) throw new Error('Campaign has no device assigned');
  const [device] = await db.select().from(messagingDevices).where(eq(messagingDevices.id, campaign.deviceId));
  if (!device) throw new Error('Assigned device no longer exists');
  const [integration] = await db.select().from(integrationSettings).where(eq(integrationSettings.id, device.integrationId));
  if (!integration?.encryptedConfig) throw new Error('Pushbullet is not connected');
  const { accessToken } = JSON.parse(decryptFromStorage(integration.encryptedConfig, deps.tokenEncryptionKey)) as { accessToken: string };

  const pendingItems = await db
    .select()
    .from(messageSendItems)
    .where(and(eq(messageSendItems.campaignId, campaignId), eq(messageSendItems.status, 'pending')))
    .orderBy(messageSendItems.sequenceNo);

  const byRecipient = new Map<string, typeof pendingItems>();
  for (const item of pendingItems) {
    const list = byRecipient.get(item.recipientId) ?? [];
    list.push(item);
    byRecipient.set(item.recipientId, list);
  }
  const recipientIds = [...byRecipient.keys()];

  let failedCount = 0;
  for (let i = 0; i < recipientIds.length; i += BATCH_SIZE) {
    const batch = recipientIds.slice(i, i + BATCH_SIZE);
    for (const recipientId of batch) {
      const items = byRecipient.get(recipientId)!;
      const [recipient] = await db.select().from(messageRecipients).where(eq(messageRecipients.id, recipientId));
      if (!recipient) continue;

      await db.update(messageRecipients).set({ status: 'processing', updatedAt: new Date() }).where(eq(messageRecipients.id, recipientId));

      let recipientFailed = false;
      for (const item of items) {
        await db.update(messageSendItems).set({ status: 'processing', requestedAt: new Date() }).where(eq(messageSendItems.id, item.id));

        let mediaUrl: string | undefined;
        if (item.mediaId) {
          const [media] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, item.mediaId));
          mediaUrl = media?.secureUrl;
        }

        try {
          const result = await deps.pushbulletSms.sendSms({
            accessToken,
            targetDeviceIden: device.externalDeviceId,
            addresses: [recipient.phoneNormalized],
            message: recipient.renderedBody ?? '',
            guid: item.idempotencyKey,
            fileUrl: mediaUrl,
          });
          await db
            .update(messageSendItems)
            .set({ status: 'device_requested', completedAt: new Date() })
            .where(eq(messageSendItems.id, item.id));
          await db.insert(messageAttempts).values({
            sendItemId: item.id,
            deviceId: device.id,
            requestStatus: result.status,
            externalReference: result.iden,
            respondedAt: new Date(),
          });
        } catch (error) {
          recipientFailed = true;
          const message = error instanceof Error ? error.message.slice(0, 500) : 'unknown error';
          await db
            .update(messageSendItems)
            .set({ status: 'request_failed', completedAt: new Date(), lastErrorCode: 'PUSHBULLET_REQUEST_FAILED', lastErrorMessageSafe: message })
            .where(eq(messageSendItems.id, item.id));
          await db.insert(messageAttempts).values({
            sendItemId: item.id,
            deviceId: device.id,
            requestStatus: 'request_failed',
            respondedAt: new Date(),
            errorCode: 'PUSHBULLET_REQUEST_FAILED',
            errorMessageSafe: message,
          });
        }
      }

      if (recipientFailed) failedCount += 1;
      await db
        .update(messageRecipients)
        .set({ status: recipientFailed ? 'request_failed' : 'device_requested', updatedAt: new Date() })
        .where(eq(messageRecipients.id, recipientId));
    }

    if (i + BATCH_SIZE < recipientIds.length) {
      await sleep(batchDelay());
    }
  }

  const finalStatus = failedCount === 0 ? 'completed' : failedCount === recipientIds.length ? 'failed' : 'partial';
  await db
    .update(messageCampaigns)
    .set({ status: finalStatus, finishedAt: new Date(), failedCount, updatedAt: new Date() })
    .where(eq(messageCampaigns.id, campaignId));

  return { status: 'dispatched' };
}
