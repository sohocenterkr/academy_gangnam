import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { getNowKSTISOString } from '@shared/kst';
import { db } from '../db';
import { messageCampaigns, cardNewsProjects, cardNewsMedia, mediaAssets, uploadSessions } from '@shared/schema';
import { dispatchCampaign, type DispatchDeps } from '../services/messageDispatch';
import { writeAuditLog } from '../services/audit';
import type { CloudinaryClient } from '../services/cloudinary';

const MAX_CAMPAIGNS_PER_RUN = 5;
const MAX_PROJECTS_PER_RUN = 20;

export interface CronRouterDeps {
  cronSecret: string;
  dispatch: DispatchDeps;
  cloudinary?: CloudinaryClient;
}

function requireCronSecret(cronSecret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (header !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid cron secret.', requestId: req.requestId } });
      return;
    }
    next();
  };
}

export function createCronRouter(deps: CronRouterDeps): Router {
  const router = Router();
  const requireSecret = requireCronSecret(deps.cronSecret);

  // Dispatches campaigns whose scheduled time has arrived. Reuses dispatchCampaign's own
  // conditional-update claim, so this is safe even if Vercel invokes the cron job again before
  // the previous run finished (spec §14.3 — DB lease against duplicate execution).
  router.all('/process-message-queue', requireSecret, async (req, res) => {
    const due = await db
      .select({ id: messageCampaigns.id })
      .from(messageCampaigns)
      .where(and(eq(messageCampaigns.status, 'scheduled'), lt(messageCampaigns.scheduledAt, new Date())))
      .limit(MAX_CAMPAIGNS_PER_RUN);

    const results = [];
    for (const campaign of due) {
      try {
        const outcome = await dispatchCampaign(campaign.id, deps.dispatch);
        results.push({ campaignId: campaign.id, outcome: outcome.status });
      } catch (error) {
        results.push({ campaignId: campaign.id, outcome: 'error', message: error instanceof Error ? error.message : 'unknown' });
      }
    }

    res.json({ data: { processed: results.length, results }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  // Deletes Cloudinary assets and marks the project expired for card-news projects past their
  // 7-day expiry (spec §13.7 step 8). Only runs when Cloudinary is configured.
  router.all('/cleanup-card-news', requireSecret, async (req, res) => {
    if (!deps.cloudinary) {
      res.json({ data: { processed: 0, skipped: 'cloudinary not configured' }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
      return;
    }

    const expired = await db
      .select()
      .from(cardNewsProjects)
      .where(and(lt(cardNewsProjects.expiresAt, new Date()), isNull(cardNewsProjects.deletedAt), sql`${cardNewsProjects.status} not in ('expired', 'deleted')`))
      .limit(MAX_PROJECTS_PER_RUN);

    let mediaDeleted = 0;
    for (const project of expired) {
      const links = await db.select().from(cardNewsMedia).where(eq(cardNewsMedia.projectId, project.id));
      for (const link of links) {
        const [media] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, link.mediaId));
        if (!media || media.status === 'deleted') continue;
        await deps.cloudinary.destroy(media.cloudinaryPublicId, media.resourceType);
        await db.update(mediaAssets).set({ status: 'deleted', deletedAt: new Date() }).where(eq(mediaAssets.id, media.id));
        mediaDeleted += 1;
      }

      await db.update(cardNewsProjects).set({ status: 'expired', updatedAt: new Date() }).where(eq(cardNewsProjects.id, project.id));

      await writeAuditLog({
        adminId: null,
        roleSnapshot: null,
        action: 'cron.cleanupCardNews',
        targetType: 'cardNewsProject',
        targetId: project.id,
        beforeDataSafe: { status: project.status },
        afterDataSafe: { status: 'expired', mediaDeleted: links.length },
        result: 'success',
        requestId: req.requestId,
      });
    }

    res.json({ data: { processed: expired.length, mediaDeleted }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  // Marks upload sessions that never got a finalize call as expired candidates. The Cloudinary
  // file (if any was actually uploaded before the session expired) still isn't independently
  // identifiable from this table alone — only the target folder is known, not the file's public
  // id — so this flags candidates rather than deleting anything in Cloudinary. A follow-up that
  // lists each expectedFolder via Cloudinary's Admin API would be needed for true cleanup.
  router.all('/scan-orphan-media', requireSecret, async (req, res) => {
    const stale = await db
      .update(uploadSessions)
      .set({ status: 'expired' })
      .where(and(eq(uploadSessions.status, 'pending'), lt(uploadSessions.expiresAt, new Date())))
      .returning({ id: uploadSessions.id });

    res.json({ data: { flagged: stale.length }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  // Companion to scan-orphan-media: for media_assets that somehow ended up in orphan_review
  // (verified orphaned — no campaign/project/template still references them), delete from
  // Cloudinary and mark deleted. Nothing currently sets orphan_review, so this is a no-op today;
  // it exists so a future verification step has somewhere to hand off to.
  router.all('/cleanup-orphan-media', requireSecret, async (req, res) => {
    if (!deps.cloudinary) {
      res.json({ data: { deleted: 0, skipped: 'cloudinary not configured' }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
      return;
    }

    const orphans = await db.select().from(mediaAssets).where(inArray(mediaAssets.status, ['orphan_review'])).limit(MAX_PROJECTS_PER_RUN);
    for (const media of orphans) {
      await deps.cloudinary.destroy(media.cloudinaryPublicId, media.resourceType);
      await db.update(mediaAssets).set({ status: 'deleted', deletedAt: new Date() }).where(eq(mediaAssets.id, media.id));
    }

    res.json({ data: { deleted: orphans.length }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
