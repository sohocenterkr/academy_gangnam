# Stage 7: Instructors, Courses & Enrollments (강사·강좌·수강) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `강좌` and `기간별 수강등록` links of the core workflow (`학생·보호자 → 강좌 → 기간별 수강등록 → 등원 기록 → 문자 안내 → 카드뉴스 홍보`) — instructor management, course CRUD with weekly schedules and one-off cancellation/makeup exceptions, and period-based student enrollment that preserves full history (course changes create new enrollment rows rather than overwriting old ones; ended/canceled enrollments stay queryable forever).

**Architecture:** Five new tables — `instructors`, `courses`, `course_schedules`, `course_exceptions`, `enrollments` — following every convention already established in this codebase: explicit `new Date()` timestamps, `createdBy`/`updatedBy` audit columns, the Stage 5.5 atomic optimistic-locking pattern (`expectedUpdatedAt` + the shared `sendVersionConflict` helper) on every PATCH, the shared `isUniqueViolation` helper from `server/utils/httpErrors.ts`, and soft-delete-via-`deletedAt`/`status` rather than physical deletion wherever history can accumulate. **No course-level attendance/lateness/absence tracking is built** — spec §13.2 explicitly rules this out ("강좌별 출석, 지각, 조퇴, 결석 판정은 만들지 않습니다"); `course_schedules`/`course_exceptions` exist purely as reference data ("일정은 강좌정보와 미등원 참고 등에만 사용합니다"), not as a check-in-per-schedule mechanism — that would contradict Stage 6's design, which already keys check-in duplication off `(student, KST date)` with no course dimension at all. Period overlap on enrollment is **checked and warned, not blocked** (spec §9.5: "기간 중복은 서비스에서 검사하고 경고합니다") — `POST /api/enrollments` returns the conflicting enrollment(s) and requires an explicit `confirmOverlap: true` to proceed, mirroring the guardian-duplicate-phone warn-then-confirm UX already shipped in Stage 4.

**Tech Stack:** Same as every prior stage — Drizzle ORM, Express 5, Zod, React 19/Vite, wouter, Vitest, Playwright.

