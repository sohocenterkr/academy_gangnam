# Stage 5: Students & Student-Guardian Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build student (학생) management — full CRUD, status lifecycle (재원/휴원/퇴원/졸업), soft-delete/restore, the same phone-duplicate-warning flow as guardians — plus the student-guardian linking junction (형제·자매가 같은 보호자를 공유, 대표 보호자 최대 1명, 수신동의/등원사용 플래그별 관리), with masking on list views. This completes the "학생·보호자 등록 및 수정" workflow from spec §13.1, building on Stage 4's guardians.

**Architecture:** `students` is a new standalone table (FK to the existing `schools`/`gradeLevels` reference data from Stage 3). `student_guardians` is a junction table linking `students` and `guardians` (both already exist), enforcing "no duplicate student+guardian link" and "at most one primary guardian per student" via partial/composite unique indexes — the same pattern `schools`/`gradeLevels` already use for partial-unique active-name indexes. The phone-duplicate-warning-requires-confirm flow, masking utilities, and route conventions are all reused verbatim from Stage 4's `guardians.ts`/`shared/phone.ts`/`shared/masking.ts` — no new primitives needed there. Student-guardian link mutations (`PATCH`/`DELETE /api/student-guardians/:id`) live in their own small router at a separate URL prefix, exactly matching the spec's own URL structure choice (`/api/students/:id/guardians` to create a link, `/api/student-guardians/:id` to manage an existing one).

**Tech Stack:** Same as prior plans — Drizzle ORM, Express 5, Zod, React 19/Vite, wouter, Vitest, Playwright.

