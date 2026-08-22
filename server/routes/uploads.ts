import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { uploadSessions, mediaAssets } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';
import type { CloudinaryClient } from '../services/cloudinary';

const UPLOAD_SESSION_TTL_MS = 5 * 60 * 1000;

const signSchema = z.object({
  purpose: z.string().min(1),
  targetType: z.string().min(1),
  targetId: z.string().optional(),
  resourceType: z.enum(['image', 'video', 'raw']),
});

const finalizeSchema = z.object({
  publicId: z.string().min(1),
});

export interface UploadsRouterDeps {
  sessionSecret: string;
  cloudinary: CloudinaryClient;
  cloudName: string;
  apiKey: string;
  uploadRoot: string;
}

export function createUploadsRouter(deps: UploadsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireMediaManage = createRequirePermission(PERMISSIONS.MEDIA_MANAGE);

  router.post('/sign', requireAuth, requireMediaManage, async (req, res) => {
    const parsed = parseBody(signSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const expiresAt = new Date(Date.now() + UPLOAD_SESSION_TTL_MS);
    const folder = `${deps.uploadRoot}/${parsed.purpose}`;

    const [session] = await db
      .insert(uploadSessions)
      .values({
        ownerAdminId: req.admin!.id,
        purpose: parsed.purpose,
        targetType: parsed.targetType,
        targetId: parsed.targetId ?? null,
        expectedResourceType: parsed.resourceType,
        expectedFolder: folder,
        expiresAt,
        status: 'pending',
      })
      .returning();
    if (!session) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '업로드 세션 생성에 실패했습니다.', requestId: req.requestId } });
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = deps.cloudinary.sign({ timestamp, folder });

    res.json({
      data: {
        uploadSessionId: session.id,
        cloudName: deps.cloudName,
        apiKey: deps.apiKey,
        timestamp,
        folder,
        signature,
        resourceType: parsed.resourceType,
        expiresAt: expiresAt.toISOString(),
      },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.post('/:sessionId/finalize', requireAuth, requireMediaManage, async (req, res) => {
    const sessionId = req.params.sessionId;
    if (!sessionId || Array.isArray(sessionId)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(finalizeSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [session] = await db.select().from(uploadSessions).where(eq(uploadSessions.id, sessionId));
    if (!session || session.ownerAdminId !== req.admin!.id) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '업로드 세션을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    if (session.status !== 'pending') {
      res.status(410).json({ error: { code: 'SESSION_EXPIRED', message: '이미 처리된 업로드 세션입니다.', requestId: req.requestId } });
      return;
    }
    if (session.expiresAt.getTime() < Date.now()) {
      await db.update(uploadSessions).set({ status: 'expired' }).where(eq(uploadSessions.id, sessionId));
      res.status(410).json({ error: { code: 'SESSION_EXPIRED', message: '업로드 세션이 만료되었습니다.', requestId: req.requestId } });
      return;
    }
    if (!parsed.publicId.startsWith(`${session.expectedFolder}/`)) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: '업로드 위치가 요청한 세션과 일치하지 않습니다.', requestId: req.requestId },
      });
      return;
    }

    const resource = await deps.cloudinary.getResource(parsed.publicId, session.expectedResourceType);
    if (!resource) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Cloudinary에서 파일을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    if (resource.resourceType !== session.expectedResourceType) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: '업로드된 파일 형식이 요청과 일치하지 않습니다.', requestId: req.requestId },
      });
      return;
    }

    const [asset] = await db
      .insert(mediaAssets)
      .values({
        ownerAdminId: req.admin!.id,
        purpose: session.purpose,
        targetType: session.targetType,
        targetId: session.targetId,
        cloudinaryPublicId: resource.publicId,
        cloudinaryAssetId: resource.assetId,
        secureUrl: resource.secureUrl,
        resourceType: resource.resourceType,
        format: resource.format,
        mimeType: null,
        bytes: resource.bytes,
        width: resource.width,
        height: resource.height,
        duration: resource.duration,
        status: 'active',
      })
      .returning();
    if (!asset) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '파일 등록에 실패했습니다.', requestId: req.requestId } });
      return;
    }

    await db.update(uploadSessions).set({ status: 'completed', completedAt: new Date() }).where(eq(uploadSessions.id, sessionId));

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'media.finalize',
      targetType: 'mediaAsset',
      targetId: asset.id,
      beforeDataSafe: null,
      afterDataSafe: { purpose: asset.purpose, targetType: asset.targetType, resourceType: asset.resourceType },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: asset, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.delete('/media/:id', requireAuth, requireMediaManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [before] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id));
    if (!before || before.status === 'deleted') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '파일을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    await deps.cloudinary.destroy(before.cloudinaryPublicId, before.resourceType);

    const [updated] = await db
      .update(mediaAssets)
      .set({ status: 'deleted', deletedAt: new Date(), deletedBy: req.admin!.id })
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.status, before.status)))
      .returning();
    if (!updated) {
      res.status(409).json({ error: { code: 'CONFLICT', message: '파일 상태가 변경되어 삭제하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'media.delete',
      targetType: 'mediaAsset',
      targetId: updated.id,
      beforeDataSafe: { status: before.status },
      afterDataSafe: { status: 'deleted' },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
