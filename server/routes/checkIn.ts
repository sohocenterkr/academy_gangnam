import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString, getTodayKST } from '@shared/kst';
import { maskName } from '@shared/masking';
import { db } from '../db';
import { checkIns, checkInChangeLogs, students, studentCheckinPhones } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRateLimiter } from '../middleware/rateLimit';
import { createSelectionToken, verifySelectionToken } from '../utils/checkinToken';

const searchSchema = z.object({
  last4: z.string().regex(/^\d{4}$/),
});

const confirmSchema = z.object({
  selectionToken: z.string().min(1),
});

function isUniqueViolation(error: unknown, indexName: string): boolean {
  let current: unknown = error;
  while (current) {
    if (current instanceof Error) {
      if (current.message.includes(indexName)) return true;
      const constraint = (current as { constraint?: unknown }).constraint;
      if (typeof constraint === 'string' && constraint.includes(indexName)) return true;
      current = current.cause;
      continue;
    }
    break;
  }
  return false;
}

export interface CheckInRouterDeps {
  sessionSecret: string;
}

export function createCheckInRouter(deps: CheckInRouterDeps): Router {
  const router = Router();
  const searchLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });
  const confirmLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

  router.post('/search', searchLimiter, async (req, res) => {
    const parsed = parseBody(searchSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const matches = await db
      .select({ studentId: studentCheckinPhones.studentId, studentName: students.name })
      .from(studentCheckinPhones)
      .innerJoin(students, eq(studentCheckinPhones.studentId, students.id))
      .where(
        and(
          eq(studentCheckinPhones.phoneLast4, parsed.last4),
          eq(studentCheckinPhones.isActive, true),
          eq(students.status, 'enrolled')
        )
      );

    const uniqueStudents = new Map<string, string>();
    for (const match of matches) {
      uniqueStudents.set(match.studentId, match.studentName);
    }

    if (uniqueStudents.size === 0) {
      res.json({ data: { status: 'no_match' }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
      return;
    }

    const candidates = Array.from(uniqueStudents.entries()).map(([studentId, name]) => ({
      selectionToken: createSelectionToken(studentId, deps.sessionSecret),
      maskedName: maskName(name),
    }));

    res.json({
      data: { status: 'candidates', candidates },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.post('/confirm', confirmLimiter, async (req, res) => {
    const parsed = parseBody(confirmSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const payload = verifySelectionToken(parsed.selectionToken, deps.sessionSecret);
    if (!payload) {
      res.status(410).json({
        error: { code: 'SELECTION_EXPIRED', message: '선택 시간이 만료되었습니다. 다시 검색해 주세요.', requestId: req.requestId },
      });
      return;
    }

    const [student] = await db.select().from(students).where(eq(students.id, payload.studentId));
    if (!student || student.deletedAt || student.status !== 'enrolled') {
      res.status(410).json({
        error: { code: 'SELECTION_EXPIRED', message: '선택 시간이 만료되었습니다. 다시 검색해 주세요.', requestId: req.requestId },
      });
      return;
    }

    const checkInDate = getTodayKST();
    const checkInAt = new Date();

    let created;
    try {
      [created] = await db
        .insert(checkIns)
        .values({
          studentId: student.id,
          checkInDate,
          checkInAt,
          source: 'kiosk',
          status: 'active',
          idempotencyKey: payload.nonce,
          isException: false,
          createdAt: checkInAt,
          updatedAt: checkInAt,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, 'check_ins_idempotency_key_unique')) {
        const [existing] = await db
          .select()
          .from(checkIns)
          .where(eq(checkIns.idempotencyKey, payload.nonce));
        if (existing) {
          res.json({
            data: { status: 'confirmed', checkInAt: existing.checkInAt.toISOString(), maskedName: maskName(student.name) },
            meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
          });
          return;
        }
      }
      if (isUniqueViolation(error, 'check_ins_student_date_active_unique')) {
        const [existing] = await db
          .select()
          .from(checkIns)
          .where(and(eq(checkIns.studentId, student.id), eq(checkIns.checkInDate, checkInDate), eq(checkIns.status, 'active')));
        res.status(409).json({
          error: {
            code: 'DUPLICATE_CHECKIN',
            message: `이미 ${existing ? new Date(existing.checkInAt).toLocaleTimeString('ko-KR') : ''}에 등원했습니다.`,
            requestId: req.requestId,
          },
        });
        return;
      }
      throw error;
    }
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '등원 처리에 실패했습니다.', requestId: req.requestId } });
      return;
    }

    await db.insert(checkInChangeLogs).values({
      checkInId: created.id,
      action: 'create',
      beforeData: null,
      afterData: { checkInAt: created.checkInAt, source: 'kiosk' },
      reason: null,
      adminId: null,
      createdAt: new Date(),
    });

    res.json({
      data: { status: 'confirmed', checkInAt: created.checkInAt.toISOString(), maskedName: maskName(student.name) },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  return router;
}