**Spec:** [`../../../academy_automation_final_development_prompt.md`](../../../academy_automation_final_development_prompt.md) — this plan implements the `students` and `student_guardians` portions of §9.4, the student registration/update workflow of §13.1, and the student/student-guardian portion of §12.3's API list (`GET/POST /api/students`, `GET/PATCH/DELETE /api/students/:id`, `POST /api/students/:id/status`, `POST /api/students/:id/restore`, `POST /api/students/:id/guardians`, `PATCH/DELETE /api/student-guardians/:id`). Deliberately deferred to later plans (each needs infrastructure that doesn't exist yet): `student_checkin_phones` (needs the check-in/kiosk stage — spec §13.3/§18), `consent_history`/`opt_outs` (needs the messaging stage — spec §13.4), `GET /api/students/:id/enrollments|check-ins|messages` (need courses/enrollments/check-ins/messaging tables), Excel bulk import (`/api/students/import/*`, spec §12.3's last two rows — a separate, self-contained feature).

**Prior plans:** [`2026-08-15-stage3-academic-reference-data.md`](2026-08-15-stage3-academic-reference-data.md) (source of `schools`/`gradeLevels`, reused here as FKs), [`2026-08-15-stage4-guardians.md`](2026-08-15-stage4-guardians.md) (source of `shared/phone.ts`, `shared/masking.ts`, and the exact route/masking/duplicate-warning/optimistic-locking pattern this plan reuses without modification — `server/routes/guardians.ts` is the direct template for `server/routes/students.ts`).

## Global Constraints

- KST (`Asia/Seoul`) for all timestamps — `getNowKSTISOString` from `@shared/kst` in every API response; `getTodayKST` from `@shared/kst` for any server-computed default date (registration date, status-effective date) — never `new Date().toISOString().slice(0,10)` or any client-supplied "today".
- API envelope: `{ data, meta: { requestId, kstTimestamp } }` / `{ error: { code, message, fieldErrors?, requestId } }`.
- Error codes: `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 VERSION_CONFLICT` (optimistic-lock conflict), `409 DUPLICATE_LINK` (student-guardian link already exists).
- **Every students/student-guardians route requires `requireAuth` + `requirePermission(PERMISSIONS.STUDENTS_MANAGE)`.** (The student-guardian-linking client UI also calls the existing `GET /api/guardians?search=` endpoint from Stage 4 to find a guardian to link, which requires `PERMISSIONS.GUARDIANS_MANAGE` — an admin role needs both permissions to use guardian-linking from the student page. This is a known, accepted coupling for this stage, not a bug — the roles/permissions matrix itself is spec §21 policy territory, out of scope here.)
- **Every create/update/status-change/delete/restore/link/unlink writes an audit log** via `writeAuditLog`, with phone MASKED (via `maskPhone`) in every `beforeDataSafe`/`afterDataSafe` snapshot that includes it — never raw.
- **Every PATCH endpoint uses optimistic locking**: `expectedUpdatedAt`/`409 VERSION_CONFLICT`, exactly like `server/routes/guardians.ts`.
- **List/summary responses return masked name + masked phone** (spec §10.5 / CLAUDE.md's PII masking rule) via `maskName`/`maskPhone` from Stage 4. Detail (`GET /:id`) responses return full, unmasked data, including the student's embedded, unmasked linked-guardians list.
- **Student phone is never unique-constrained, and follows the exact same duplicate-warning flow as guardians** (spec §13.1 rule 5: "중복 전화번호는 금지하지 않되 경고하고 사용자가 확인해야 저장됩니다" — this rule sits in the shared "학생·보호자 등록 및 수정" section, not just the guardian-specific text, so it binds student phone too). `POST`/`PATCH` on students must warn (not block) on a phone collision with another (non-deleted) student, saving only once `confirmDuplicate: true` is sent — identical shape to `server/routes/guardians.ts`'s existing flow, reused verbatim.
- **`student_guardians` enforces no duplicate link** (`student_id + guardian_id` unique) **and at most one primary guardian per student** (partial unique index on `student_id` where `is_primary = true`) — per spec §9.4. Setting a link's `isPrimary` to `true` must atomically unset any other primary link for the same student first (inside a DB transaction), never violate the partial unique index.
- **Required student fields** (spec §13.1): `name`, `gradeLevelId` (no silent default — an academy that genuinely has ungraded students must first create an actual "기타/미지정" grade-level row via the Stage 3 reference-data screen, not get one injected here), and at least one phone number. This plan satisfies "at least one phone" by making the student's own `phoneNormalized` a required field at creation — student-guardian linking is a separate follow-up step, not required atomically with student creation.
- **Soft delete**: `students.deletedAt` marks a mistakenly-created record as removed from view (spec §13.1 rule 7); it is orthogonal to `students.status` (재원/휴원/퇴원/졸업), which represents the student's real-world enrollment state and is changed only via the dedicated `POST /:id/status` endpoint. `DELETE /api/students/:id` always soft-deletes (sets `deletedAt`) — this plan does not implement physical/hard delete, since safely verifying "zero enrollment/check-in/message history" isn't possible until those tables exist in later stages; soft-delete is the conservative, spec-compliant default until then. `student_guardians` links are simple relationship rows with no PII of their own — `DELETE /api/student-guardians/:id` (연결해제, unlink) is a genuine hard delete, no soft-delete needed.
- No separate test DB — every server integration test hits the real local dev `DATABASE_URL` and must clean up every row it creates, in FK-safe order (student_guardians → students/guardians → admins/roles), and must never touch the real bootstrapped super-admin. Follow `server/routes/guardians.test.ts`'s established `seedSuperAdmin`/`loginAs`/`cleanup` pattern, including its `ilike('test-%')`-style comprehensive cleanup sweep (established after a real incident in Stage 4 where an unscoped, non-comprehensive cleanup line risked deleting other data) rather than per-test inline deletes.
- Every test constructing `createApp(...)` must pass an explicit fake email adapter (`createApp({ emailAdapter: createFakeEmailAdapter() })`).
- `npm run check` must be clean after every task — no exceptions.

---

## File Structure

```
migrations/                       # new migration generated by drizzle-kit

shared/
  schema.ts                       # modified: add students, studentGuardians tables
  permissions.ts                  # modified: add PERMISSIONS.STUDENTS_MANAGE

server/
  routes/
    students.ts / .test.ts        # GET/POST /, GET/PATCH/DELETE /:id, POST /:id/status, POST /:id/restore, POST /:id/guardians
    studentGuardians.ts / .test.ts # PATCH/DELETE /api/student-guardians/:id
  app.ts                          # modified: mount both new routers

client/
  src/
    features/
      students/
        StudentListPage.tsx / .test.tsx
        StudentDetailPage.tsx / .test.tsx
      dashboard/
        AdminHomePage.tsx         # modified: add "학생 관리" nav link
    routes.tsx                    # modified: add /admin/students, /admin/students/:studentId

tests/
  e2e/
    students.spec.ts
```

---

## Task 1: Schema, migration, permission

**Files:**
- Modify: `shared/schema.ts`, `shared/permissions.ts`

**Interfaces:**
- Consumes: `schools`, `gradeLevels`, `guardians`, `admins` (existing Drizzle tables from Stages 2-4).
- Produces: `students` and `studentGuardians` Drizzle tables from `shared/schema.ts` — used by Tasks 2-5. `PERMISSIONS.STUDENTS_MANAGE` from `@shared/permissions` — used by Tasks 2-5.

- [ ] **Step 1: Add `date` to the `drizzle-orm/pg-core` import in `shared/schema.ts`**

Change:
```ts
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
```
to:
```ts
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
```

- [ ] **Step 2: Add the `students` and `studentGuardians` tables**

Append to the end of `shared/schema.ts`:

```ts
export const students = pgTable(
  'students',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    birthDate: date('birth_date'),
    schoolId: uuid('school_id').references(() => schools.id),
    gradeLevelId: uuid('grade_level_id')
      .notNull()
      .references(() => gradeLevels.id),
    phoneNormalized: text('phone_normalized').notNull(),
    address: text('address'),
    registrationDate: date('registration_date').notNull(),
    status: text('status', { enum: ['enrolled', 'paused', 'withdrawn', 'graduated'] })
      .notNull()
      .default('enrolled'),
    statusEffectiveDate: date('status_effective_date').notNull(),
    specialNotes: text('special_notes'),
    counselingNotes: text('counseling_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => admins.id),
    updatedBy: uuid('updated_by').references(() => admins.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('students_phone_idx').on(table.phoneNormalized)]
);

export const studentGuardians = pgTable(
  'student_guardians',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    guardianId: uuid('guardian_id')
      .notNull()
      .references(() => guardians.id),
    relationship: text('relationship'),
    isPrimary: boolean('is_primary').notNull().default(false),
    receiveMessages: boolean('receive_messages').notNull().default(true),
    useForCheckin: boolean('use_for_checkin').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('student_guardians_student_guardian_unique').on(table.studentId, table.guardianId),
    uniqueIndex('student_guardians_primary_unique')
      .on(table.studentId)
      .where(sql`${table.isPrimary} = true`),
  ]
);
```

- [ ] **Step 3: Add the permission constant to `shared/permissions.ts`**

Change:
```ts
export const PERMISSIONS = {
  ADMINS_MANAGE: 'admins:manage',
  ROLES_MANAGE: 'roles:manage',
  ACADEMY_MANAGE: 'academy:manage',
  GUARDIANS_MANAGE: 'guardians:manage',
} as const;
```
to:
```ts
export const PERMISSIONS = {
  ADMINS_MANAGE: 'admins:manage',
  ROLES_MANAGE: 'roles:manage',
  ACADEMY_MANAGE: 'academy:manage',
  GUARDIANS_MANAGE: 'guardians:manage',
  STUDENTS_MANAGE: 'students:manage',
} as const;
```

- [ ] **Step 4: Generate and apply the migration against the real local dev DB**

Run:
```bash
npm run db:generate
npm run db:migrate
```
Expected: `db:generate` writes new SQL under `migrations/`; `db:migrate` prints `Migrations applied.` with no errors. If this fails, stop and report — do not proceed with a broken migration.

- [ ] **Step 5: Run check**

Run: `npm run check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add shared/schema.ts shared/permissions.ts migrations
git commit -m "feat: add students and student_guardians schema, STUDENTS_MANAGE permission"
```

---

## Task 2: Students API — list (masked, search/filter) + create

**Files:**
- Create: `server/routes/students.ts`, `server/routes/students.test.ts`
- Modify: `server/app.ts`

**Interfaces:**
- Consumes: `students` table, `PERMISSIONS.STUDENTS_MANAGE` (Task 1); `normalizePhone`/`maskPhone` from `@shared/phone`, `maskName` from `@shared/masking` (Stage 4, unchanged); `schools`, `gradeLevels` (Stage 3, for FK validation).
- Produces: `createStudentsRouter(deps: { sessionSecret: string }): Router`, mounted at `/api/students`, with `GET /` and `POST /` in this task (Tasks 3-4 add more routes to this same file). Response shapes: `{ status: 'created'; student: SafeStudent } | { status: 'duplicate_warning'; duplicates: Array<{ id: string; name: string; phoneNormalized: string }> }` for create — identical shape to Stage 4's guardians create response, relied on by Task 6's client code.

- [ ] **Step 1: Write the failing test `server/routes/students.test.ts`**

```ts
import { and, eq, ilike } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, students, gradeLevels } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-students-super@example.com';
const PASSWORD = 'test-students-password-123';
const TEST_STUDENT_NAME = 'test-student-김철수';
const TEST_STUDENT_PHONE = '01099998888';
const TEST_GRADE_NAME = 'test-students-grade';

async function seedSuperAdminAndGrade() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-students-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION] })
    .returning();
  await db.insert(admins).values({
    email: SUPER_EMAIL,
    name: '수퍼',
    passwordHash: await hashPassword(PASSWORD),
    roleId: role!.id,
    status: 'active',
  });
  const [grade] = await db.insert(gradeLevels).values({ name: TEST_GRADE_NAME, sortOrder: 0 }).returning();
  return { gradeLevelId: grade!.id };
}

async function loginAs(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return response.headers['set-cookie'][0];
}

async function cleanup() {
  await db.delete(students).where(ilike(students.name, 'test-student-%'));
  await db.delete(gradeLevels).where(eq(gradeLevels.name, TEST_GRADE_NAME));

  const adminToDelete = await db.query.admins.findFirst({ where: eq(admins.email, SUPER_EMAIL) });
  if (adminToDelete) {
    const { auditLogs, authSessions, passwordResetTokens } = await import('@shared/schema');
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-students-role'));
}

describe('students routes — list and create', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/students');
    expect(response.status).toBe(401);
  });

  it('creates a student and returns it in the masked list', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: '010-9999-8888', gradeLevelId });

    expect(created.status).toBe(200);
    expect(created.body.data.status).toBe('created');
    expect(created.body.data.student.phoneNormalized).toBe(TEST_STUDENT_PHONE);
    expect(created.body.data.student.status).toBe('enrolled');

    const list = await request(app).get('/api/students').set('Cookie', cookie);
    expect(list.status).toBe(200);
    const found = list.body.data.find((s: { id: string }) => s.id === created.body.data.student.id);
    expect(found).toBeDefined();
    expect(found.name).toBe('t***************수');
    expect(found.phoneNormalized).toBe('010-****-8888');
  });

  it('rejects creation with a non-existent gradeLevelId', async () => {
    await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId: '00000000-0000-0000-0000-000000000000' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('warns about a duplicate phone instead of creating, until confirmDuplicate is set', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app).post('/api/students').set('Cookie', cookie).send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });

    const secondAttempt = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: 'test-student-이영희', phone: TEST_STUDENT_PHONE, gradeLevelId });

    expect(secondAttempt.status).toBe(200);
    expect(secondAttempt.body.data.status).toBe('duplicate_warning');
    expect(secondAttempt.body.data.duplicates[0].phoneNormalized).toBe('010-****-8888');

    const confirmed = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: 'test-student-이영희', phone: TEST_STUDENT_PHONE, gradeLevelId, confirmDuplicate: true });

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe('created');
  });

  it('searches the student list by name and filters by status', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app).post('/api/students').set('Cookie', cookie).send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });

    const searchResult = await request(app).get('/api/students?search=김철수').set('Cookie', cookie);
    expect(searchResult.status).toBe(200);
    expect(searchResult.body.data.length).toBeGreaterThanOrEqual(1);

    const statusResult = await request(app).get('/api/students?status=withdrawn').set('Cookie', cookie);
    expect(statusResult.body.data.find((s: { id: string }) => s.name.includes('*'))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/routes/students.test.ts`
Expected: FAIL — 404s (route doesn't exist yet).

- [ ] **Step 3: Write `server/routes/students.ts`**

```ts
import { and, eq, ilike, isNull, or } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString, getTodayKST } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { maskName } from '@shared/masking';
import { maskPhone, normalizePhone } from '@shared/phone';
import { db } from '../db';
import { students } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';

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
  birthDate: z.string().optional(),
  address: z.string().optional(),
  registrationDate: z.string().optional(),
  specialNotes: z.string().optional(),
  counselingNotes: z.string().optional(),
  confirmDuplicate: z.boolean().optional(),
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
      [created] = await db
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
        })
        .returning();
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

  return router;
}
```

- [ ] **Step 4: Mount the router in `server/app.ts`**

Add the import and mount line (alongside the existing `/api/guardians` mount):
```ts
import { createStudentsRouter } from './routes/students';
// ...
app.use('/api/students', createStudentsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run server/routes/students.test.ts`
Expected: PASS — 5 tests passing, against the real dev DB.

- [ ] **Step 6: Run check**

Run: `npm run check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add server/routes/students.ts server/routes/students.test.ts server/app.ts
git commit -m "feat: add students list/search/filter and create API with duplicate-phone warning"
```

---

## Task 3: Students API — detail + update

**Files:**
- Modify: `server/routes/students.ts`, `server/routes/students.test.ts`

**Interfaces:**
- Consumes: everything from Task 2 (same file, extending it); `studentGuardians`, `guardians` tables (Task 1 / Stage 4) — for the embedded guardians list on detail.
- Produces: `GET /:id` (full unmasked student + embedded unmasked `guardians: []` array) and `PATCH /:id` (update, same `{status:'updated', student} | {status:'duplicate_warning', duplicates}` shape as create) — used by Task 5's guardian-linking additions to this file and Task 7's client detail page.

- [ ] **Step 1: Write the failing test additions to `server/routes/students.test.ts`**

Add this `describe` block to the same file (keep the existing block and helpers unchanged):

```ts
describe('students routes — detail and update', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('returns 404 for a missing student', async () => {
    await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app).get('/api/students/00000000-0000-0000-0000-000000000000').set('Cookie', cookie);
    expect(response.status).toBe(404);
  });

  it('returns full unmasked data with an empty guardians array on the detail endpoint', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });

    const detail = await request(app).get(`/api/students/${created.body.data.student.id}`).set('Cookie', cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.data.name).toBe(TEST_STUDENT_NAME);
    expect(detail.body.data.phoneNormalized).toBe(TEST_STUDENT_PHONE);
    expect(detail.body.data.guardians).toEqual([]);
  });

  it('updates a student with optimistic locking', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });

    const edited = await request(app)
      .patch(`/api/students/${created.body.data.student.id}`)
      .set('Cookie', cookie)
      .send({ specialNotes: '수정된 메모', expectedUpdatedAt: created.body.data.student.updatedAt });

    expect(edited.status).toBe(200);
    expect(edited.body.data.status).toBe('updated');
    expect(edited.body.data.student.specialNotes).toBe('수정된 메모');

    const staleEdit = await request(app)
      .patch(`/api/students/${created.body.data.student.id}`)
      .set('Cookie', cookie)
      .send({ specialNotes: '또 수정', expectedUpdatedAt: created.body.data.student.updatedAt });

    expect(staleEdit.status).toBe(409);
    expect(staleEdit.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('warns about a duplicate phone on update, until confirmDuplicate is set', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app).post('/api/students').set('Cookie', cookie).send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });
    const second = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: 'test-student-박민수', phone: '01077776666', gradeLevelId, confirmDuplicate: true });

    const attempt = await request(app)
      .patch(`/api/students/${second.body.data.student.id}`)
      .set('Cookie', cookie)
      .send({ phone: TEST_STUDENT_PHONE, expectedUpdatedAt: second.body.data.student.updatedAt });

    expect(attempt.status).toBe(200);
    expect(attempt.body.data.status).toBe('duplicate_warning');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/routes/students.test.ts`
Expected: FAIL — the 4 new tests fail with 404s; the 5 tests from Task 2 still pass.

- [ ] **Step 3: Extend `server/routes/students.ts`**

Add `ne` to the existing `drizzle-orm` import, and import `studentGuardians`/`guardians` from `@shared/schema`:
```ts
import { and, eq, ilike, isNull, ne, or } from 'drizzle-orm';
// ...
import { students, studentGuardians, guardians } from '@shared/schema';
```

Add this schema alongside `createStudentSchema`:
```ts
const updateStudentSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  gradeLevelId: z.string().min(1).optional(),
  schoolId: z.string().optional(),
  birthDate: z.string().optional(),
  address: z.string().optional(),
  specialNotes: z.string().optional(),
  counselingNotes: z.string().optional(),
  confirmDuplicate: z.boolean().optional(),
  expectedUpdatedAt: z.string(),
});
```

Add these two routes inside `createStudentsRouter`, after `POST /` and before `return router;`:

```ts
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
      .where(eq(studentGuardians.studentId, id));

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
    if (before.updatedAt.toISOString() !== parsed.expectedUpdatedAt) {
      res.status(409).json({
        error: { code: 'VERSION_CONFLICT', message: '다른 곳에서 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.', requestId: req.requestId },
      });
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

    const { expectedUpdatedAt: _expected, phone: _phone, confirmDuplicate: _confirm, ...rest } = parsed;

    let updated;
    try {
      [updated] = await db
        .update(students)
        .set({
          ...rest,
          ...(phoneNormalized !== undefined ? { phoneNormalized } : {}),
          updatedBy: req.admin!.id,
          updatedAt: new Date(),
        })
        .where(eq(students.id, id))
        .returning();
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
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '학생을 수정하지 못했습니다.', requestId: req.requestId } });
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/routes/students.test.ts`
Expected: PASS — 9 tests passing (5 from Task 2 + 4 new).

- [ ] **Step 5: Run check**

Run: `npm run check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add server/routes/students.ts server/routes/students.test.ts
git commit -m "feat: add student detail (with embedded guardians) and update API"
```

---

## Task 4: Students API — status change, soft delete, restore

**Files:**
- Modify: `server/routes/students.ts`, `server/routes/students.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-3 (same file).
- Produces: `POST /:id/status`, `DELETE /:id`, `POST /:id/restore` — used by Task 7's client detail page.

- [ ] **Step 1: Write the failing test additions to `server/routes/students.test.ts`**

Add this `describe` block:

```ts
describe('students routes — status, delete, restore', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('changes status and records the effective date', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });

    const response = await request(app)
      .post(`/api/students/${created.body.data.student.id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'paused', effectiveDate: '2026-09-01' });

    expect(response.status).toBe(200);
    expect(response.body.data.student.status).toBe('paused');
    expect(response.body.data.student.statusEffectiveDate).toBe('2026-09-01');
  });

  it('rejects an invalid status value', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });

    const response = await request(app)
      .post(`/api/students/${created.body.data.student.id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'not-a-real-status' });

    expect(response.status).toBe(400);
  });

  it('soft-deletes and restores a student', async () => {
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });
    const studentId = created.body.data.student.id;

    const deleted = await request(app).delete(`/api/students/${studentId}`).set('Cookie', cookie);
    expect(deleted.status).toBe(200);

    const afterDelete = await request(app).get(`/api/students/${studentId}`).set('Cookie', cookie);
    expect(afterDelete.status).toBe(404);

    const restored = await request(app).post(`/api/students/${studentId}/restore`).set('Cookie', cookie);
    expect(restored.status).toBe(200);

    const afterRestore = await request(app).get(`/api/students/${studentId}`).set('Cookie', cookie);
    expect(afterRestore.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/routes/students.test.ts`
Expected: FAIL — the 3 new tests fail with 404s; the 9 tests from Tasks 2-3 still pass.

- [ ] **Step 3: Extend `server/routes/students.ts`**

Add this schema alongside `updateStudentSchema`:
```ts
const statusChangeSchema = z.object({
  status: z.enum(STATUS_VALUES),
  effectiveDate: z.string().optional(),
  reason: z.string().optional(),
});
```

Add these three routes after `PATCH /:id` and before `return router;`:

```ts
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

    await db.update(students).set({ deletedAt: new Date(), updatedBy: req.admin!.id, updatedAt: new Date() }).where(eq(students.id, id));

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

    const [restored] = await db
      .update(students)
      .set({ deletedAt: null, updatedBy: req.admin!.id, updatedAt: new Date() })
      .where(eq(students.id, id))
      .returning();

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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/routes/students.test.ts`
Expected: PASS — 12 tests passing (9 from Tasks 2-3 + 3 new).

- [ ] **Step 5: Run check**

Run: `npm run check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add server/routes/students.ts server/routes/students.test.ts
git commit -m "feat: add student status-change, soft-delete, and restore API"
```

---

## Task 5: Student-guardian linking API

**Files:**
- Modify: `server/routes/students.ts`, `server/routes/students.test.ts`
- Create: `server/routes/studentGuardians.ts`, `server/routes/studentGuardians.test.ts`
- Modify: `server/app.ts`

**Interfaces:**
- Consumes: `students`, `studentGuardians`, `guardians` tables; `PERMISSIONS.STUDENTS_MANAGE`.
- Produces: `POST /api/students/:id/guardians` (added to `students.ts`) and `createStudentGuardiansRouter(deps): Router` mounted at `/api/student-guardians` with `PATCH /:id` and `DELETE /:id` — used by Task 7's client guardian-linking UI.

- [ ] **Step 1: Update `server/routes/students.test.ts`'s imports and shared `cleanup()` helper**

This task's tests create `student_guardians` link rows, which reference `students` by foreign key. The existing shared `cleanup()` function (used by every `describe` block's `afterEach` in this file) deletes `students` directly — once link rows exist, that delete would hit a foreign-key violation unless links are removed first. Fix `cleanup()` before adding new tests, so every existing test in this file keeps passing FK-safely too.

Change the top-of-file imports from:
```ts
import { and, eq, ilike } from 'drizzle-orm';
```
to:
```ts
import { and, eq, ilike, inArray } from 'drizzle-orm';
```
and from:
```ts
import { admins, roles, students, gradeLevels } from '@shared/schema';
```
to:
```ts
import { admins, roles, students, gradeLevels, studentGuardians } from '@shared/schema';
```

Change the `cleanup()` function from:
```ts
async function cleanup() {
  await db.delete(students).where(ilike(students.name, 'test-student-%'));
  await db.delete(gradeLevels).where(eq(gradeLevels.name, TEST_GRADE_NAME));
```
to:
```ts
async function cleanup() {
  const testStudents = await db.select({ id: students.id }).from(students).where(ilike(students.name, 'test-student-%'));
  if (testStudents.length > 0) {
    await db.delete(studentGuardians).where(
      inArray(
        studentGuardians.studentId,
        testStudents.map((s) => s.id)
      )
    );
  }
  await db.delete(students).where(ilike(students.name, 'test-student-%'));
  await db.delete(gradeLevels).where(eq(gradeLevels.name, TEST_GRADE_NAME));
```
(leave the rest of `cleanup()` — the admin/role cleanup below this point — unchanged).

Run `npx vitest run server/routes/students.test.ts` to confirm the existing 12 tests still pass after this change, before proceeding.

- [ ] **Step 2: Write the failing test additions to `server/routes/students.test.ts`**

Add this `describe` block (it needs its own guardian fixtures, so add a small local helper rather than reusing the guardians test file's helpers):

```ts
describe('students routes — guardian linking', () => {
  afterEach(async () => {
    await cleanup();
    const { guardians } = await import('@shared/schema');
    await db.delete(guardians).where(ilike(guardians.name, 'test-student-guardian-%'));
  });

  it('links a guardian to a student and returns it in the detail view', async () => {
    const { guardians } = await import('@shared/schema');
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const student = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });
    const [guardian] = await db
      .insert(guardians)
      .values({ name: 'test-student-guardian-김보호', phoneNormalized: '01011112222' })
      .returning();

    const linked = await request(app)
      .post(`/api/students/${student.body.data.student.id}/guardians`)
      .set('Cookie', cookie)
      .send({ guardianId: guardian!.id, relationship: '모', isPrimary: true });

    expect(linked.status).toBe(200);
    expect(linked.body.data.isPrimary).toBe(true);

    const detail = await request(app).get(`/api/students/${student.body.data.student.id}`).set('Cookie', cookie);
    expect(detail.body.data.guardians).toHaveLength(1);
    expect(detail.body.data.guardians[0].guardian.name).toBe('test-student-guardian-김보호');
  });

  it('rejects linking the same guardian to the same student twice', async () => {
    const { guardians } = await import('@shared/schema');
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const student = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });
    const [guardian] = await db
      .insert(guardians)
      .values({ name: 'test-student-guardian-이보호', phoneNormalized: '01033334444' })
      .returning();

    await request(app).post(`/api/students/${student.body.data.student.id}/guardians`).set('Cookie', cookie).send({ guardianId: guardian!.id });
    const secondAttempt = await request(app)
      .post(`/api/students/${student.body.data.student.id}/guardians`)
      .set('Cookie', cookie)
      .send({ guardianId: guardian!.id });

    expect(secondAttempt.status).toBe(409);
    expect(secondAttempt.body.error.code).toBe('DUPLICATE_LINK');
  });

  it('moving isPrimary to a new link unsets the old primary', async () => {
    const { guardians } = await import('@shared/schema');
    const { gradeLevelId } = await seedSuperAdminAndGrade();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const student = await request(app)
      .post('/api/students')
      .set('Cookie', cookie)
      .send({ name: TEST_STUDENT_NAME, phone: TEST_STUDENT_PHONE, gradeLevelId });
    const [guardianA] = await db
      .insert(guardians)
      .values({ name: 'test-student-guardian-박부모A', phoneNormalized: '01055556666' })
      .returning();
    const [guardianB] = await db
      .insert(guardians)
      .values({ name: 'test-student-guardian-박부모B', phoneNormalized: '01077778888' })
      .returning();

    const linkA = await request(app)
      .post(`/api/students/${student.body.data.student.id}/guardians`)
      .set('Cookie', cookie)
      .send({ guardianId: guardianA!.id, isPrimary: true });

    const linkB = await request(app)
      .post(`/api/students/${student.body.data.student.id}/guardians`)
      .set('Cookie', cookie)
      .send({ guardianId: guardianB!.id, isPrimary: true });

    expect(linkB.body.data.isPrimary).toBe(true);

    const detail = await request(app).get(`/api/students/${student.body.data.student.id}`).set('Cookie', cookie);
    const linkAAfter = detail.body.data.guardians.find((g: { id: string }) => g.id === linkA.body.data.id);
    expect(linkAAfter.isPrimary).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run server/routes/students.test.ts`
Expected: FAIL — the 3 new tests fail with 404s.

- [ ] **Step 4: Extend `server/routes/students.ts`**

Add `studentGuardians` usage (already imported in Task 3) and this schema alongside `statusChangeSchema`:
```ts
const linkGuardianSchema = z.object({
  guardianId: z.string().min(1),
  relationship: z.string().optional(),
  isPrimary: z.boolean().optional(),
  receiveMessages: z.boolean().optional(),
  useForCheckin: z.boolean().optional(),
});
```

Add `isUniqueViolation` alongside `isForeignKeyViolation`:
```ts
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
```

Add this route after `POST /:id/restore` and before `return router;`:

```ts
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
          await tx.update(studentGuardians).set({ isPrimary: false, updatedAt: new Date() }).where(eq(studentGuardians.studentId, id));
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
          })
          .returning();
        return row;
      });
    } catch (error) {
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
```

- [ ] **Step 5: Write `server/routes/studentGuardians.test.ts`**

```ts
import { eq, ilike, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, students, gradeLevels, guardians, studentGuardians } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-studentguardians-super@example.com';
const PASSWORD = 'test-studentguardians-password-123';
const TEST_GRADE_NAME = 'test-studentguardians-grade';

async function seedFixtures() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-studentguardians-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION] })
    .returning();
  await db.insert(admins).values({
    email: SUPER_EMAIL,
    name: '수퍼',
    passwordHash: await hashPassword(PASSWORD),
    roleId: role!.id,
    status: 'active',
  });
  const [grade] = await db.insert(gradeLevels).values({ name: TEST_GRADE_NAME, sortOrder: 0 }).returning();
  const [student] = await db
    .insert(students)
    .values({
      name: 'test-studentguardians-학생',
      phoneNormalized: '01099990000',
      gradeLevelId: grade!.id,
      registrationDate: '2026-08-15',
      statusEffectiveDate: '2026-08-15',
    })
    .returning();
  const [guardian] = await db.insert(guardians).values({ name: 'test-studentguardians-보호자', phoneNormalized: '01088880000' }).returning();
  return { studentId: student!.id, guardianId: guardian!.id, gradeLevelId: grade!.id };
}

