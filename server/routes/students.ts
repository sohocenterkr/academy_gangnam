import { and, eq, ilike, isNull, ne, or } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString, getTodayKST } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { maskName } from '@shared/masking';
import { maskPhone, normalizePhone } from '@shared/phone';
import { db } from '../db';
import { students, studentGuardians, guardians, studentCheckinPhones, enrollments, gradeLevels, schools } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';
import { unsetOtherPrimaryGuardians } from '../utils/studentGuardians';
import { syncStudentOwnPhone, upsertGuardianLinkPhone } from '../utils/checkinPhones';
import { isUniqueViolation } from '../utils/httpErrors';

const STATUS_VALUES = ['enrolled', 'paused', 'withdrawn', 'graduated'] as const;

const listQuerySchema = z.object({
  search: z.string().optional(),
  status: z.enum(STATUS_VALUES).optional(),
  gradeLevelId: z.string().optional(),
});

const createStudentSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  gradeLevelId: z.string().min(1),
  schoolId: z.string().optional(),
  birthDate: z.iso.date().optional(),
  address: z.string().optional(),
  registrationDate: z.iso.date().optional(),
  specialNotes: z.string().optional(),
  counselingNotes: z.string().optional(),
  confirmDuplicate: z.boolean().optional(),
});

const updateStudentSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  gradeLevelId: z.string().min(1).optional(),
  schoolId: z.string().optional(),
  birthDate: z.iso.date().optional(),
  address: z.string().optional(),
  specialNotes: z.string().optional(),
  counselingNotes: z.string().optional(),
  confirmDuplicate: z.boolean().optional(),
  expectedUpdatedAt: z.iso.datetime(),
});

const statusChangeSchema = z.object({
  status: z.enum(STATUS_VALUES),
  effectiveDate: z.iso.date().optional(),
  reason: z.string().optional(),
});

const importSchema = z.object({
  fileBase64: z.string().min(1),
});

const IMPORT_COLUMNS = ['이름', '전화번호', '학년', '학교', '보호자이름', '보호자전화번호'] as const;

const linkGuardianSchema = z.object({
  guardianId: z.string().min(1),
  relationship: z.string().optional(),
  isPrimary: z.boolean().optional(),
  receiveMessages: z.boolean().optional(),
  useForCheckin: z.boolean().optional(),
});

function toMaskedStudent(student: typeof students.$inferSelect) {
  return {
    id: student.id,
    name: maskName(student.name),
    phoneNormalized: maskPhone(student.phoneNormalized),
    schoolId: student.schoolId,
    gradeLevelId: student.gradeLevelId,
    status: student.status,
    registrationDate: student.registrationDate,
    updatedAt: student.updatedAt,
  };
}

function isForeignKeyViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current) {
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      if (code === '23503') return true;
      current = current.cause;
      continue;
    }
    break;
  }
  return false;
}

export interface StudentsRouterDeps {
  sessionSecret: string;
}

