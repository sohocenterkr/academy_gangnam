import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { mediaAssets } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';
import { getCheckInReport, getStudentReport, getCourseReport, getMessageReport, getCardNewsReport } from '../services/reports';
import type { CloudinaryClient } from '../services/cloudinary';

const createExportSchema = z.object({
  reportType: z.enum(['check-ins', 'students', 'courses', 'messages', 'card-news']),
  from: z.string().optional(),
  to: z.string().optional(),
});

async function buildWorkbook(reportType: string, from?: string, to?: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();

  if (reportType === 'check-ins') {
    const report = await getCheckInReport({ from, to });
    const byDate = workbook.addWorksheet('날짜별');
    byDate.columns = [{ header: '날짜', key: 'date' }, { header: '등원 수', key: 'count' }];
    byDate.addRows(report.byDate);
    const bySource = workbook.addWorksheet('경로별');
    bySource.columns = [{ header: '경로', key: 'source' }, { header: '등원 수', key: 'count' }];
    bySource.addRows(report.bySource);
  } else if (reportType === 'students') {
    const report = await getStudentReport();
    const byStatus = workbook.addWorksheet('상태별');
    byStatus.columns = [{ header: '상태', key: 'status' }, { header: '인원', key: 'count' }];
    byStatus.addRows(report.byStatus);
    const byGrade = workbook.addWorksheet('학년별');
    byGrade.columns = [{ header: '학년', key: 'gradeName' }, { header: '인원', key: 'count' }];
    byGrade.addRows(report.byGrade);
  } else if (reportType === 'courses') {
    const report = await getCourseReport();
    const sheet = workbook.addWorksheet('강좌별');
    sheet.columns = [
      { header: '강좌명', key: 'courseName' },
      { header: '상태', key: 'courseStatus' },
      { header: '수강 중 인원', key: 'activeEnrollmentCount' },
    ];
    sheet.addRows(report);
  } else if (reportType === 'messages') {
    const report = await getMessageReport({ from, to });
    const sheet = workbook.addWorksheet('상태별');
    sheet.columns = [
      { header: '상태', key: 'status' },
      { header: '작업 수', key: 'campaignCount' },
      { header: '총 발송건수', key: 'totalSendItems' },
      { header: '실패건수', key: 'totalFailed' },
      { header: '제외건수', key: 'totalExcluded' },
    ];
    sheet.addRows(report);
  } else {
    const report = await getCardNewsReport();
    const sheet = workbook.addWorksheet('상태별');
    sheet.columns = [{ header: '상태', key: 'status' }, { header: '건수', key: 'count' }];
    sheet.addRows(report);
  }

  return workbook;
}

export interface ExportsRouterDeps {
  sessionSecret: string;
  cloudinary: CloudinaryClient;
  uploadRoot: string;
}

export function createExportsRouter(deps: ExportsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireAuditView = createRequirePermission(PERMISSIONS.AUDIT_VIEW);

  router.post('/', requireAuth, requireAuditView, async (req, res) => {
    const parsed = parseBody(createExportSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const workbook = await buildWorkbook(parsed.reportType, parsed.from, parsed.to);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const publicId = `${parsed.reportType}-${randomUUID()}`;
    const resource = await deps.cloudinary.uploadBuffer(buffer, {
      folder: `${deps.uploadRoot}/exports`,
      publicId,
      resourceType: 'raw',
    });

    const [asset] = await db
      .insert(mediaAssets)
      .values({
        ownerAdminId: req.admin!.id,
        purpose: 'export',
        targetType: 'export',
        cloudinaryPublicId: resource.publicId,
        cloudinaryAssetId: resource.assetId,
        secureUrl: resource.secureUrl,
        resourceType: 'raw',
        format: 'xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        bytes: buffer.byteLength,
        status: 'active',
      })
      .returning();

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'export.create',
      targetType: 'export',
      targetId: asset!.id,
      beforeDataSafe: null,
      afterDataSafe: { reportType: parsed.reportType },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({
      data: { id: asset!.id, status: 'completed', downloadUrl: asset!.secureUrl },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.get('/:id', requireAuth, requireAuditView, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id));
    if (!asset || asset.purpose !== 'export' || asset.status !== 'active') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '내보내기 파일을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    res.json({
      data: { id: asset.id, status: 'completed', downloadUrl: asset.secureUrl },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  return router;
}