async function loginAs(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return response.headers['set-cookie'][0];
}

async function cleanup() {
  const testStudents = await db.select({ id: students.id }).from(students).where(ilike(students.name, 'test-studentguardians-%'));
  if (testStudents.length > 0) {
    await db.delete(studentGuardians).where(
      inArray(
        studentGuardians.studentId,
        testStudents.map((s) => s.id)
      )
    );
  }
  await db.delete(students).where(ilike(students.name, 'test-studentguardians-%'));
  await db.delete(guardians).where(ilike(guardians.name, 'test-studentguardians-%'));
  await db.delete(gradeLevels).where(eq(gradeLevels.name, TEST_GRADE_NAME));

  const adminToDelete = await db.query.admins.findFirst({ where: eq(admins.email, SUPER_EMAIL) });
  if (adminToDelete) {
    const { auditLogs, authSessions, passwordResetTokens } = await import('@shared/schema');
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-studentguardians-role'));
}

describe('student-guardians routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).patch('/api/student-guardians/00000000-0000-0000-0000-000000000000').send({});
    expect(response.status).toBe(401);
  });

  it('updates a link with optimistic locking', async () => {
    const { studentId, guardianId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const linked = await request(app).post(`/api/students/${studentId}/guardians`).set('Cookie', cookie).send({ guardianId });

    const edited = await request(app)
      .patch(`/api/student-guardians/${linked.body.data.id}`)
      .set('Cookie', cookie)
      .send({ relationship: '부', receiveMessages: false, expectedUpdatedAt: linked.body.data.updatedAt });

    expect(edited.status).toBe(200);
    expect(edited.body.data.relationship).toBe('부');
    expect(edited.body.data.receiveMessages).toBe(false);

    const staleEdit = await request(app)
      .patch(`/api/student-guardians/${linked.body.data.id}`)
      .set('Cookie', cookie)
      .send({ relationship: '모', expectedUpdatedAt: linked.body.data.updatedAt });

    expect(staleEdit.status).toBe(409);
  });

  it('unlinks a guardian from a student', async () => {
    const { studentId, guardianId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const linked = await request(app).post(`/api/students/${studentId}/guardians`).set('Cookie', cookie).send({ guardianId });

    const deleted = await request(app).delete(`/api/student-guardians/${linked.body.data.id}`).set('Cookie', cookie);
    expect(deleted.status).toBe(200);

    const detail = await request(app).get(`/api/students/${studentId}`).set('Cookie', cookie);
    expect(detail.body.data.guardians).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Write `server/routes/studentGuardians.ts`**

```ts
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { studentGuardians } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';

const updateLinkSchema = z.object({
  relationship: z.string().optional(),
  isPrimary: z.boolean().optional(),
  receiveMessages: z.boolean().optional(),
  useForCheckin: z.boolean().optional(),
  expectedUpdatedAt: z.string(),
});

export interface StudentGuardiansRouterDeps {
  sessionSecret: string;
}

export function createStudentGuardiansRouter(deps: StudentGuardiansRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireStudentsManage = createRequirePermission(PERMISSIONS.STUDENTS_MANAGE);

  router.patch('/:id', requireAuth, requireStudentsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateLinkSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(studentGuardians).where(eq(studentGuardians.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '연결 정보를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    if (before.updatedAt.toISOString() !== parsed.expectedUpdatedAt) {
      res.status(409).json({
        error: { code: 'VERSION_CONFLICT', message: '다른 곳에서 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.', requestId: req.requestId },
      });
      return;
    }

    const { expectedUpdatedAt: _expected, ...changes } = parsed;

    const updated = await db.transaction(async (tx) => {
      if (changes.isPrimary) {
        await tx
          .update(studentGuardians)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(eq(studentGuardians.studentId, before.studentId));
      }
      const [row] = await tx
        .update(studentGuardians)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(studentGuardians.id, id))
        .returning();
      return row;
    });
    if (!updated) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '수정하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'student_guardian.update',
      targetType: 'student_guardian',
      targetId: updated.id,
      beforeDataSafe: { relationship: before.relationship, isPrimary: before.isPrimary },
      afterDataSafe: { relationship: updated.relationship, isPrimary: updated.isPrimary },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.delete('/:id', requireAuth, requireStudentsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [existing] = await db.select().from(studentGuardians).where(eq(studentGuardians.id, id));
    if (!existing) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '연결 정보를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    await db.delete(studentGuardians).where(eq(studentGuardians.id, id));

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'student_guardian.delete',
      targetType: 'student_guardian',
      targetId: id,
      beforeDataSafe: { studentId: existing.studentId, guardianId: existing.guardianId },
      afterDataSafe: null,
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: { success: true }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
```

- [ ] **Step 7: Mount the new router in `server/app.ts`**

```ts
import { createStudentGuardiansRouter } from './routes/studentGuardians';
// ...
app.use('/api/student-guardians', createStudentGuardiansRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
```

- [ ] **Step 8: Run to verify everything passes**

Run: `npx vitest run server/routes/students.test.ts server/routes/studentGuardians.test.ts`
Expected: PASS — 15 tests in `students.test.ts` (12 from Tasks 2-4 + 3 new), 3 tests in `studentGuardians.test.ts`.

- [ ] **Step 9: Run check**

Run: `npm run check`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add server/routes/students.ts server/routes/students.test.ts server/routes/studentGuardians.ts server/routes/studentGuardians.test.ts server/app.ts
git commit -m "feat: add student-guardian linking API"
```

---

## Task 6: Client — student list, search, filter, and create

**Files:**
- Create: `client/src/features/students/StudentListPage.tsx`, `client/src/features/students/StudentListPage.test.tsx`
- Modify: `client/src/routes.tsx`, `client/src/features/dashboard/AdminHomePage.tsx`, `client/src/features/dashboard/AdminHomePage.test.tsx`

**Interfaces:**
- Consumes: `apiGet`, `apiPost`, `ApiRequestError` from `client/src/lib/apiClient.ts`; the existing `GET /api/schools`, `GET /api/grade-levels` endpoints from Stage 3 (for the school/grade dropdowns in the create form).
- Produces: a rendered `/admin/students` page — consumed by Task 8's e2e test.

- [ ] **Step 1: Write the failing test `client/src/features/students/StudentListPage.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudentListPage } from './StudentListPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-15T00:00:00+09:00' } }),
  };
}