**Spec:** [`../../../academy_automation_final_development_prompt.md`](../../../academy_automation_final_development_prompt.md) — implements §9.5 (`instructors`/`courses`/`course_schedules`/`course_exceptions`/`enrollments`), §13.2 (course/enrollment history rules), §12.4 (the full instructor/course/enrollment API list), §6.4 (`/admin/instructors`, `/admin/courses*`, `/admin/enrollments*` routes), §8.4 (component list: `InstructorList`, `InstructorFormSheet`, `CourseListFilters`, `CourseForm`, `CourseScheduleEditor`, `CourseExceptionSheet`, `CourseDetailTabs`, `EnrollmentForm`, `EnrollmentStatusSheet`). `GET /api/students/:id/enrollments` (spec line 1338, listed under the students API section but implemented here since it's this stage's own data) is also built. Deliberately deferred: `GET /api/reports/courses` (reporting stage), any per-schedule/per-session attendance concept (explicitly out of scope per spec and per this project's CLAUDE.md).

**Prior plans:** [`2026-08-15-stage4-guardians.md`](2026-08-15-stage4-guardians.md), [`2026-08-15-stage5-students.md`](2026-08-15-stage5-students.md), [`2026-08-16-stage5.5-optimistic-locking.md`](2026-08-16-stage5.5-optimistic-locking.md) (source of the atomic-locking pattern and `sendVersionConflict`), [`2026-08-16-stage6-checkin.md`](2026-08-16-stage6-checkin.md) (source of the shared `isUniqueViolation` helper now in `server/utils/httpErrors.ts`, and the most recent precedent for this plan's task-review rigor).

## Global Constraints

- KST is irrelevant to this stage's own business logic beyond the existing `date` columns (`start_date`/`end_date`/`event_date` etc. are plain calendar dates, not timestamps — no timezone conversion needed for them). Any `timestamp with time zone` column (`createdAt`/`updatedAt`) still follows the explicit-`new Date()`-at-insert rule.
- API envelope: `{ data, meta: { requestId, kstTimestamp } }` / `{ error: { code, message, fieldErrors?, requestId } }`. New error codes: `409 PERIOD_OVERLAP` (enrollment date range overlaps an existing one for the same student+course, `confirmOverlap` not set), `404 NOT_FOUND`, `409 VERSION_CONFLICT` (reused from Stage 5.5).
- Every PATCH route uses the SAME atomic, DB-level optimistic-locking pattern from Stage 5.5: `expectedUpdatedAt: z.iso.datetime()`, `.where(and(eq(table.id, id), eq(table.updatedAt, new Date(expectedUpdatedAt))))`, `sendVersionConflict(res, req.requestId)` on a zero-row result. No new SELECT-then-compare version check anywhere in this plan.
- Every unique-constraint-violation catch reuses `isUniqueViolation` from `server/utils/httpErrors.ts` — do not write a 5th local copy of that helper (Stage 6's final review flagged 4 pre-existing local copies as a defect worth eliminating; this stage adds new route files and must import the shared one from day one, not perpetuate the duplication).
- Every table's `createdAt`/`updatedAt` is set explicitly via `new Date()` at INSERT time.
- `courses.code` is unique only among non-deleted rows (`uniqueIndex(...).where(sql\`${table.deletedAt} IS NULL\`)`), matching the `schools`/`gradeLevels` active-uniqueness convention already established — a genuinely mistaken course entry can be soft-deleted and its code reused.
- History preservation: `courses` and `instructors` are never physically deleted (courses soft-delete via `deletedAt`, instructors deactivate via `status: 'inactive'` — spec's own API list has no instructor-delete endpoint, only `PATCH .../instructors/:id` for "수정·비활성화"). `enrollments` are never physically deleted or overwritten to represent a course change — ending/canceling one and creating a new one is how a course change is recorded (spec: "강좌 변경은 기존 이력을 덮어쓰지 않고 새 레코드를 만듭니다"). `course_schedules`/`course_exceptions` may be hard-deleted per the spec's own API list (`DELETE /api/course-schedules/:id`, `DELETE /api/course-exceptions/:id`) since they're reference/display data with no history-preservation requirement stated.
- Every admin-facing route in this stage requires `requireAuth` + `requirePermission(PERMISSIONS.COURSES_MANAGE)` — a single new permission covers instructors/courses/schedules/exceptions/enrollments, matching how `STUDENTS_MANAGE` already covers both `students` and `studentGuardians` in this codebase (no separate `INSTRUCTORS_MANAGE`/`ENROLLMENTS_MANAGE` — spec's own permission table (§4, line 123) lists "학생·보호자·강좌·수강·등원" as one bundle for 일반 관리자, not split further).
- Instructor/course names and phone numbers are NOT masked in list/detail responses — the Stage 4/5 masking convention (`maskName`, `maskPhone`) exists specifically for the PII-sensitive minor-student/guardian domain (spec §10.5); instructors are staff, and courses have no PII at all. Do not apply `maskName`/`maskPhone` anywhere in this stage.
- No client-side-only validation without server-side re-enforcement.
- No separate test DB — every server integration test hits the real local dev `DATABASE_URL`; FK-safe cleanup order required; every `createApp()` test call needs `emailAdapter: createFakeEmailAdapter()`.
- `npm run check` must be clean after every task.

---

## File Structure

```
migrations/                                # new migration

shared/
  schema.ts                                # modified: add instructors, courses, courseSchedules, courseExceptions, enrollments
  permissions.ts                           # modified: add PERMISSIONS.COURSES_MANAGE

server/
  routes/
    instructors.ts / .test.ts              # GET /, POST /, PATCH /:id
    courses.ts / .test.ts                  # GET /, POST /, GET /:id, PATCH /:id, POST /:id/copy, POST /:id/status
    courseSchedules.ts / .test.ts          # POST /courses/:id/schedules, PATCH /course-schedules/:id, DELETE /course-schedules/:id
    courseExceptions.ts / .test.ts         # POST /courses/:id/exceptions, PATCH /course-exceptions/:id, DELETE /course-exceptions/:id
    enrollments.ts / .test.ts              # GET /, POST /, PATCH /:id, POST /:id/end, POST /:id/cancel
    students.ts / .test.ts                 # modified: add GET /:id/enrollments
  app.ts                                   # modified: mount all new routers

client/
  src/
    features/
      instructors/
        InstructorListPage.tsx / .test.tsx # /admin/instructors
      courses/
        CourseListPage.tsx / .test.tsx     # /admin/courses
        CourseFormPage.tsx / .test.tsx     # /admin/courses/new
        CourseDetailPage.tsx / .test.tsx   # /admin/courses/:courseId (tabs: info, schedule, exceptions, enrollments)
      dashboard/
        AdminHomePage.tsx                  # modified: add "강좌 관리" nav link
    routes.tsx                             # modified: add /admin/instructors, /admin/courses, /admin/courses/new, /admin/courses/:courseId

tests/
  e2e/
    courses-enrollments.spec.ts
```

---

## Task 1: Schema, permission, migration

**Files:**
- Modify: `shared/schema.ts`, `shared/permissions.ts`

**Interfaces:**
- Consumes: `admins`, `students` (existing tables), `sql` from `drizzle-orm`, `boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid` from `drizzle-orm/pg-core` (all already imported in `shared/schema.ts`).
- Produces: `instructors`, `courses`, `courseSchedules`, `courseExceptions`, `enrollments` Drizzle tables. `PERMISSIONS.COURSES_MANAGE`.

- [ ] **Step 1: Append the five tables to `shared/schema.ts`**

```ts
export const instructors = pgTable('instructors', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  phoneNormalized: text('phone_normalized').notNull(),
  subjects: jsonb('subjects').$type<string[]>().notNull().default([]),
  adminId: uuid('admin_id').references(() => admins.id),
  status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  createdBy: uuid('created_by').references(() => admins.id),
  updatedBy: uuid('updated_by').references(() => admins.id),
});

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    category: text('category'),
    targetGradeIds: jsonb('target_grade_ids').$type<string[]>().notNull().default([]),
    instructorId: uuid('instructor_id').references(() => instructors.id),
    classroom: text('classroom'),
    capacity: integer('capacity'),
    baseFee: integer('base_fee'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    status: text('status', { enum: ['recruiting', 'closed', 'ended', 'inactive'] })
      .notNull()
      .default('recruiting'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by').references(() => admins.id),
    updatedBy: uuid('updated_by').references(() => admins.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('courses_code_unique')
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
  ]
);

export const courseSchedules = pgTable('course_schedules', {
  id: uuid('id').defaultRandom().primaryKey(),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id),
  dayOfWeek: integer('day_of_week').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  classroom: text('classroom'),
  instructorId: uuid('instructor_id').references(() => instructors.id),
  repeatStartDate: date('repeat_start_date'),
  repeatEndDate: date('repeat_end_date'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  createdBy: uuid('created_by').references(() => admins.id),
  updatedBy: uuid('updated_by').references(() => admins.id),
});

export const courseExceptions = pgTable('course_exceptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id),
  scheduleId: uuid('schedule_id').references(() => courseSchedules.id),
  exceptionType: text('exception_type', { enum: ['cancellation', 'makeup'] }).notNull(),
  eventDate: date('event_date').notNull(),
  startTime: text('start_time'),
  endTime: text('end_time'),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  createdBy: uuid('created_by').references(() => admins.id),
  updatedBy: uuid('updated_by').references(() => admins.id),
});

export const enrollments = pgTable(
  'enrollments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id),
    startDate: date('start_date').notNull(),
    plannedEndDate: date('planned_end_date'),
    actualEndDate: date('actual_end_date'),
    status: text('status', { enum: ['waiting', 'active', 'paused', 'ended', 'canceled'] })
      .notNull()
      .default('active'),
    tuitionAmount: integer('tuition_amount'),
    adjustmentNote: text('adjustment_note'),
    memo: text('memo'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by').references(() => admins.id),
    updatedBy: uuid('updated_by').references(() => admins.id),
  },
  (table) => [
    index('enrollments_student_status_start_idx').on(table.studentId, table.status, table.startDate),
    index('enrollments_course_status_start_idx').on(table.courseId, table.status, table.startDate),
  ]
);
```

- [ ] **Step 2: Add the permission constant to `shared/permissions.ts`**

```ts
export const PERMISSIONS = {
  ADMINS_MANAGE: 'admins:manage',
  ROLES_MANAGE: 'roles:manage',
  ACADEMY_MANAGE: 'academy:manage',
  GUARDIANS_MANAGE: 'guardians:manage',
  STUDENTS_MANAGE: 'students:manage',
  CHECKINS_MANAGE: 'checkins:manage',
  COURSES_MANAGE: 'courses:manage',
} as const;
```

- [ ] **Step 3: Generate and apply the migration**

Run:
```bash
npm run db:generate
npm run db:migrate
```
Expected: clean apply, no errors.

- [ ] **Step 4: Run check**

Run: `npm run check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add shared/schema.ts shared/permissions.ts migrations
git commit -m "feat: add instructors/courses/course_schedules/course_exceptions/enrollments schema and COURSES_MANAGE permission"
```

---

## Task 2: Instructors API

**Files:**
- Create: `server/routes/instructors.ts`, `server/routes/instructors.test.ts`
- Modify: `server/app.ts`

**Interfaces:**
- Consumes: `instructors` table (Task 1); `isUniqueViolation`, `sendVersionConflict` from `server/utils/httpErrors.ts`; `PERMISSIONS.COURSES_MANAGE`; `writeAuditLog`.
- Produces: `createInstructorsRouter(deps: { sessionSecret: string }): Router`, mounted at `/api/instructors`, with `GET /` (list), `POST /` (create), `PATCH /:id` (update/deactivate, atomic locking). No `GET /:id` or `DELETE` — matches the spec's own API list exactly (only 3 endpoints for instructors).

- [ ] **Step 1: Write the failing test `server/routes/instructors.test.ts`**

```ts
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, instructors } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-instructors-super@example.com';
const PASSWORD = 'test-instructors-password-123';
const TEST_INSTRUCTOR_NAME = 'test-instructors-강사';

async function seedAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-instructors-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
    .returning();
  await db.insert(admins).values({
    email: SUPER_EMAIL,
    name: '수퍼',
    passwordHash: await hashPassword(PASSWORD),
    roleId: role!.id,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function loginAs(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('login did not return a session cookie');
  return cookie;
}

async function cleanup() {
  await db.delete(instructors).where(eq(instructors.name, TEST_INSTRUCTOR_NAME));
  const adminToDelete = await db.query.admins.findFirst({ where: eq(admins.email, SUPER_EMAIL) });
  if (adminToDelete) {
    const { auditLogs, authSessions, passwordResetTokens } = await import('@shared/schema');
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-instructors-role'));
}

describe('instructors routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/instructors');
    expect(response.status).toBe(401);
  });

  it('creates, lists, and updates an instructor with atomic locking', async () => {
    await seedAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/instructors')
      .set('Cookie', cookie)
      .send({ name: TEST_INSTRUCTOR_NAME, phoneNormalized: '01099998888', subjects: ['수학'] });
    expect(created.status).toBe(200);
    expect(created.body.data.status).toBe('active');

    const list = await request(app).get('/api/instructors').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.data.some((row: { id: string }) => row.id === created.body.data.id)).toBe(true);

    const updated = await request(app)
      .patch(`/api/instructors/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ status: 'inactive', expectedUpdatedAt: created.body.data.updatedAt });
    expect(updated.status).toBe(200);
    expect(updated.body.data.status).toBe('inactive');

    const staleUpdate = await request(app)
      .patch(`/api/instructors/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ status: 'active', expectedUpdatedAt: created.body.data.updatedAt });
    expect(staleUpdate.status).toBe(409);
    expect(staleUpdate.body.error.code).toBe('VERSION_CONFLICT');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/routes/instructors.test.ts`
Expected: FAIL — 404s.

- [ ] **Step 3: Write `server/routes/instructors.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { instructors } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';
import { sendVersionConflict } from '../utils/httpErrors';

const createInstructorSchema = z.object({
  name: z.string().min(1),
  phoneNormalized: z.string().regex(/^\d{9,11}$/),
  subjects: z.array(z.string()).default([]),
  adminId: z.string().optional(),
  notes: z.string().optional(),
});

const updateInstructorSchema = z.object({
  name: z.string().min(1).optional(),
  phoneNormalized: z.string().regex(/^\d{9,11}$/).optional(),
  subjects: z.array(z.string()).optional(),
  adminId: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  notes: z.string().optional(),
  expectedUpdatedAt: z.iso.datetime(),
});

export interface InstructorsRouterDeps {
  sessionSecret: string;
}

export function createInstructorsRouter(deps: InstructorsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireCoursesManage = createRequirePermission(PERMISSIONS.COURSES_MANAGE);

  router.get('/', requireAuth, requireCoursesManage, async (req, res) => {
    const rows = await db.select().from(instructors);
    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/', requireAuth, requireCoursesManage, async (req, res) => {
    const parsed = parseBody(createInstructorSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const now = new Date();
    const [created] = await db
      .insert(instructors)
      .values({ ...parsed, status: 'active', createdAt: now, updatedAt: now, createdBy: req.admin!.id, updatedBy: req.admin!.id })
      .returning();
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '강사를 등록하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'instructor.create',
      targetType: 'instructor',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { name: created.name, phoneNormalized: created.phoneNormalized },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/:id', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateInstructorSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(instructors).where(eq(instructors.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '강사를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const { expectedUpdatedAt, ...changes } = parsed;
    const [updated] = await db
      .update(instructors)
      .set({ ...changes, updatedBy: req.admin!.id, updatedAt: new Date() })
      .where(and(eq(instructors.id, id), eq(instructors.updatedAt, new Date(expectedUpdatedAt))))
      .returning();
    if (!updated) {
      sendVersionConflict(res, req.requestId);
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'instructor.update',
      targetType: 'instructor',
      targetId: updated.id,
      beforeDataSafe: { name: before.name, status: before.status },
      afterDataSafe: { name: updated.name, status: updated.status },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
```

- [ ] **Step 4: Mount the router in `server/app.ts`**

```ts
import { createInstructorsRouter } from './routes/instructors';
// ...
app.use('/api/instructors', createInstructorsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
```

- [ ] **Step 5: Run to verify it passes, then run check**

Run: `npx vitest run server/routes/instructors.test.ts && npm run check`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add server/routes/instructors.ts server/routes/instructors.test.ts server/app.ts
git commit -m "feat: add instructors API"
```

---

## Task 3: Courses API

**Files:**
- Create: `server/routes/courses.ts`, `server/routes/courses.test.ts`
- Modify: `server/app.ts`

**Interfaces:**
- Consumes: `courses`, `courseSchedules`, `enrollments`, `instructors` tables; `isUniqueViolation`, `sendVersionConflict` from `httpErrors.ts`.
- Produces: `createCoursesRouter(deps): Router`, mounted at `/api/courses`, with `GET /` (search/filter by name/status/instructorId — simple `ilike`/`eq` filters, no full-text search engine), `POST /` (create), `GET /:id` (detail — course row plus its `courseSchedules` and a count of active `enrollments`), `PATCH /:id` (update, atomic locking), `POST /:id/status` (status transition, e.g. recruiting→closed→ended/inactive), `POST /:id/copy` (duplicate course fields into a new row, excluding schedules/exceptions/enrollments — spec: "수강생 제외 복사").

- [ ] **Step 1: Write the failing test `server/routes/courses.test.ts`**

Follow the exact fixture/cleanup/login pattern from `server/routes/instructors.test.ts` (Task 2) and `server/routes/checkIns.test.ts` (Stage 6) — read both first. Cover:
1. Unauthenticated → 401.
2. Create → 200, `code`/`status: 'recruiting'` set correctly.
3. Duplicate `code` on a second create → `409` (via `isUniqueViolation` on `courses_code_unique`) — assert the error code is a sensible one (e.g. `VALIDATION_ERROR` with a field error on `code`, matching how `schools.ts`/`gradeLevels.ts` already handle their own active-unique-name violations — read one of those files to match the exact response shape).
4. List with a `status` filter → only matching rows.
5. `GET /:id` → returns the course plus an empty `schedules` array and `activeEnrollmentCount: 0` for a fresh course.
6. `PATCH /:id` → atomic locking, stale update → `409 VERSION_CONFLICT` (same shape as Task 2's instructor test).
7. `POST /:id/status` → transitions `recruiting` → `closed`, asserts `status` updated and old value logged via `writeAuditLog`.
8. `POST /:id/copy` → creates a NEW course row with the same `name`/`category`/`instructorId`/etc. but a caller-supplied new `code`, and asserts it does NOT copy any `courseSchedules`/`enrollments` (there are none to copy in this test, but assert the new course's `id` differs from the source and its own schedule/enrollment lookups return empty).
9. Soft-deleted course (`deletedAt` set directly via `db.update` in the test) does not appear in `GET /` list results.

Clean up `courses` rows (and any `courseSchedules`/`enrollments` your test creates) in FK-safe order.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/routes/courses.test.ts`
Expected: FAIL — 404s.

- [ ] **Step 3: Write `server/routes/courses.ts`**

```ts
import { and, count, eq, isNull, like } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { courses, courseSchedules, enrollments } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';
import { sendVersionConflict, isUniqueViolation } from '../utils/httpErrors';

const createCourseSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.string().optional(),
  targetGradeIds: z.array(z.string()).default([]),
  instructorId: z.string().optional(),
  classroom: z.string().optional(),
  capacity: z.number().int().positive().optional(),
  baseFee: z.number().int().nonnegative().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  description: z.string().optional(),
});

const updateCourseSchema = createCourseSchema.partial().extend({
  expectedUpdatedAt: z.iso.datetime(),
});

const statusChangeSchema = z.object({
  status: z.enum(['recruiting', 'closed', 'ended', 'inactive']),
  expectedUpdatedAt: z.iso.datetime(),
});

const copyCourseSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1).optional(),
});

const listQuerySchema = z.object({
  status: z.enum(['recruiting', 'closed', 'ended', 'inactive']).optional(),
  instructorId: z.string().optional(),
  name: z.string().optional(),
});

function courseValidationError(requestId: string) {
  return {
    error: {
      code: 'VALIDATION_ERROR',
      message: '입력값을 확인해 주세요.',
      fieldErrors: { code: ['이미 사용 중인 강좌 코드입니다.'] },
      requestId,
    },
  };
}

export interface CoursesRouterDeps {
  sessionSecret: string;
}

export function createCoursesRouter(deps: CoursesRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireCoursesManage = createRequirePermission(PERMISSIONS.COURSES_MANAGE);

  router.get('/', requireAuth, requireCoursesManage, async (req, res) => {
    const parsedQuery = listQuerySchema.safeParse(req.query);
    const query = parsedQuery.success ? parsedQuery.data : {};

    const conditions = [isNull(courses.deletedAt)];
    if (query.status) conditions.push(eq(courses.status, query.status));
    if (query.instructorId) conditions.push(eq(courses.instructorId, query.instructorId));
    if (query.name) conditions.push(like(courses.name, `%${query.name}%`));

    const rows = await db.select().from(courses).where(and(...conditions));
    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/', requireAuth, requireCoursesManage, async (req, res) => {
    const parsed = parseBody(createCourseSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const now = new Date();
    let created;
    try {
      [created] = await db
        .insert(courses)
        .values({ ...parsed, status: 'recruiting', createdAt: now, updatedAt: now, createdBy: req.admin!.id, updatedBy: req.admin!.id })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, 'courses_code_unique')) {
        res.status(400).json(courseValidationError(req.requestId));
        return;
      }
      throw error;
    }
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '강좌를 등록하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'course.create',
      targetType: 'course',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { code: created.code, name: created.name },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.get('/:id', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [course] = await db.select().from(courses).where(eq(courses.id, id));
    if (!course || course.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '강좌를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const schedules = await db.select().from(courseSchedules).where(eq(courseSchedules.courseId, id));
    const [activeCountRow] = await db
      .select({ value: count() })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, id), eq(enrollments.status, 'active')));

    res.json({
      data: { ...course, schedules, activeEnrollmentCount: activeCountRow?.value ?? 0 },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.patch('/:id', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateCourseSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(courses).where(eq(courses.id, id));
    if (!before || before.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '강좌를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const { expectedUpdatedAt, ...changes } = parsed;
    let updated;
    try {
      [updated] = await db
        .update(courses)
        .set({ ...changes, updatedBy: req.admin!.id, updatedAt: new Date() })
        .where(and(eq(courses.id, id), eq(courses.updatedAt, new Date(expectedUpdatedAt))))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, 'courses_code_unique')) {
        res.status(400).json(courseValidationError(req.requestId));
        return;
      }
      throw error;
    }
    if (!updated) {
      sendVersionConflict(res, req.requestId);
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'course.update',
      targetType: 'course',
      targetId: updated.id,
      beforeDataSafe: { name: before.name, status: before.status },
      afterDataSafe: { name: updated.name, status: updated.status },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/status', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(statusChangeSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(courses).where(eq(courses.id, id));
    if (!before || before.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '강좌를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const [updated] = await db
      .update(courses)
      .set({ status: parsed.status, updatedBy: req.admin!.id, updatedAt: new Date() })
      .where(and(eq(courses.id, id), eq(courses.updatedAt, new Date(parsed.expectedUpdatedAt))))
      .returning();
    if (!updated) {
      sendVersionConflict(res, req.requestId);
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'course.statusChange',
      targetType: 'course',
      targetId: updated.id,
      beforeDataSafe: { status: before.status },
      afterDataSafe: { status: updated.status },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/copy', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(copyCourseSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [source] = await db.select().from(courses).where(eq(courses.id, id));
    if (!source || source.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '강좌를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const now = new Date();
    let created;
    try {
      [created] = await db
        .insert(courses)
        .values({
          code: parsed.code,
          name: parsed.name ?? source.name,
          category: source.category,
          targetGradeIds: source.targetGradeIds,
          instructorId: source.instructorId,
          classroom: source.classroom,
          capacity: source.capacity,
          baseFee: source.baseFee,
          startDate: source.startDate,
          endDate: source.endDate,
          status: 'recruiting',
          description: source.description,
          createdAt: now,
          updatedAt: now,
          createdBy: req.admin!.id,
          updatedBy: req.admin!.id,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, 'courses_code_unique')) {
        res.status(400).json(courseValidationError(req.requestId));
        return;
      }
      throw error;
    }
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '강좌를 복사하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'course.copy',
      targetType: 'course',
      targetId: created.id,
      beforeDataSafe: { sourceCourseId: source.id },
      afterDataSafe: { code: created.code, name: created.name },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
```

- [ ] **Step 4: Mount the router in `server/app.ts`**

```ts
import { createCoursesRouter } from './routes/courses';
// ...
app.use('/api/courses', createCoursesRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
```

- [ ] **Step 5: Run to verify it passes, then run check**

Run: `npx vitest run server/routes/courses.test.ts && npm run check`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add server/routes/courses.ts server/routes/courses.test.ts server/app.ts
git commit -m "feat: add courses API — list/filter, create, detail, update, status change, copy"
```

---

## Task 4: Course schedules + exceptions API

**Files:**
- Create: `server/routes/courseSchedules.ts`, `server/routes/courseSchedules.test.ts`, `server/routes/courseExceptions.ts`, `server/routes/courseExceptions.test.ts`
- Modify: `server/app.ts`

**Interfaces:**
- Consumes: `courseSchedules`, `courseExceptions`, `courses` tables.
- Produces: `createCourseSchedulesRouter(deps): Router` mounted at `/api` with `POST /courses/:id/schedules`, `PATCH /course-schedules/:id`, `DELETE /course-schedules/:id` (matching the spec's exact flat URL shapes — NOT nested under `/api/courses/:id/schedules/:id` for PATCH/DELETE). `createCourseExceptionsRouter(deps): Router` mounted at `/api` with the symmetric `POST /courses/:id/exceptions`, `PATCH /course-exceptions/:id`, `DELETE /course-exceptions/:id`.

- [ ] **Step 1: Write the failing tests**

`server/routes/courseSchedules.test.ts` and `server/routes/courseExceptions.test.ts`, following the exact fixture/cleanup pattern from Task 2/3's test files. Each covers: unauthenticated → 401; create under a real course → 200 with the course's `id` correctly set as `courseId`; create under a nonexistent course → 404; update (plain full-row update, no optimistic locking needed since `course_schedules`/`course_exceptions` are simple reference data the spec doesn't flag for concurrent-edit protection — confirm this reading is correct by checking the plan's Global Constraints don't mandate it for these two tables specifically) → 200; delete → 200, then a follow-up GET-via-course-detail (Task 3's `GET /courses/:id`) no longer lists it.

For `courseSchedules`, additionally validate `dayOfWeek` is `0`-`6` and `startTime`/`endTime` match `^\d{2}:\d{2}$` — write one test asserting a malformed time is rejected with `400`.

For `courseExceptions`, additionally validate `exceptionType` is `'cancellation' | 'makeup'` and `eventDate` is a plain date string.

- [ ] **Step 2: Run to verify both fail**

Run: `npx vitest run server/routes/courseSchedules.test.ts server/routes/courseExceptions.test.ts`
Expected: FAIL — 404s.

- [ ] **Step 3: Write `server/routes/courseSchedules.ts`**

```ts
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { courses, courseSchedules } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);

const createScheduleSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: timeSchema,
  endTime: timeSchema,
  classroom: z.string().optional(),
  instructorId: z.string().optional(),
  repeatStartDate: z.string().optional(),
  repeatEndDate: z.string().optional(),
});

const updateScheduleSchema = createScheduleSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export interface CourseSchedulesRouterDeps {
  sessionSecret: string;
}

export function createCourseSchedulesRouter(deps: CourseSchedulesRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireCoursesManage = createRequirePermission(PERMISSIONS.COURSES_MANAGE);

  router.post('/courses/:id/schedules', requireAuth, requireCoursesManage, async (req, res) => {
    const courseId = req.params.id;
    if (!courseId || Array.isArray(courseId)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(createScheduleSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
    if (!course || course.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '강좌를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const now = new Date();
    const [created] = await db
      .insert(courseSchedules)
      .values({ ...parsed, courseId, isActive: true, createdAt: now, updatedAt: now, createdBy: req.admin!.id, updatedBy: req.admin!.id })
      .returning();
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '일정을 추가하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'courseSchedule.create',
      targetType: 'courseSchedule',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { courseId, dayOfWeek: created.dayOfWeek },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/course-schedules/:id', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateScheduleSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(courseSchedules).where(eq(courseSchedules.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '일정을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const [updated] = await db
      .update(courseSchedules)
      .set({ ...parsed, updatedBy: req.admin!.id, updatedAt: new Date() })
      .where(eq(courseSchedules.id, id))
      .returning();
    if (!updated) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '일정을 수정하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'courseSchedule.update',
      targetType: 'courseSchedule',
      targetId: updated.id,
      beforeDataSafe: { dayOfWeek: before.dayOfWeek },
      afterDataSafe: { dayOfWeek: updated.dayOfWeek },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.delete('/course-schedules/:id', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [existing] = await db.select().from(courseSchedules).where(eq(courseSchedules.id, id));
    if (!existing) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '일정을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    await db.delete(courseSchedules).where(eq(courseSchedules.id, id));

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'courseSchedule.delete',
      targetType: 'courseSchedule',
      targetId: id,
      beforeDataSafe: { courseId: existing.courseId },
      afterDataSafe: null,
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: { success: true }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
```

- [ ] **Step 4: Write `server/routes/courseExceptions.ts`**

Mirror `courseSchedules.ts` exactly, with these differences: schema is `{ scheduleId: z.string().optional(), exceptionType: z.enum(['cancellation', 'makeup']), eventDate: z.string(), startTime: timeSchema.optional(), endTime: timeSchema.optional(), reason: z.string().optional() }` for create (all fields `.partial()` for update, no `isActive`); table is `courseExceptions`; routes are `POST /courses/:id/exceptions`, `PATCH /course-exceptions/:id`, `DELETE /course-exceptions/:id`; audit actions are `courseException.create`/`.update`/`.delete`; function/interface names are `createCourseExceptionsRouter`/`CourseExceptionsRouterDeps`.

- [ ] **Step 5: Mount both routers in `server/app.ts`**

```ts
import { createCourseSchedulesRouter } from './routes/courseSchedules';
import { createCourseExceptionsRouter } from './routes/courseExceptions';
// ...
app.use('/api', createCourseSchedulesRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
app.use('/api', createCourseExceptionsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
```

(Mounted at bare `/api` since these routers define their own full sub-paths like `/courses/:id/schedules` and `/course-schedules/:id`, matching the spec's flat URL shapes exactly — verify this doesn't collide with the `/api/courses` router already mounted at a more specific prefix; Express matches routers in registration order, so mount these two AFTER `/api/courses` in `app.ts` to avoid the more specific `/api/courses` router's own middleware intercepting `/api/courses/:id/schedules` first — check `server/app.ts`'s actual routing order and adjust if needed, since Express prefix-matches `/api/courses` against `/api/courses/:id/schedules` too.)

- [ ] **Step 6: Run to verify both pass, then run check**

Run: `npx vitest run server/routes/courseSchedules.test.ts server/routes/courseExceptions.test.ts && npm run check`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add server/routes/courseSchedules.ts server/routes/courseSchedules.test.ts server/routes/courseExceptions.ts server/routes/courseExceptions.test.ts server/app.ts
git commit -m "feat: add course schedules and exceptions API"
```

---

## Task 5: Enrollments API + student enrollment history

**Files:**
- Create: `server/routes/enrollments.ts`, `server/routes/enrollments.test.ts`
- Modify: `server/routes/students.ts`, `server/routes/students.test.ts`, `server/app.ts`

**Interfaces:**
- Consumes: `enrollments`, `students`, `courses` tables; `isUniqueViolation`, `sendVersionConflict` from `httpErrors.ts`.
- Produces: `createEnrollmentsRouter(deps): Router` mounted at `/api/enrollments`, with `GET /` (filter by `studentId`/`courseId`/`status`), `POST /` (create, with period-overlap warn-then-confirm), `PATCH /:id` (period/status/amount edit, atomic locking), `POST /:id/end`, `POST /:id/cancel`. Also adds `GET /api/students/:id/enrollments` to the EXISTING `server/routes/students.ts` router (read that file first — this is one new route handler added to an already-existing router, not a new router file).

- [ ] **Step 1: Write the failing test `server/routes/enrollments.test.ts`**

Follow the fixture/cleanup pattern from prior tasks' test files (needs a seeded admin, a grade level, a student, and a course — read `courses.test.ts` and `students.test.ts` for the exact seed shapes). Cover:
1. Unauthenticated → 401.
2. Create → 200, `status: 'active'` default.
3. Create a SECOND enrollment for the same student+course with an overlapping date range, no `confirmOverlap` → `409 PERIOD_OVERLAP`, response includes the conflicting enrollment's id.
4. Retry the same create WITH `confirmOverlap: true` → 200, both enrollments now exist.
5. `PATCH /:id` (edit `tuitionAmount`) with atomic locking → 200; stale retry → `409 VERSION_CONFLICT`.
6. `POST /:id/end` → sets `status: 'ended'`, `actualEndDate` to today.
7. `POST /:id/cancel` → sets `status: 'canceled'`.
8. `GET /?studentId=X` → filters correctly.
9. `GET /api/students/:id/enrollments` (added to `students.ts` in this task) → returns the student's enrollments including ended/canceled ones (history never disappears).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/routes/enrollments.test.ts`
Expected: FAIL — 404s (and the new `students.ts` route not yet added).

- [ ] **Step 3: Write `server/routes/enrollments.ts`**

```ts
import { and, eq, gte, isNull, lte, ne, or } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getTodayKST, getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { enrollments, students, courses } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';
import { sendVersionConflict } from '../utils/httpErrors';

const createEnrollmentSchema = z.object({
  studentId: z.string().min(1),
  courseId: z.string().min(1),
  startDate: z.string(),
  plannedEndDate: z.string().optional(),
  tuitionAmount: z.number().int().nonnegative().optional(),
  memo: z.string().optional(),
  confirmOverlap: z.boolean().optional(),
});

const updateEnrollmentSchema = z.object({
  startDate: z.string().optional(),
  plannedEndDate: z.string().optional(),
  status: z.enum(['waiting', 'active', 'paused', 'ended', 'canceled']).optional(),
  tuitionAmount: z.number().int().nonnegative().optional(),
  adjustmentNote: z.string().optional(),
  memo: z.string().optional(),
  expectedUpdatedAt: z.iso.datetime(),
});

const endEnrollmentSchema = z.object({ reason: z.string().optional() });
const cancelEnrollmentSchema = z.object({ reason: z.string().optional() });

const listQuerySchema = z.object({
  studentId: z.string().optional(),
  courseId: z.string().optional(),
  status: z.enum(['waiting', 'active', 'paused', 'ended', 'canceled']).optional(),
});

const OPEN_STATUSES = ['waiting', 'active', 'paused'] as const;

async function findOverlap(studentId: string, courseId: string, startDate: string, plannedEndDate: string | undefined, excludeId?: string) {
  const conditions = [
    eq(enrollments.studentId, studentId),
    eq(enrollments.courseId, courseId),
    or(...OPEN_STATUSES.map((s) => eq(enrollments.status, s)))!,
    plannedEndDate ? lte(enrollments.startDate, plannedEndDate) : undefined,
    or(isNull(enrollments.plannedEndDate), gte(enrollments.plannedEndDate, startDate))!,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  if (excludeId) conditions.push(ne(enrollments.id, excludeId));

  return db.select().from(enrollments).where(and(...conditions));
}

export interface EnrollmentsRouterDeps {
  sessionSecret: string;
}

export function createEnrollmentsRouter(deps: EnrollmentsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireCoursesManage = createRequirePermission(PERMISSIONS.COURSES_MANAGE);

  router.get('/', requireAuth, requireCoursesManage, async (req, res) => {
    const parsedQuery = listQuerySchema.safeParse(req.query);
    const query = parsedQuery.success ? parsedQuery.data : {};

    const conditions = [];
    if (query.studentId) conditions.push(eq(enrollments.studentId, query.studentId));
    if (query.courseId) conditions.push(eq(enrollments.courseId, query.courseId));
    if (query.status) conditions.push(eq(enrollments.status, query.status));

    const rows = await db
      .select()
      .from(enrollments)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/', requireAuth, requireCoursesManage, async (req, res) => {
    const parsed = parseBody(createEnrollmentSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [student] = await db.select().from(students).where(eq(students.id, parsed.studentId));
    if (!student || student.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '학생을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    const [course] = await db.select().from(courses).where(eq(courses.id, parsed.courseId));
    if (!course || course.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '강좌를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    if (!parsed.confirmOverlap) {
      const overlaps = await findOverlap(parsed.studentId, parsed.courseId, parsed.startDate, parsed.plannedEndDate);
      if (overlaps.length > 0) {
        res.status(409).json({
          error: {
            code: 'PERIOD_OVERLAP',
            message: '기존 수강 기간과 겹칩니다. 계속하려면 확인이 필요합니다.',
            requestId: req.requestId,
          },
          data: { conflicts: overlaps.map((o) => ({ id: o.id, startDate: o.startDate, plannedEndDate: o.plannedEndDate })) },
        });
        return;
      }
    }

    const now = new Date();
    const [created] = await db
      .insert(enrollments)
      .values({
        studentId: parsed.studentId,
        courseId: parsed.courseId,
        startDate: parsed.startDate,
        plannedEndDate: parsed.plannedEndDate,
        tuitionAmount: parsed.tuitionAmount,
        memo: parsed.memo,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        createdBy: req.admin!.id,
        updatedBy: req.admin!.id,
      })
      .returning();
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '수강등록에 실패했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'enrollment.create',
      targetType: 'enrollment',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { studentId: created.studentId, courseId: created.courseId },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/:id', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateEnrollmentSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(enrollments).where(eq(enrollments.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '수강 기록을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const { expectedUpdatedAt, ...changes } = parsed;
    const [updated] = await db
      .update(enrollments)
      .set({ ...changes, updatedBy: req.admin!.id, updatedAt: new Date() })
      .where(and(eq(enrollments.id, id), eq(enrollments.updatedAt, new Date(expectedUpdatedAt))))
      .returning();
    if (!updated) {
      sendVersionConflict(res, req.requestId);
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'enrollment.update',
      targetType: 'enrollment',
      targetId: updated.id,
      beforeDataSafe: { status: before.status, tuitionAmount: before.tuitionAmount },
      afterDataSafe: { status: updated.status, tuitionAmount: updated.tuitionAmount },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/end', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const parsed = parseBody(endEnrollmentSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(enrollments).where(eq(enrollments.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '수강 기록을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const [updated] = await db
      .update(enrollments)
      .set({ status: 'ended', actualEndDate: getTodayKST(), adjustmentNote: parsed.reason, updatedBy: req.admin!.id, updatedAt: new Date() })
      .where(eq(enrollments.id, id))
      .returning();
    if (!updated) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '종료 처리에 실패했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'enrollment.end',
      targetType: 'enrollment',
      targetId: updated.id,
      beforeDataSafe: { status: before.status },
      afterDataSafe: { status: 'ended' },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/cancel', requireAuth, requireCoursesManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }
    const parsed = parseBody(cancelEnrollmentSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(enrollments).where(eq(enrollments.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '수강 기록을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const [updated] = await db
      .update(enrollments)
      .set({ status: 'canceled', adjustmentNote: parsed.reason, updatedBy: req.admin!.id, updatedAt: new Date() })
      .where(eq(enrollments.id, id))
      .returning();
    if (!updated) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '취소 처리에 실패했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'enrollment.cancel',
      targetType: 'enrollment',
      targetId: updated.id,
      beforeDataSafe: { status: before.status },
      afterDataSafe: { status: 'canceled' },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
```

Note on `findOverlap`: this is a best-effort overlap check, not a hard DB constraint (the spec explicitly says overlap is a service-side check-and-warn, not a blocking constraint) — a small race window between two concurrent enrollment creates for the same student+course is accepted (worst case: two admins both confirm past a warning at the same instant and create two overlapping enrollments, which is exactly what "warn, don't block" means — the DB has no unique constraint to prevent it, unlike Stage 6's check-in duplication which spec explicitly required to be unconditionally blocked).

- [ ] **Step 4: Add `GET /:id/enrollments` to `server/routes/students.ts`**

Read the current file first. Add a new route (anywhere among the other `GET /:id/...` sub-resource routes, matching the file's existing route-ordering convention):

```ts
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
```

(Add `import { enrollments } from '@shared/schema';` to the existing import if `enrollments` isn't already imported there — check first, since `students.ts` already imports several tables.) This route intentionally uses `requireStudentsManage` (the STUDENTS_MANAGE permission, not COURSES_MANAGE) since it's mounted under `/api/students` and is conceptually "view this student's data" — but it depends on `enrollments`, a COURSES_MANAGE-owned table. This is consistent with spec §4's permission bundling ("학생·보호자·강좌·수강·등원" as one group for 일반 관리자) — a role with `STUDENTS_MANAGE` but not `COURSES_MANAGE` is not a real scenario this spec anticipates as needing separate enforcement here; don't add a second permission check.

- [ ] **Step 5: Mount the enrollments router in `server/app.ts`**

```ts
import { createEnrollmentsRouter } from './routes/enrollments';
// ...
app.use('/api/enrollments', createEnrollmentsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
```

- [ ] **Step 6: Run to verify it passes, then run check**

Run: `npx vitest run server/routes/enrollments.test.ts server/routes/students.test.ts && npm run check`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add server/routes/enrollments.ts server/routes/enrollments.test.ts server/routes/students.ts server/routes/students.test.ts server/app.ts
git commit -m "feat: add enrollments API with period-overlap warning, and student enrollment history endpoint"
```

---

## Task 6: Client — instructor list/form page

**Files:**
- Create: `client/src/features/instructors/InstructorListPage.tsx`, `client/src/features/instructors/InstructorListPage.test.tsx`
- Modify: `client/src/routes.tsx`, `client/src/features/dashboard/AdminHomePage.tsx`, `client/src/features/dashboard/AdminHomePage.test.tsx`

**Interfaces:**
- Consumes: `apiGet`, `apiPost`, `apiPatch`, `ApiRequestError` from `client/src/lib/apiClient.ts`.
- Produces: a single combined list+create page at `/admin/instructors` (matching this project's established "list page with an inline create form" pattern from `GuardianListPage.tsx`/`StudentListPage.tsx` — read one of those first to match its exact layout/state-management style rather than inventing a new one).

- [ ] **Step 1: Write the failing test `client/src/features/instructors/InstructorListPage.test.tsx`**

Mirror `AdminCheckInsPage.test.tsx`'s (Stage 6) fetch-mocking style. Cover: loads and renders the instructor list; submits the create form (name/phone/subjects) and re-loads the list; toggles an instructor's status via a button that calls `PATCH /api/instructors/:id` with `expectedUpdatedAt`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/src/features/instructors/InstructorListPage.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `client/src/features/instructors/InstructorListPage.tsx`**

Build following the exact structure of `GuardianListPage.tsx` (read it first): a list rendered from `apiGet<Instructor[]>('/api/instructors')` on mount, a create form (`name`, `phoneNormalized`, a comma-separated `subjects` text input split into an array on submit) posting to `/api/instructors`, and a status-toggle button per row calling `apiPatch(`/api/instructors/${id}`, { status: row.status === 'active' ? 'inactive' : 'active', expectedUpdatedAt: row.updatedAt })` followed by a reload. Use the same `ApiRequestError` error-display pattern as every other list page in this codebase.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/src/features/instructors/InstructorListPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the route and nav link**

`client/src/routes.tsx` — add, inside the `ProtectedRoute`-wrapped admin section, matching the existing pattern exactly:
```tsx
      <Route path="/admin/instructors">
        <ProtectedRoute>
          <InstructorListPage />
        </ProtectedRoute>
      </Route>
```

`client/src/features/dashboard/AdminHomePage.tsx` — add a nav link (`href="/admin/instructors"`, label "강사 관리"), matching the existing `<li>` pattern, and update `AdminHomePage.test.tsx` to assert it.

- [ ] **Step 6: Run check and the full client test suite**

Run: `npm run check && npx vitest run`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add client/src/features/instructors/InstructorListPage.tsx client/src/features/instructors/InstructorListPage.test.tsx client/src/routes.tsx client/src/features/dashboard/AdminHomePage.tsx client/src/features/dashboard/AdminHomePage.test.tsx
git commit -m "feat: add instructor list/create/status-toggle client page"
```

---

## Task 7: Client — course list/create page

**Files:**
- Create: `client/src/features/courses/CourseListPage.tsx`, `client/src/features/courses/CourseListPage.test.tsx`
- Modify: `client/src/routes.tsx`, `client/src/features/dashboard/AdminHomePage.tsx`, `client/src/features/dashboard/AdminHomePage.test.tsx`

**Interfaces:**
- Consumes: `apiGet`, `apiPost` from `apiClient.ts`.
- Produces: `/admin/courses` — a filterable list (by `status`) plus an inline create form (matching the same list+create pattern as Task 6 and every prior list page in this codebase), with each row linking to `/admin/courses/:courseId` (Task 8's detail page — the `<Link>` can be added even before Task 8 exists, since wouter routes resolve independently and this task's own tests don't need the destination page to exist yet).

- [ ] **Step 1: Write the failing test `client/src/features/courses/CourseListPage.test.tsx`**

Cover: loads and renders the course list with a status filter dropdown that re-fetches with `?status=...`; submits the create form (code/name/category/instructorId as a plain text input for now — no instructor-picker dropdown in this task, matching this stage's YAGNI-scoped client work) and re-loads the list.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/src/features/courses/CourseListPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write `client/src/features/courses/CourseListPage.tsx`**

Same structural pattern as Task 6's `InstructorListPage.tsx` — list + inline create form + (new) a `<select>` status filter that triggers a re-`apiGet` with a query string. Each list row is a `<Link href={`/admin/courses/${row.id}`}>{row.name}</Link>` (wouter's `Link`, matching how `StudentListPage.tsx`/`GuardianListPage.tsx` already link to their detail pages — read one to match the exact import and usage).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/src/features/courses/CourseListPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the route and nav link**

`client/src/routes.tsx`:
```tsx
      <Route path="/admin/courses">
        <ProtectedRoute>
          <CourseListPage />
        </ProtectedRoute>
      </Route>
```

`AdminHomePage.tsx` — add a nav link (`href="/admin/courses"`, label "강좌 관리"), update its test.

- [ ] **Step 6: Run check and the full client test suite**

Run: `npm run check && npx vitest run`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add client/src/features/courses/CourseListPage.tsx client/src/features/courses/CourseListPage.test.tsx client/src/routes.tsx client/src/features/dashboard/AdminHomePage.tsx client/src/features/dashboard/AdminHomePage.test.tsx
git commit -m "feat: add course list/filter/create client page"
```

---

## Task 8: Client — course detail page (schedules, exceptions, enrollments)

**Files:**
- Create: `client/src/features/courses/CourseDetailPage.tsx`, `client/src/features/courses/CourseDetailPage.test.tsx`
- Modify: `client/src/routes.tsx`

**Interfaces:**
- Consumes: `apiGet`, `apiPost`, `apiPatch` from `apiClient.ts`; `GET /api/courses/:id` (course + schedules + activeEnrollmentCount from Task 3), `POST /api/courses/:id/schedules` / `PATCH /course-schedules/:id` / `DELETE /course-schedules/:id` (Task 4), `POST /api/courses/:id/exceptions` / `PATCH|DELETE /course-exceptions/:id` (Task 4), `GET /api/enrollments?courseId=...` / `POST /api/enrollments` / `POST /api/enrollments/:id/end` / `POST /api/enrollments/:id/cancel` (Task 5).
- Produces: `/admin/courses/:courseId` — a single page with three sections rendered in sequence (not a tabbed component library, matching this codebase's plain-section pattern already used on `StudentDetailPage.tsx` — read it first for the established "detail page with multiple stacked sections, each with its own local state and its own submit handler" structure): **일정** (list of schedules with an inline add-form: day/start/end/classroom; each row has a delete button), **휴강·보강** (list of exceptions with an inline add-form: type/date/reason; each row has a delete button), **수강생** (list of enrollments for this course with an inline enroll-student form: studentId/startDate/tuitionAmount, submitting to `POST /api/enrollments` with `courseId` fixed to this page's course — on a `409 PERIOD_OVERLAP` response, show the conflict and a "그래도 등록" (enroll anyway) button that resubmits with `confirmOverlap: true`; each enrollment row has "종료"/"취소" buttons).

- [ ] **Step 1: Write the failing test `client/src/features/courses/CourseDetailPage.test.tsx`**

Cover, using wouter's route-param mocking pattern already established in `StudentDetailPage.test.tsx` (read it first to match exactly how that file supplies a route param to the component under test): loads and renders the course info plus its schedules/exceptions/enrollments; adds a schedule via the inline form; adds an enrollment via the inline form and asserts the request body; simulates a `409 PERIOD_OVERLAP` response and asserts the "그래도 등록" confirm-and-retry flow sends `confirmOverlap: true` on the second request.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/src/features/courses/CourseDetailPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write `client/src/features/courses/CourseDetailPage.tsx`**

Follow `StudentDetailPage.tsx`'s exact structural conventions (route-param extraction via wouter's `useRoute` or `useParams` — check which this codebase actually uses — data-loading-on-mount pattern, per-section local state, `ApiRequestError` display). Implement the three sections described in this task's Interfaces block above. For the overlap-confirm flow specifically: on `POST /api/enrollments` throwing an `ApiRequestError` whose parsed body carries `error.code === 'PERIOD_OVERLAP'` (check `ApiRequestError`'s actual shape in `apiClient.ts` first — it may need a small addition to expose the parsed error code/data to callers if it doesn't already; if so, that's an in-scope, narrowly-justified addition to `apiClient.ts`, not scope creep, since Task 5's new `409 PERIOD_OVERLAP` response is the first place in this codebase a client needs to branch on a specific error code with attached `data`), store the conflict info and render a confirm button that resubmits the same form values plus `confirmOverlap: true`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/src/features/courses/CourseDetailPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the route**

`client/src/routes.tsx`:
```tsx
      <Route path="/admin/courses/:courseId">
        <ProtectedRoute>
          <CourseDetailPage />
        </ProtectedRoute>
      </Route>
```
(Register this AFTER `/admin/courses` in the route list, matching wouter's/this codebase's existing convention for parameterized routes following their static-prefix siblings — check `routes.tsx`'s existing ordering for `/admin/students` vs `/admin/students/:studentId` and mirror it exactly.)

- [ ] **Step 6: Run check and the full client test suite**

Run: `npm run check && npx vitest run`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add client/src/features/courses/CourseDetailPage.tsx client/src/features/courses/CourseDetailPage.test.tsx client/src/routes.tsx client/src/lib/apiClient.ts
git commit -m "feat: add course detail page with schedules, exceptions, and enrollment management"
```

---

## Task 9: End-to-end verification and full check

**Files:**
- Create: `tests/e2e/courses-enrollments.spec.ts`

**Interfaces:**
- Consumes: the running app from `npm run dev`, `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD` from `.env`.

- [ ] **Step 1: Write `tests/e2e/courses-enrollments.spec.ts`**

Golden path per spec's own rollout checklist (line 1817: "관리자 로그인 → 학생·보호자 등록 → 강좌 수강 연결 → 과거 이력 확인"): log in → create a grade level (if needed) and a student (reusing the exact pattern from `tests/e2e/checkin.spec.ts`/`students.spec.ts`) → create an instructor → create a course → navigate to the course detail page → enroll the student → verify the enrollment appears on the course detail page's 수강생 section → end the enrollment → navigate to the student's own detail page (or wherever this stage's UI surfaces `GET /api/students/:id/enrollments` — if Task 6-8's client work didn't add an enrollment-history section to `StudentDetailPage.tsx`, call the API directly via `page.request.get(...)` with the admin's session cookie instead, since building that UI surface wasn't in this plan's task list) and confirm the ended enrollment is still visible (history preserved, not deleted). Include full FK-safe cleanup of every fixture row created (enrollments → course schedules/exceptions → course → instructor → student → grade level), matching the established cleanup-inline-after-assertions pattern from every prior e2e spec in this project.

- [ ] **Step 2: Run the e2e suite**

Run: `npm run test:e2e`
Expected: PASS — includes all pre-existing e2e specs plus this new one.

- [ ] **Step 3: Run the full unit/integration suite, check, and build**

Run:
```bash
npx vitest run
npm run check
npm run build
```
Expected: all clean.

- [ ] **Step 4: Manual verification and cleanup**

Run `npm run dev`, log in, walk the same golden path manually in a browser: create an instructor, a course with a weekly schedule and one exception, enroll a student (trigger the overlap-warning by creating a second overlapping enrollment on purpose, confirm past it), end one enrollment, verify the course's `activeEnrollmentCount` on its detail page reflects the change. Clean up all scratch data created. Stop the dev server and verify (with real command output, not assumption) that nothing is left running on its ports, per this project's established process-management discipline.

- [ ] **Step 5: Commit and push**

```bash
git add tests/e2e/courses-enrollments.spec.ts
git commit -m "test: add end-to-end coverage for instructor/course/enrollment golden path"
git push
git status
```
Expected: `git status` reports a clean working tree, up to date with `origin/main`.
