import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { integrationSettings, messagingDevices } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';
import { encryptToStorage, decryptFromStorage } from '../utils/encryption';
import type { PushbulletClient } from '../services/pushbullet';

const connectSchema = z.object({
  accessToken: z.string().min(1),
});

const patchDeviceSchema = z.object({
  nickname: z.string().min(1).optional(),
  isEnabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export interface MessagingSettingsRouterDeps {
  sessionSecret: string;
  pushbullet: PushbulletClient;
  tokenEncryptionKey: string;
}

async function getPushbulletIntegration() {
  const [row] = await db.select().from(integrationSettings).where(eq(integrationSettings.provider, 'pushbullet'));
  return row ?? null;
}

export function createMessagingSettingsRouter(deps: MessagingSettingsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireMessagingManage = createRequirePermission(PERMISSIONS.MESSAGING_MANAGE);

  router.get('/settings', requireAuth, requireMessagingManage, async (req, res) => {
    const integration = await getPushbulletIntegration();
    const deviceCount = integration
      ? (await db.select().from(messagingDevices).where(eq(messagingDevices.integrationId, integration.id))).length
      : 0;

    res.json({
      data: {
        pushbullet: integration
          ? {
              status: integration.status,
              displayName: integration.displayName,
              lastCheckedAt: integration.lastCheckedAt,
              lastErrorCode: integration.lastErrorCode,
              deviceCount,
            }
          : { status: 'disconnected', displayName: null, lastCheckedAt: null, lastErrorCode: null, deviceCount: 0 },
      },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.post('/pushbullet/connect', requireAuth, requireMessagingManage, async (req, res) => {
    const parsed = parseBody(connectSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const user = await deps.pushbullet.getUser(parsed.accessToken);
    if (!user) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Pushbullet 토큰이 유효하지 않습니다.', requestId: req.requestId },
      });
      return;
    }

    const encryptedConfig = encryptToStorage(JSON.stringify({ accessToken: parsed.accessToken }), deps.tokenEncryptionKey);
    const existing = await getPushbulletIntegration();
    const now = new Date();

    const [saved] = existing
      ? await db
          .update(integrationSettings)
          .set({
            displayName: user.email,
            encryptedConfig,
            status: 'connected',
            lastCheckedAt: now,
            lastErrorCode: null,
            updatedAt: now,
            updatedBy: req.admin!.id,
          })
          .where(eq(integrationSettings.id, existing.id))
          .returning()
      : await db
          .insert(integrationSettings)
          .values({
            provider: 'pushbullet',
            displayName: user.email,
            encryptedConfig,
            status: 'connected',
            lastCheckedAt: now,
            createdBy: req.admin!.id,
            updatedBy: req.admin!.id,
          })
          .returning();

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'messaging.pushbulletConnect',
      targetType: 'integrationSettings',
      targetId: saved!.id,
      beforeDataSafe: null,
      afterDataSafe: { displayName: user.email, status: 'connected' },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({
      data: { status: saved!.status, displayName: saved!.displayName },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.delete('/pushbullet', requireAuth, requireMessagingManage, async (req, res) => {
    const existing = await getPushbulletIntegration();
    if (!existing) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '연결된 Pushbullet 계정이 없습니다.', requestId: req.requestId } });
      return;
    }

    await db.delete(messagingDevices).where(eq(messagingDevices.integrationId, existing.id));
    await db
      .update(integrationSettings)
      .set({ encryptedConfig: null, status: 'disconnected', updatedAt: new Date(), updatedBy: req.admin!.id })
      .where(eq(integrationSettings.id, existing.id));

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'messaging.pushbulletDisconnect',
      targetType: 'integrationSettings',
      targetId: existing.id,
      beforeDataSafe: { status: existing.status },
      afterDataSafe: { status: 'disconnected' },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: { status: 'disconnected' }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/devices/sync', requireAuth, requireMessagingManage, async (req, res) => {
    const integration = await getPushbulletIntegration();
    if (!integration || integration.status !== 'connected' || !integration.encryptedConfig) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Pushbullet가 연결되어 있지 않습니다.', requestId: req.requestId },
      });
      return;
    }

    const { accessToken } = JSON.parse(decryptFromStorage(integration.encryptedConfig, deps.tokenEncryptionKey)) as {
      accessToken: string;
    };

    let devices;
    try {
      devices = await deps.pushbullet.listDevices(accessToken);
    } catch {
      await db
        .update(integrationSettings)
        .set({ status: 'error', lastErrorCode: 'PUSHBULLET_UNREACHABLE', lastCheckedAt: new Date() })
        .where(eq(integrationSettings.id, integration.id));
      res.status(502).json({ error: { code: 'INTEGRATION_ERROR', message: 'Pushbullet 기기 조회에 실패했습니다.', requestId: req.requestId } });
      return;
    }

    const now = new Date();
    for (const device of devices) {
      const [existingDevice] = await db
        .select()
        .from(messagingDevices)
        .where(and(eq(messagingDevices.integrationId, integration.id), eq(messagingDevices.externalDeviceId, device.iden)));

      if (existingDevice) {
        await db
          .update(messagingDevices)
          .set({ nickname: existingDevice.nickname, deviceType: device.type, lastSeenAt: now, updatedAt: now })
          .where(eq(messagingDevices.id, existingDevice.id));
      } else {
        await db.insert(messagingDevices).values({
          integrationId: integration.id,
          externalDeviceId: device.iden,
          nickname: device.nickname,
          deviceType: device.type,
          isEnabled: false,
          isDefault: false,
          lastSeenAt: now,
        });
      }
    }

    await db
      .update(integrationSettings)
      .set({ lastCheckedAt: now, status: 'connected', lastErrorCode: null })
      .where(eq(integrationSettings.id, integration.id));

    const allDevices = await db.select().from(messagingDevices).where(eq(messagingDevices.integrationId, integration.id));

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'messaging.devicesSync',
      targetType: 'integrationSettings',
      targetId: integration.id,
      beforeDataSafe: null,
      afterDataSafe: { deviceCount: allDevices.length },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: allDevices, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.get('/devices', requireAuth, requireMessagingManage, async (req, res) => {
    const integration = await getPushbulletIntegration();
    const rows = integration
      ? await db.select().from(messagingDevices).where(eq(messagingDevices.integrationId, integration.id))
      : [];
    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/devices/:id', requireAuth, requireMessagingManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const parsed = parseBody(patchDeviceSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(messagingDevices).where(eq(messagingDevices.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '기기를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    if (parsed.isDefault === true) {
      await db
        .update(messagingDevices)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(messagingDevices.integrationId, before.integrationId));
    }

    const [updated] = await db
      .update(messagingDevices)
      .set({ ...parsed, updatedAt: new Date() })
      .where(eq(messagingDevices.id, id))
      .returning();

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'messaging.deviceUpdate',
      targetType: 'messagingDevice',
      targetId: id,
      beforeDataSafe: { nickname: before.nickname, isEnabled: before.isEnabled, isDefault: before.isDefault },
      afterDataSafe: parsed,
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