describe('StudentListPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads grade levels, the student list, and creates a new student', async () => {
    const studentsState = [
      { id: 's1', name: '김*수', phoneNormalized: '010-****-5678', schoolId: null, gradeLevelId: 'g1', status: 'enrolled', registrationDate: '2026-08-15', updatedAt: '2026-08-15T00:00:00+09:00' },
    ];

    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/grade-levels') return Promise.resolve(jsonResponse([{ id: 'g1', name: '초1', sortOrder: 0, isActive: true }]));
      if (path === '/api/schools') return Promise.resolve(jsonResponse([]));
      if (path.startsWith('/api/students') && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(studentsState));
      }
      if (path === '/api/students' && init?.method === 'POST') {
        const created = { id: 's2', name: '새학생', phoneNormalized: '01011112222', gradeLevelId: 'g1', schoolId: null, status: 'enrolled', registrationDate: '2026-08-15', updatedAt: '2026-08-15T00:05:00+09:00' };
        studentsState.push({ ...created, name: '새*생', phoneNormalized: '010-****-2222' });
        return Promise.resolve(jsonResponse({ status: 'created', student: created }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StudentListPage />);

    await screen.findByText('김*수');
    await screen.findByRole('option', { name: '초1' });

    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '새학생' } });
    fireEvent.change(screen.getByLabelText('전화번호'), { target: { value: '010-1111-2222' } });
    fireEvent.change(screen.getByLabelText('학년'), { target: { value: 'g1' } });
    fireEvent.click(screen.getByRole('button', { name: '학생 등록' }));

    await waitFor(() => expect(screen.getByText('새*생')).toBeInTheDocument());
  });

  it('shows a duplicate warning and requires confirmation before creating', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/grade-levels') return Promise.resolve(jsonResponse([{ id: 'g1', name: '초1', sortOrder: 0, isActive: true }]));
      if (path === '/api/schools') return Promise.resolve(jsonResponse([]));
      if (path.startsWith('/api/students') && (!init || init.method === undefined)) return Promise.resolve(jsonResponse([]));
      if (path === '/api/students' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string) as { confirmDuplicate?: boolean };
        if (!body.confirmDuplicate) {
          return Promise.resolve(
            jsonResponse({ status: 'duplicate_warning', duplicates: [{ id: 's1', name: '김*수', phoneNormalized: '010-****-5678' }] })
          );
        }
        return Promise.resolve(
          jsonResponse({
            status: 'created',
            student: { id: 's3', name: '중복학생', phoneNormalized: '01099998888', gradeLevelId: 'g1', schoolId: null, status: 'enrolled', registrationDate: '2026-08-15', updatedAt: '2026-08-15T00:00:00+09:00' },
          })
        );
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<StudentListPage />);
    await screen.findByRole('option', { name: '초1' });

    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '중복학생' } });
    fireEvent.change(screen.getByLabelText('전화번호'), { target: { value: '010-9999-8888' } });
    fireEvent.change(screen.getByLabelText('학년'), { target: { value: 'g1' } });
    fireEvent.click(screen.getByRole('button', { name: '학생 등록' }));

    await screen.findByText(/이미 등록된 전화번호/);
    fireEvent.click(screen.getByRole('button', { name: '그래도 등록' }));

    await waitFor(() => expect(screen.queryByText(/이미 등록된 전화번호/)).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/src/features/students/StudentListPage.test.tsx`
Expected: FAIL — `Cannot find module './StudentListPage'`.

- [ ] **Step 3: Write `client/src/features/students/StudentListPage.tsx`**

```tsx
import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ApiRequestError, apiGet, apiPost } from '../../lib/apiClient';

