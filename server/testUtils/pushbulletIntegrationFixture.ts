import { eq } from 'drizzle-orm';
import { db } from '../db';
import { integrationSettings, messagingDevices } from '@shared/schema';

// integration_settings has one row per provider (unique constraint), so any test that touches
// the pushbullet integration is operating on the same singleton row a real connection would use.
// Snapshot whatever's there before the suite runs, clear it for test isolation, and restore the
// original afterward — otherwise the suite can silently delete a real admin's live connection.
// (This happened repeatedly in dev before vitest.config.ts set fileParallelism: false for the
// server project — without it, two suites doing snapshot/clear/restore on this same row at once
// could interleave and corrupt or lose the real connection. Do not remove that setting without
// replacing this protection some other way.)

export type PushbulletIntegrationSnapshot = Awaited<ReturnType<typeof snapshotPushbulletIntegration>>;

export async function snapshotPushbulletIntegration() {
  const integration = await db.query.integrationSettings.findFirst({ where: eq(integrationSettings.provider, 'pushbullet') });
  if (!integration) return null;
  const devices = await db.select().from(messagingDevices).where(eq(messagingDevices.integrationId, integration.id));
  return { integration, devices };
}

export async function clearPushbulletIntegration() {
  const current = await db.query.integrationSettings.findFirst({ where: eq(integrationSettings.provider, 'pushbullet') });
  if (current) {
    await db.delete(messagingDevices).where(eq(messagingDevices.integrationId, current.id));
    await db.delete(integrationSettings).where(eq(integrationSettings.id, current.id));
  }
}

export async function restorePushbulletIntegration(snapshot: PushbulletIntegrationSnapshot) {
  await clearPushbulletIntegration();
  if (snapshot) {
    await db.insert(integrationSettings).values(snapshot.integration);
    if (snapshot.devices.length > 0) {
      await db.insert(messagingDevices).values(snapshot.devices);
    }
  }
}