export function createStudentsRouter(deps: StudentsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireStudentsManage = createRequirePermission(PERMISSIONS.STUDENTS_MANAGE);

  router.get('/', requireAuth, requireStudentsManage, async (req, res) => {
    const parsedQuery = listQuerySchema.safeParse(req.query);
    const query = parsedQuery.success ? parsedQuery.data : {};

    const conditions = [isNull(students.deletedAt)];
    if (query.search) {
      const normalizedSearch = normalizePhone(query.search);
      const searchConditions = [ilike(students.name, `%${query.search}%`)];
      if (normalizedSearch) {
        searchConditions.push(ilike(students.phoneNormalized, `%${normalizedSearch}%`));
      }
      conditions.push(or(...searchConditions)!);
    }
    if (query.status) {
      conditions.push(eq(students.status, query.status));
    }
    if (query.gradeLevelId) {
      conditions.push(eq(students.gradeLevelId, query.gradeLevelId));
    }

    const rows = await db
      .select()
      .from(students)
      .where(and(...conditions))
      .orderBy(students.name);

    res.json({
      data: rows.map(toMaskedStudent),
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.post('/', requireAuth, requireStudentsManage, async (req, res) => {
    const parsed = parseBody(createStudentSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const phoneNormalized = normalizePhone(parsed.phone);
    if (!phoneNormalized) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: '입력값을 확인해 주세요.',
          fieldErrors: { phone: ['전화번호를 확인해 주세요.'] },
          requestId: req.requestId,
        },
      });
      return;
    }

    if (!parsed.confirmDuplicate) {
      const existingMatches = await db
        .select()
        .from(students)
        .where(and(eq(students.phoneNormalized, phoneNormalized), isNull(students.deletedAt)));

      if (existingMatches.length > 0) {
        res.json({
          data: {
            status: 'duplicate_warning',
            duplicates: existingMatches.map((s) => ({ id: s.id, name: maskName(s.name), phoneNormalized: maskPhone(s.phoneNormalized) })),
          },
          meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
        });
        return;
      }
    }

    const registrationDate = parsed.registrationDate ?? getTodayKST();

    let created;
    try {
      created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(students)
          .values({
            name: parsed.name,
            phoneNormalized,
            gradeLevelId: parsed.gradeLevelId,
            schoolId: parsed.schoolId,
            birthDate: parsed.birthDate,
            address: parsed.address,
            registrationDate,
            statusEffectiveDate: registrationDate,
            specialNotes: parsed.specialNotes,
            counselingNotes: parsed.counselingNotes,
            createdBy: req.admin!.id,
            updatedBy: req.admin!.id,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();
        if (!row) return undefined;
        await syncStudentOwnPhone(tx, row.id, phoneNormalized);
        return row;
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: '입력값을 확인해 주세요.',
            fieldErrors: { gradeLevelId: ['학년을 확인해 주세요.'] },
            requestId: req.requestId,
          },
        });
        return;
      }
      throw error;
    }
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '학생을 등록하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'student.create',
      targetType: 'student',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { name: created.name, phoneNormalized: maskPhone(created.phoneNormalized) },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({
      data: { status: 'created', student: created },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.get('/import-template', requireAuth, requireStudentsManage, async (req, res) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('학생명단');
    sheet.columns = IMPORT_COLUMNS.map((header) => ({ header, key: header }));
    sheet.addRow({
      이름: '홍길동',
      전화번호: '01012345678',
      학년: '초등 3학년',
      학교: '',
      보호자이름: '',
      보호자전화번호: '',
    });
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="student-import-template.xlsx"');
    res.send(Buffer.from(buffer));
  });

  router.post('/import', requireAuth, requireStudentsManage, async (req, res) => {
    const parsed = parseBody(importSchema, req.body, res, req.requestId);
    if (!parsed) return;

    let buffer: Buffer;
    try {
      buffer = Buffer.from(parsed.fileBase64, 'base64');
    } catch {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '파일을 읽을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const workbook = new ExcelJS.Workbook();
    try {
      // exceljs bundles its own @types/node Buffer typing that doesn't structurally match this
      // project's — a real Buffer works fine at runtime, so this cast just satisfies tsc.
      await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    } catch {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: '엑셀(.xlsx) 파일만 업로드할 수 있습니다.', requestId: req.requestId },
      });
      return;
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '시트를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const [gradeList, schoolList, existingStudents] = await Promise.all([
      db.select().from(gradeLevels),
      db.select().from(schools),
      db.select({ id: students.id, phoneNormalized: students.phoneNormalized }).from(students).where(isNull(students.deletedAt)),
    ]);
    const gradeByName = new Map(gradeList.map((g) => [g.name.trim(), g.id]));
    const schoolByName = new Map(schoolList.map((s) => [s.name.trim(), s.id]));
    const existingPhones = new Set(existingStudents.map((s) => s.phoneNormalized));

    const created: string[] = [];
    const errors: Array<{ row: number; reason: string }> = [];
    const now = new Date();

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const name = String(row.getCell(1).value ?? '').trim();
      const rawPhone = String(row.getCell(2).value ?? '').trim();
      const gradeName = String(row.getCell(3).value ?? '').trim();
      const schoolName = String(row.getCell(4).value ?? '').trim();
      const guardianName = String(row.getCell(5).value ?? '').trim();
      const guardianRawPhone = String(row.getCell(6).value ?? '').trim();

      if (!name && !rawPhone && !gradeName) continue; // blank row

      if (!name) {
        errors.push({ row: rowNumber, reason: '이름이 비어 있습니다.' });
        continue;
      }
      const phoneNormalized = normalizePhone(rawPhone);
      if (!phoneNormalized) {
        errors.push({ row: rowNumber, reason: '전화번호를 확인해 주세요.' });
        continue;
      }
      const gradeLevelId = gradeByName.get(gradeName);
      if (!gradeLevelId) {
        errors.push({ row: rowNumber, reason: `학년을 찾을 수 없습니다: ${gradeName}` });
        continue;
      }
      if (existingPhones.has(phoneNormalized)) {
        errors.push({ row: rowNumber, reason: '이미 등록된 전화번호입니다.' });
        continue;
      }

      const schoolId = schoolName ? schoolByName.get(schoolName) : undefined;
      const registrationDate = getTodayKST();

      try {
        const studentId = await db.transaction(async (tx) => {
          const [student] = await tx
            .insert(students)
            .values({
              name,
              phoneNormalized,
              gradeLevelId,
              schoolId,
              registrationDate,
              statusEffectiveDate: registrationDate,
              createdBy: req.admin!.id,
              updatedBy: req.admin!.id,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          if (!student) return null;
          await syncStudentOwnPhone(tx, student.id, phoneNormalized);

          if (guardianName && guardianRawPhone) {
            const guardianPhoneNormalized = normalizePhone(guardianRawPhone);
            if (guardianPhoneNormalized) {
              const [existingGuardian] = await tx.select().from(guardians).where(eq(guardians.phoneNormalized, guardianPhoneNormalized));
              const guardian =
                existingGuardian ??
                (
                  await tx
                    .insert(guardians)
                    .values({ name: guardianName, phoneNormalized: guardianPhoneNormalized, createdBy: req.admin!.id, updatedBy: req.admin!.id })
                    .returning()
                )[0];
              if (guardian) {
                const [link] = await tx
                  .insert(studentGuardians)
                  .values({ studentId: student.id, guardianId: guardian.id, isPrimary: true, receiveMessages: true, useForCheckin: true, updatedAt: now })
                  .returning();
                if (link) {
                  await upsertGuardianLinkPhone(tx, student.id, guardian.id, guardian.phoneNormalized, true);
                }
              }
            }
          }

          return student.id;
        });
        if (studentId) {
          created.push(studentId);
          existingPhones.add(phoneNormalized);
        }
      } catch {
        errors.push({ row: rowNumber, reason: '등록 중 오류가 발생했습니다.' });
      }
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'student.bulkImport',
      targetType: 'student',
      targetId: null,
      beforeDataSafe: null,
      afterDataSafe: { createdCount: created.length, errorCount: errors.length },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({
      data: { createdCount: created.length, errors },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.get('/:id', requireAuth, requireStudentsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [student] = await db.select().from(students).where(eq(students.id, id));
    if (!student || student.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '학생을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const links = await db
      .select({
        id: studentGuardians.id,
        relationship: studentGuardians.relationship,
        isPrimary: studentGuardians.isPrimary,
        receiveMessages: studentGuardians.receiveMessages,
        useForCheckin: studentGuardians.useForCheckin,
        updatedAt: studentGuardians.updatedAt,
        guardian: { id: guardians.id, name: guardians.name, phoneNormalized: guardians.phoneNormalized, notes: guardians.notes },
      })
      .from(studentGuardians)
      .innerJoin(guardians, eq(studentGuardians.guardianId, guardians.id))
      .where(and(eq(studentGuardians.studentId, id), isNull(guardians.deletedAt)));

    res.json({
      data: { ...student, guardians: links },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.patch('/:id', requireAuth, requireStudentsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateStudentSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(students).where(eq(students.id, id));
    if (!before || before.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '학생을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    let phoneNormalized: string | undefined;
    if (parsed.phone !== undefined) {
      phoneNormalized = normalizePhone(parsed.phone);
      if (!phoneNormalized) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: '입력값을 확인해 주세요.',
            fieldErrors: { phone: ['전화번호를 확인해 주세요.'] },
            requestId: req.requestId,
          },
        });
        return;
      }

      if (phoneNormalized !== before.phoneNormalized && !parsed.confirmDuplicate) {
        const existingMatches = await db
          .select()
          .from(students)
          .where(and(eq(students.phoneNormalized, phoneNormalized), isNull(students.deletedAt), ne(students.id, id)));

        if (existingMatches.length > 0) {
          res.json({
            data: {
              status: 'duplicate_warning',
              duplicates: existingMatches.map((s) => ({ id: s.id, name: maskName(s.name), phoneNormalized: maskPhone(s.phoneNormalized) })),
            },
            meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
          });
          return;
        }
      }
    }

    const { expectedUpdatedAt, phone: _phone, confirmDuplicate: _confirm, ...rest } = parsed;

    let updated;
    try {
      updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(students)
          .set({
            ...rest,
            ...(phoneNormalized !== undefined ? { phoneNormalized } : {}),
            updatedBy: req.admin!.id,
            updatedAt: new Date(),
          })
          .where(and(eq(students.id, id), eq(students.updatedAt, new Date(expectedUpdatedAt))))
          .returning();
        if (!row) return undefined;
        if (phoneNormalized !== undefined) {
          await syncStudentOwnPhone(tx, row.id, phoneNormalized);
        }
        return row;
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: '입력값을 확인해 주세요.',
            fieldErrors: { gradeLevelId: ['학년을 확인해 주세요.'] },
            requestId: req.requestId,
          },
        });
        return;
      }
      throw error;
    }
    if (!updated) {
      res.status(409).json({
        error: { code: 'VERSION_CONFLICT', message: '다른 곳에서 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.', requestId: req.requestId },
      });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'student.update',
      targetType: 'student',
      targetId: updated.id,
      beforeDataSafe: { name: before.name, phoneNormalized: maskPhone(before.phoneNormalized) },
      afterDataSafe: { name: updated.name, phoneNormalized: maskPhone(updated.phoneNormalized) },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({
      data: { status: 'updated', student: updated },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.post('/:id/status', requireAuth, requireStudentsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(statusChangeSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(students).where(eq(students.id, id));
    if (!before || before.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '학생을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const statusEffectiveDate = parsed.effectiveDate ?? getTodayKST();

    const [updated] = await db
      .update(students)
      .set({ status: parsed.status, statusEffectiveDate, updatedBy: req.admin!.id, updatedAt: new Date() })
      .where(eq(students.id, id))
      .returning();
    if (!updated) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '상태를 변경하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'student.status_change',
      targetType: 'student',
      targetId: updated.id,
      beforeDataSafe: { status: before.status, statusEffectiveDate: before.statusEffectiveDate },
      afterDataSafe: { status: updated.status, statusEffectiveDate: updated.statusEffectiveDate, reason: parsed.reason },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({
      data: { status: 'updated', student: updated },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.delete('/:id', requireAuth, requireStudentsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [existing] = await db.select().from(students).where(eq(students.id, id));
    if (!existing || existing.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '학생을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    await db.transaction(async (tx) => {
      await tx.update(students).set({ deletedAt: new Date(), updatedBy: req.admin!.id, updatedAt: new Date() }).where(eq(students.id, id));
      await tx.update(studentCheckinPhones).set({ isActive: false, updatedAt: new Date() }).where(eq(studentCheckinPhones.studentId, id));
    });

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'student.delete',
      targetType: 'student',
      targetId: id,
      beforeDataSafe: { name: existing.name },
      afterDataSafe: null,
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: { success: true }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/restore', requireAuth, requireStudentsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [existing] = await db.select().from(students).where(eq(students.id, id));
    if (!existing || !existing.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '학생을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const restored = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(students)
        .set({ deletedAt: null, updatedBy: req.admin!.id, updatedAt: new Date() })
        .where(eq(students.id, id))
        .returning();

      // Reactivate the student's own check-in phone unconditionally — a student's own phone
      // is always check-in-eligible.
      await tx
        .update(studentCheckinPhones)
        .set({ isActive: true, updatedAt: new Date() })
        .where(and(eq(studentCheckinPhones.studentId, id), eq(studentCheckinPhones.sourceType, 'student')));

      // Recompute guardian check-in phones from the CURRENT student_guardians.use_for_checkin
      // values, rather than blindly reactivating every row — a guardian explicitly excluded
      // from kiosk search (use_for_checkin=false) must stay excluded after a delete/restore
      // cycle, not silently become valid again.
      const links = await tx
        .select({
          guardianId: studentGuardians.guardianId,
          useForCheckin: studentGuardians.useForCheckin,
          phoneNormalized: guardians.phoneNormalized,
        })
        .from(studentGuardians)
        .innerJoin(guardians, eq(studentGuardians.guardianId, guardians.id))
        .where(eq(studentGuardians.studentId, id));
      for (const link of links) {
        await upsertGuardianLinkPhone(tx, id, link.guardianId, link.phoneNormalized, link.useForCheckin);
      }

      return row;
    });

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'student.restore',
      targetType: 'student',
      targetId: id,
      beforeDataSafe: null,
      afterDataSafe: { name: existing.name },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: restored, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.get('/:id/enrollments', requireAuth, requireStudentsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [student] = await db.select().from(students).where(eq(students.id, id));
    if (!student) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '학생을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const rows = await db.select().from(enrollments).where(eq(enrollments.studentId, id));
    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/guardians', requireAuth, requireStudentsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(linkGuardianSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [student] = await db.select().from(students).where(eq(students.id, id));
    if (!student || student.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '학생을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    const [guardian] = await db.select().from(guardians).where(eq(guardians.id, parsed.guardianId));
    if (!guardian || guardian.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '보호자를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    let created;
    try {
      created = await db.transaction(async (tx) => {
        if (parsed.isPrimary) {
          await unsetOtherPrimaryGuardians(tx, id);
        }
        const [row] = await tx
          .insert(studentGuardians)
          .values({
            studentId: id,
            guardianId: parsed.guardianId,
            relationship: parsed.relationship,
            isPrimary: parsed.isPrimary ?? false,
            receiveMessages: parsed.receiveMessages ?? true,
            useForCheckin: parsed.useForCheckin ?? true,
            updatedAt: new Date(),
          })
          .returning();
        if (row) {
          await upsertGuardianLinkPhone(tx, id, parsed.guardianId, guardian.phoneNormalized, row.useForCheckin);
        }
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'student_guardians_primary_unique')) {
        res.status(409).json({
          error: { code: 'VALIDATION_ERROR', message: '이미 다른 보호자가 대표로 지정되어 있습니다. 새로고침 후 다시 시도해 주세요.', requestId: req.requestId },
        });
        return;
      }
      if (isUniqueViolation(error, 'student_guardians_student_guardian_unique')) {
        res.status(409).json({
          error: { code: 'DUPLICATE_LINK', message: '이미 연결된 보호자입니다.', requestId: req.requestId },
        });
        return;
      }
      throw error;
    }
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '보호자를 연결하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'student_guardian.create',
      targetType: 'student_guardian',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { studentId: id, guardianId: parsed.guardianId, isPrimary: created.isPrimary },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