interface MaskedStudent {
  id: string;
  name: string;
  phoneNormalized: string;
  schoolId: string | null;
  gradeLevelId: string;
  status: string;
  registrationDate: string;
  updatedAt: string;
}

interface GradeLevel {
  id: string;
  name: string;
}

interface School {
  id: string;
  name: string;
}

interface DuplicateCandidate {
  id: string;
  name: string;
  phoneNormalized: string;
}

type CreateStudentResponse =
  | { status: 'created'; student: { id: string } }
  | { status: 'duplicate_warning'; duplicates: DuplicateCandidate[] };

const STATUS_LABELS: Record<string, string> = {
  enrolled: '재원',
  paused: '휴원',
  withdrawn: '퇴원',
  graduated: '졸업',
};

export function StudentListPage() {
  const [students, setStudents] = useState<MaskedStudent[]>([]);
  const [gradeLevels, setGradeLevels] = useState<GradeLevel[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gradeLevelId, setGradeLevelId] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadStudents(query?: string) {
    const path = query ? `/api/students?search=${encodeURIComponent(query)}` : '/api/students';
    setStudents(await apiGet<MaskedStudent[]>(path));
  }

  useEffect(() => {
    async function load() {
      const [gradeList, schoolList] = await Promise.all([apiGet<GradeLevel[]>('/api/grade-levels'), apiGet<School[]>('/api/schools')]);
      setGradeLevels(gradeList);
      setSchools(schoolList);
      await loadStudents();
    }
    void load().catch((err: unknown) => {
      setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
    });
  }, []);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await loadStudents(search);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '검색하지 못했습니다.');
    }
  }

  async function submitCreate(confirmDuplicate: boolean) {
    setError(null);
    try {
      const response = await apiPost<CreateStudentResponse>('/api/students', { name, phone, gradeLevelId, schoolId: schoolId || undefined, confirmDuplicate });
      if (response.status === 'duplicate_warning') {
        setDuplicates(response.duplicates);
        return;
      }
      setDuplicates(null);
      setName('');
      setPhone('');
      setGradeLevelId('');
      setSchoolId('');
      await loadStudents(search);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '학생을 등록하지 못했습니다.');
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitCreate(false);
  }

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">학생 관리</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <form onSubmit={handleSearch} className="mt-4 flex gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span>검색</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="이름 또는 전화번호"
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <button type="submit" className="self-end rounded bg-gray-200 px-4 py-2">
          검색
        </button>
      </form>

      <ul className="mt-4 space-y-2">
        {students.map((student) => (
          <li key={student.id} className="rounded border border-gray-200 p-2">
            <Link href={`/admin/students/${student.id}`} className="text-blue-600 underline">
              {student.name}
            </Link>
            <span className="ml-2 text-gray-600">{student.phoneNormalized}</span>
            <span className="ml-2 text-sm text-gray-500">{STATUS_LABELS[student.status] ?? student.status}</span>
          </li>
        ))}
      </ul>

      <form onSubmit={handleCreate} className="mt-6 flex flex-col gap-3 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">새 학생 등록</h2>
        <label className="flex flex-col gap-1">
          <span>이름</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>전화번호</span>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            required
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>학년</span>
          <select
            value={gradeLevelId}
            onChange={(event) => setGradeLevelId(event.target.value)}
            required
            className="rounded border border-gray-300 px-3 py-2 text-base"
          >
            <option value="">선택</option>
            {gradeLevels.map((grade) => (
              <option key={grade.id} value={grade.id}>
                {grade.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span>학교</span>
          <select value={schoolId} onChange={(event) => setSchoolId(event.target.value)} className="rounded border border-gray-300 px-3 py-2 text-base">
            <option value="">선택 안 함</option>
            {schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
              </option>
            ))}
          </select>
        </label>

        {duplicates && duplicates.length > 0 && (
          <div role="alert" className="rounded border border-yellow-400 bg-yellow-50 p-3 text-sm">
            <p>이미 등록된 전화번호와 일치하는 학생이 있습니다:</p>
            <ul className="mt-1 list-disc pl-5">
              {duplicates.map((candidate) => (
                <li key={candidate.id}>
                  <Link href={`/admin/students/${candidate.id}`} className="underline">
                    {candidate.name}
                  </Link>{' '}
                  ({candidate.phoneNormalized})
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => submitCreate(true)} className="mt-2 rounded bg-yellow-500 px-3 py-1 text-white">
              그래도 등록
            </button>
          </div>
        )}

        <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 text-white">
          학생 등록
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/src/features/students/StudentListPage.test.tsx`
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Add the `/admin/students` route to `client/src/routes.tsx`**

Add the import `import { StudentListPage } from './features/students/StudentListPage';` and a new route, inserted after the `/admin/guardians/:guardianId` route and before the closing `</Switch>`:

```tsx
      <Route path="/admin/students">
        <ProtectedRoute>
          <StudentListPage />
        </ProtectedRoute>
      </Route>
```

(Task 7 adds `/admin/students/:studentId` right after this one, in the same file.)

- [ ] **Step 6: Add a nav link to `client/src/features/dashboard/AdminHomePage.tsx`**

Add a new `<li>` to the existing `<ul>` inside `<nav>`, after the "보호자 관리" link and before "내 계정":

```tsx
          <li>
            <Link href="/admin/students" className="text-blue-600 underline">
              학생 관리
            </Link>
          </li>
```

Update `client/src/features/dashboard/AdminHomePage.test.tsx` to also assert this new link is present, matching the existing test's pattern for the other nav links.

- [ ] **Step 7: Run check and the full client test suite**

Run:
```bash
npm run check
npx vitest run
```
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add client/src/features/students/StudentListPage.tsx client/src/features/students/StudentListPage.test.tsx client/src/routes.tsx client/src/features/dashboard/AdminHomePage.tsx client/src/features/dashboard/AdminHomePage.test.tsx
git commit -m "feat: add student list, search, filter, and create client page"
```

---

## Task 7: Client — student detail, edit, status change, and guardian linking

**Files:**
- Create: `client/src/features/students/StudentDetailPage.tsx`, `client/src/features/students/StudentDetailPage.test.tsx`
- Modify: `client/src/routes.tsx`

**Interfaces:**
- Consumes: `apiGet`, `apiPatch`, `apiPost`, `apiDelete`, `ApiRequestError` from `client/src/lib/apiClient.ts`; `GET /api/guardians?search=` (Stage 4) for the guardian-linking search; `useParams` from `wouter`.
- Produces: a rendered `/admin/students/:studentId` page — consumed by Task 8's e2e test.

- [ ] **Step 1: Write the failing test `client/src/features/students/StudentDetailPage.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { StudentDetailPage } from './StudentDetailPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-15T00:00:00+09:00' } }),
  };
}

function renderAtStudentDetail(studentId: string) {
  const { hook } = memoryLocation({ path: `/admin/students/${studentId}`, static: true });
  return render(
    <Router hook={hook}>
      <Route path="/admin/students/:studentId">
        <StudentDetailPage />
      </Route>
    </Router>
  );
}

const baseStudent = {
  id: 'st1',
  name: '김철수',
  phoneNormalized: '01012345678',
  schoolId: null,
  gradeLevelId: 'g1',
  birthDate: null,
  address: null,
  registrationDate: '2026-08-15',
  status: 'enrolled',
  statusEffectiveDate: '2026-08-15',
  specialNotes: null,
  counselingNotes: null,
  updatedAt: '2026-08-15T00:00:00+09:00',
  guardians: [],
};

describe('StudentDetailPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the full unmasked student and saves an edit', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/students/st1' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(baseStudent));
      if (path === '/api/students/st1' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ status: 'updated', student: { ...baseStudent, specialNotes: '새 메모', updatedAt: '2026-08-15T00:10:00+09:00' } }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAtStudentDetail('st1');

    const nameInput = await screen.findByLabelText('이름');
    expect(nameInput).toHaveValue('김철수');

    fireEvent.change(screen.getByLabelText('특이사항'), { target: { value: '새 메모' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(screen.getByText('저장되었습니다.')).toBeInTheDocument());
  });

  it('links an existing guardian found via search', async () => {
    const linkedGuardians: unknown[] = [];
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/students/st1' && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse({ ...baseStudent, guardians: linkedGuardians }));
      }
      if (path.startsWith('/api/guardians?search=')) {
        return Promise.resolve(jsonResponse([{ id: 'gd1', name: '이보호', phoneNormalized: '010-****-9999', notes: null, updatedAt: '2026-08-15T00:00:00+09:00' }]));
      }
      if (path === '/api/students/st1/guardians' && init?.method === 'POST') {
        const link = { id: 'link1', relationship: null, isPrimary: false, receiveMessages: true, useForCheckin: true, updatedAt: '2026-08-15T00:00:00+09:00' };
        linkedGuardians.push({ ...link, guardian: { id: 'gd1', name: '이보호', phoneNormalized: '01099998888', notes: null } });
        return Promise.resolve(jsonResponse(link));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAtStudentDetail('st1');
    await screen.findByLabelText('이름');

    fireEvent.change(screen.getByLabelText('보호자 검색'), { target: { value: '이보호' } });
    fireEvent.click(screen.getByRole('button', { name: '보호자 검색' }));

    await screen.findByText('이보호');
    fireEvent.click(screen.getByRole('button', { name: '연결' }));

    await waitFor(() => expect(screen.getByText('01099998888')).toBeInTheDocument());
  });

  it('deletes the student after confirmation and navigates back to the list', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/students/st1' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(baseStudent));
      if (path === '/api/students/st1' && init?.method === 'DELETE') return Promise.resolve(jsonResponse({ success: true }));
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', () => true);

    renderAtStudentDetail('st1');

    await screen.findByLabelText('이름');
    fireEvent.click(screen.getByRole('button', { name: '학생 삭제' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/students/st1', expect.objectContaining({ method: 'DELETE' }))
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/src/features/students/StudentDetailPage.test.tsx`
Expected: FAIL — `Cannot find module './StudentDetailPage'`.

- [ ] **Step 3: Write `client/src/features/students/StudentDetailPage.tsx`**

```tsx
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { ApiRequestError, apiDelete, apiGet, apiPatch, apiPost } from '../../lib/apiClient';

interface LinkedGuardian {
  id: string;
  relationship: string | null;
  isPrimary: boolean;
  receiveMessages: boolean;
  useForCheckin: boolean;
  updatedAt: string;
  guardian: { id: string; name: string; phoneNormalized: string; notes: string | null };
}

interface Student {
  id: string;
  name: string;
  phoneNormalized: string;
  gradeLevelId: string;
  schoolId: string | null;
  address: string | null;
  status: string;
  statusEffectiveDate: string;
  specialNotes: string | null;
  counselingNotes: string | null;
  updatedAt: string;
  guardians: LinkedGuardian[];
}

interface DuplicateCandidate {
  id: string;
  name: string;
  phoneNormalized: string;
}

type UpdateStudentResponse = { status: 'updated'; student: Student } | { status: 'duplicate_warning'; duplicates: DuplicateCandidate[] };

interface GuardianSearchResult {
  id: string;
  name: string;
  phoneNormalized: string;
}

const STATUS_OPTIONS = [
  { value: 'enrolled', label: '재원' },
  { value: 'paused', label: '휴원' },
  { value: 'withdrawn', label: '퇴원' },
  { value: 'graduated', label: '졸업' },
];

export function StudentDetailPage() {
  const params = useParams<{ studentId: string }>();
  const studentId = params.studentId;
  const [, navigate] = useLocation();

  const [student, setStudent] = useState<Student | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [specialNotes, setSpecialNotes] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [statusChoice, setStatusChoice] = useState('enrolled');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [guardianSearch, setGuardianSearch] = useState('');
  const [guardianResults, setGuardianResults] = useState<GuardianSearchResult[]>([]);

  async function reload() {
    if (!studentId) return;
    const data = await apiGet<Student>(`/api/students/${studentId}`);
    setStudent(data);
    setName(data.name);
    setPhone(data.phoneNormalized);
    setSpecialNotes(data.specialNotes ?? '');
    setStatusChoice(data.status);
  }

  useEffect(() => {
    void reload().catch((err: unknown) => {
      setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
    });
  }, [studentId]);

  async function submitUpdate(confirmDuplicate: boolean) {
    if (!student) return;
    setError(null);
    try {
      const response = await apiPatch<UpdateStudentResponse>(`/api/students/${student.id}`, {
        name,
        phone,
        specialNotes,
        confirmDuplicate,
        expectedUpdatedAt: student.updatedAt,
      });
      if (response.status === 'duplicate_warning') {
        setDuplicates(response.duplicates);
        return;
      }
      setDuplicates(null);
      await reload();
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '저장하지 못했습니다.');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitUpdate(false);
  }

  async function handleStatusChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!student) return;
    setError(null);
    try {
      await apiPost(`/api/students/${student.id}/status`, { status: statusChoice });
      await reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '상태를 변경하지 못했습니다.');
    }
  }

  async function handleGuardianSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const results = await apiGet<GuardianSearchResult[]>(`/api/guardians?search=${encodeURIComponent(guardianSearch)}`);
      setGuardianResults(results);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '보호자를 검색하지 못했습니다.');
    }
  }

  async function handleLinkGuardian(guardianId: string) {
    if (!student) return;
    setError(null);
    try {
      await apiPost(`/api/students/${student.id}/guardians`, { guardianId });
      await reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '보호자를 연결하지 못했습니다.');
    }
  }

  async function handleUnlinkGuardian(linkId: string) {
    setError(null);
    try {
      await apiDelete(`/api/student-guardians/${linkId}`);
      await reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '연결을 해제하지 못했습니다.');
    }
  }

  async function handleDeleteStudent() {
    if (!student) return;
    if (!window.confirm(`'${student.name}' 학생을 삭제하시겠습니까? 삭제된 학생은 목록에서 보이지 않습니다.`)) return;
    setError(null);
    try {
      await apiDelete(`/api/students/${student.id}`);
      navigate('/admin/students');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '학생을 삭제하지 못했습니다.');
    }
  }

  if (!student) {
    return (
      <section className="p-4">
        {error ? (
          <>
            <Link href="/admin/students" className="text-blue-600 underline">
              목록으로
            </Link>
            <p role="alert" className="mt-2 text-sm text-red-600">
              {error}
            </p>
          </>
        ) : (
          <p className="text-gray-500">불러오는 중...</p>
        )}
      </section>
    );
  }

  return (
    <section className="p-4">
      <Link href="/admin/students" className="text-blue-600 underline">
        목록으로
      </Link>
      <h1 className="mt-2 text-xl font-semibold">학생 상세</h1>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span>이름</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required className="rounded border border-gray-300 px-3 py-2 text-base" />
        </label>
        <label className="flex flex-col gap-1">
          <span>전화번호</span>
          <input value={phone} onChange={(event) => setPhone(event.target.value)} required className="rounded border border-gray-300 px-3 py-2 text-base" />
        </label>
        <label className="flex flex-col gap-1">
          <span>특이사항</span>
          <input value={specialNotes} onChange={(event) => setSpecialNotes(event.target.value)} className="rounded border border-gray-300 px-3 py-2 text-base" />
        </label>

        {duplicates && duplicates.length > 0 && (
          <div role="alert" className="rounded border border-yellow-400 bg-yellow-50 p-3 text-sm">
            <p>이미 등록된 전화번호와 일치하는 학생이 있습니다:</p>
            <ul className="mt-1 list-disc pl-5">
              {duplicates.map((candidate) => (
                <li key={candidate.id}>
                  <Link href={`/admin/students/${candidate.id}`} className="underline">
                    {candidate.name}
                  </Link>{' '}
                  ({candidate.phoneNormalized})
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => submitUpdate(true)} className="mt-2 rounded bg-yellow-500 px-3 py-1 text-white">
              그래도 저장
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {saved && <p className="text-sm text-green-700">저장되었습니다.</p>}

        <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 text-white">
          저장
        </button>
      </form>

      <form onSubmit={handleStatusChange} className="mt-6 flex flex-col gap-2 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">상태 변경</h2>
        <select value={statusChoice} onChange={(event) => setStatusChoice(event.target.value)} className="rounded border border-gray-300 px-3 py-2 text-base">
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="submit" className="self-start rounded bg-gray-700 px-4 py-2 text-white">
          상태 변경
        </button>
      </form>

      <button type="button" onClick={handleDeleteStudent} className="mt-6 rounded border border-red-400 px-4 py-2 text-red-600">
        학생 삭제
      </button>

      <div className="mt-6 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">연결된 보호자</h2>
        <ul className="mt-2 space-y-2">
          {student.guardians.map((link) => (
            <li key={link.id} className="flex items-center justify-between rounded border border-gray-100 p-2">
              <span>
                {link.guardian.name} ({link.guardian.phoneNormalized}) {link.isPrimary && <strong>대표</strong>}
              </span>
              <button type="button" onClick={() => handleUnlinkGuardian(link.id)} className="text-sm text-red-600 underline">
                연결 해제
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={handleGuardianSearch} className="mt-4 flex gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span>보호자 검색</span>
            <input
              value={guardianSearch}
              onChange={(event) => setGuardianSearch(event.target.value)}
              className="rounded border border-gray-300 px-3 py-2 text-base"
            />
          </label>
          <button type="submit" className="self-end rounded bg-gray-200 px-4 py-2">
            보호자 검색
          </button>
        </form>

        <ul className="mt-2 space-y-1">
          {guardianResults.map((result) => (
            <li key={result.id} className="flex items-center justify-between">
              <span>
                {result.name} ({result.phoneNormalized})
              </span>
              <button type="button" onClick={() => handleLinkGuardian(result.id)} className="text-sm text-blue-600 underline">
                연결
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/src/features/students/StudentDetailPage.test.tsx`
Expected: PASS — 3 tests passing. (If `wouter/memory-location` doesn't resolve as written, check `client/src/components/layout/ProtectedRoute.test.tsx` for the working pattern already established in this codebase — this exact fallback was already needed once in Stage 4's `GuardianDetailPage.test.tsx`.)

- [ ] **Step 5: Add the route to `client/src/routes.tsx`**

Add the import `import { StudentDetailPage } from './features/students/StudentDetailPage';` and a new route, right after the `/admin/students` route added in Task 6:

```tsx
      <Route path="/admin/students/:studentId">
        <ProtectedRoute>
          <StudentDetailPage />
        </ProtectedRoute>
      </Route>
```

- [ ] **Step 6: Run check and the full client test suite**

Run:
```bash
npm run check
npx vitest run
```
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add client/src/features/students/StudentDetailPage.tsx client/src/features/students/StudentDetailPage.test.tsx client/src/routes.tsx
git commit -m "feat: add student detail, edit, status-change, and guardian-linking client page"
```

---

## Task 8: End-to-end verification and full check

**Files:**
- Create: `tests/e2e/students.spec.ts`

**Interfaces:**
- Consumes: the running app from `npm run dev`, `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD` from `.env`, and an existing grade level (the e2e test creates its own via the Stage 3 academics-settings flow first, so it doesn't depend on manually-seeded data).

- [ ] **Step 1: Write `tests/e2e/students.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('logs in, creates a student, links a guardian, and confirms a duplicate-phone warning', async ({ page }) => {
  const email = process.env.INITIAL_ADMIN_EMAIL;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('INITIAL_ADMIN_EMAIL/INITIAL_ADMIN_PASSWORD must be set in .env for this test');
  }

  await page.goto('/login');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto('/admin/settings/academics');
  const gradeName = `e2e학년${Date.now()}`;
  await page.getByLabel('새 학년 이름').fill(gradeName);
  await page.getByRole('button', { name: '학년 추가' }).click();
  await expect(page.getByText(gradeName)).toBeVisible();

  await page.getByRole('link', { name: '학생 관리' }).click();
  await expect(page).toHaveURL(/\/admin\/students$/);

  const studentName = `e2e학생${Date.now()}`;
  const studentPhone = `010${Date.now().toString().slice(-8)}`;

  await page.getByLabel('이름').fill(studentName);
  await page.getByLabel('전화번호').fill(studentPhone);
  await page.getByLabel('학년').selectOption({ label: gradeName });
  await page.getByRole('button', { name: '학생 등록' }).click();

  const maskedName = `${Array.from(studentName)[0]}${'*'.repeat(Array.from(studentName).length - 2)}${Array.from(studentName)[Array.from(studentName).length - 1]}`;
  await expect(page.getByText(maskedName)).toBeVisible();

  await page.getByRole('link', { name: maskedName }).click();
  await expect(page).toHaveURL(/\/admin\/students\/.+/);
  await expect(page.getByLabel('이름')).toHaveValue(studentName);

  const guardianName = `e2e보호자${Date.now()}`;
  await page.getByLabel('보호자 검색').fill(guardianName);
  await page.getByRole('button', { name: '보호자 검색' }).click();

  await page.getByRole('link', { name: '목록으로' }).click();
  await expect(page).toHaveURL(/\/admin\/students$/);

  const secondStudentName = `e2e학생2-${Date.now()}`;
  await page.getByLabel('이름').fill(secondStudentName);
  await page.getByLabel('전화번호').fill(studentPhone);
  await page.getByLabel('학년').selectOption({ label: gradeName });
  await page.getByRole('button', { name: '학생 등록' }).click();

  await expect(page.getByText(/이미 등록된 전화번호/)).toBeVisible();

  await page.goto('/admin/settings/academics');
  page.on('dialog', (dialog) => dialog.accept());
  const gradeRow = page.locator('li', { hasText: gradeName });
  await gradeRow.getByRole('button', { name: '삭제' }).click();
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `npm run test:e2e`
Expected: PASS — includes all pre-existing e2e specs from prior stages plus this new one.

- [ ] **Step 3: Run the full unit/integration suite, check, and build**

Run:
```bash
npx vitest run
npm run check
npm run build
```
Expected: all clean.

- [ ] **Step 4: Manual verification and cleanup**

Run `npm run dev`, log in with `.env`'s credentials, visit `/admin/students`, add a student, click into its detail page, change its status, link a guardian by searching for one (create one first via `/admin/guardians` if none exist), unlink it, then click "학생 삭제" and confirm the browser confirmation dialog — verify it navigates back to `/admin/students` and the student no longer appears in the list. `POST /api/students/:id/restore` has no client UI button in this plan's scope (undoing an accidental delete is a rare admin action; a "삭제된 학생 보기" list view is left for a future stage if needed) — verify it directly instead: `curl -X POST http://localhost:8787/api/students/<id>/restore -H "Cookie: <session-cookie-from-browser-devtools>"` and confirm the student reappears in `GET /api/students`. Stop the dev server afterward and verify via `netstat -ano | grep -E ":5173|:8787"` and a process listing that nothing is left running — show the actual re-check output in your report, not just a claim.

- [ ] **Step 5: Commit and push**

```bash
git add tests/e2e/students.spec.ts
git commit -m "test: add end-to-end coverage for student create, guardian search, and duplicate-phone warning"
git push
git status
```
Expected: `git status` reports a clean working tree, up to date with `origin/main`.
