# Stage 6: Check-in (등원 기록) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public phone-search check-in kiosk and the admin check-in management screen — the `학생·보호자 → 강좌 → 기간별 수강등록 → 등원 기록` pipeline's next link. A student (or whoever is standing at the kiosk) types the last 4 digits of a phone number, picks their masked name from any resulting candidates, and confirms — the server records a KST-dated, server-timestamped check-in, enforced to at most one active *ordinary* check-in per student per day, with an explicit admin-only override for a genuine exception. Admins can view, manually add (including flagged exception duplicates), edit, and cancel check-ins, all audit-logged and never physically deleted.

**Architecture:** Three new tables: `check_ins` (the record itself), `check_in_change_logs` (append-only audit trail for edits/cancels), and `student_checkin_phones` — a denormalized index table (deliberately deferred from Stages 4-5) that maps every phone number that can identify a student (the student's own, plus every guardian's whose `student_guardians.use_for_checkin` is true) to that student, kept in sync at the exact points those source phones or links change. The public search endpoint queries only this index table by `phone_last4`, so it never has to touch `students`/`guardians` directly and can't be tricked into leaking more than a masked name. Confirming a selected candidate uses a short-lived, HMAC-signed **selection token** (not a raw student id) returned by the search step — this is the same signed-token pattern this codebase already uses for auth sessions and password resets, applied to a new purpose, so a client can never just guess or replay an arbitrary student id into the confirm endpoint. Duplicate-check-in prevention and the "only one of two simultaneous check-in requests succeeds" requirement are both satisfied by a single Postgres partial unique index (`(student_id, check_in_date) WHERE status = 'active' AND is_exception = false`) — a plain `INSERT` racing against that index is atomic by construction, so unlike Stage 5.5's `UPDATE`-based optimistic locking, there is no read-then-write window here to protect. The `is_exception = false` qualifier is what makes admin-approved exception duplicates possible without weakening the constraint for the public kiosk flow, which never sets that flag: an admin who explicitly opts in (`allowException: true` on `POST /api/check-ins/manual`) gets a second row with `is_exception = true`, invisible to the index, while a second *kiosk* confirm the same day is still unconditionally blocked. `check_ins`' own `PATCH`/edit route is nonetheless built with the atomic, DB-level optimistic-locking pattern from Stage 5.5 from day one — there is no excuse to introduce a 9th copy of the pattern that whole stage existed to eliminate.

**Tech Stack:** Same as prior plans — Drizzle ORM, Express 5, Zod, React 19/Vite, wouter, Vitest, Playwright, Node's built-in `crypto` (HMAC, timing-safe compare — already used elsewhere in this codebase for tokens).

**Spec:** [`../../../academy_automation_final_development_prompt.md`](../../../academy_automation_final_development_prompt.md) — this plan implements `student_checkin_phones` (§9.4, deferred from Stage 4/5), `check_ins`/`check_in_change_logs` (§9.6), the check-in flow (§13.3), and the check-in portion of the API list (§12.5: `POST /api/check-in/search`, `POST /api/check-in/confirm`, `GET /api/check-ins`, `POST /api/check-ins/manual`, `PATCH /api/check-ins/:id`, `POST /api/check-ins/:id/cancel`, `GET /api/check-ins/:id/history`) and routes (§6.3 `/check-in` public, §6.4 `/admin/check-ins`). §13.3/§21-7's pre-implementation policy question ("관리자가 예외 등원을 추가할지는 구현 전 결정합니다") was put to the user directly and answered **allow it**: admins (any `CHECKINS_MANAGE` holder — this plan does not further restrict by role or by an edit/cancel time window, since the user's answer only addressed the exception-duplicate question, and no time-window limit was requested) can create an explicitly-flagged exception duplicate check-in via `POST /api/check-ins/manual` with `allowException: true`, logged as `check_in_change_logs.action = 'exception_create'` with the required reason. Deliberately deferred to later stages: `GET /api/students/:id/check-ins` (a thin read of this stage's own data, trivial to add later once messaging/reporting needs it — not required by this stage's own UI), `/api/reports/check-ins` (reporting stage).

**Prior plans:** [`2026-08-15-stage4-guardians.md`](2026-08-15-stage4-guardians.md), [`2026-08-15-stage5-students.md`](2026-08-15-stage5-students.md) (source of `students`/`guardians`/`student_guardians`, extended here with the sync retrofit), [`2026-08-16-stage5.5-optimistic-locking.md`](2026-08-16-stage5.5-optimistic-locking.md) (source of the atomic-locking pattern and the `sendVersionConflict` helper this plan reuses directly).

## Global Constraints

- KST (`Asia/Seoul`) for all check-in business dates — `getTodayKST()`/`getNowKSTISOString()` from `@shared/kst`. `check_in_date` is always server-computed at confirm time, never client-supplied. `check_in_at` is the server's own timestamp (`new Date()`), never a browser-supplied time.
- API envelope: `{ data, meta: { requestId, kstTimestamp } }` / `{ error: { code, message, fieldErrors?, requestId } }`. New error codes used in this plan: `409 DUPLICATE_CHECKIN`, `410 SELECTION_EXPIRED` (selection token expired or invalid), `429 RATE_LIMITED`.
- **Every table's `createdAt`/`updatedAt` is set explicitly via `new Date()` at INSERT time — never left to rely on the schema's `defaultNow()` default.** This is the precision-safety lesson from Stage 5.5 (Postgres's `defaultNow()` has microsecond precision, JS `Date` only holds milliseconds, and any column that will ever be optimistic-locked or timestamp-compared must never silently acquire DB-native extra precision). Apply this from the first migration in this plan, not as a later fix.
- `check_ins`' `PATCH /:id` (edit) uses the SAME atomic, DB-level optimistic-locking pattern established in Stage 5.5: `expectedUpdatedAt: z.iso.datetime()`, `.where(and(eq(checkIns.id, id), eq(checkIns.updatedAt, new Date(expectedUpdatedAt))))`, `sendVersionConflict(res, req.requestId)` (the shared helper from `server/utils/httpErrors.ts`) on a zero-row result. Do not write a new SELECT-then-compare version check anywhere in this plan.
- **Public endpoints** (`POST /api/check-in/search`, `POST /api/check-in/confirm`) have **no authentication** (per spec — students/guardians never get login accounts) but **must be rate-limited** (spec §14.5's explicit requirement) and must **never** return a full name, full phone number, guardian name, course information, or any other field beyond a masked name and an opaque, single-purpose selection token.
- Every admin-facing check-in route requires `requireAuth` + `requirePermission(PERMISSIONS.CHECKINS_MANAGE)`.
- Every check-in create/edit/cancel writes a `check_in_change_logs` row (not the general `audit_logs` table — this domain has its own dedicated history table per spec §9.6, in addition to whatever the general `audit_logs` convention would also record; `writeAuditLog` is still called too, matching every other mutation in this codebase, so both trails exist).
- Check-ins are **never physically deleted** — "cancel" sets `status: 'canceled'`, never removes the row.
- `student_checkin_phones` must be kept in sync at every point a student's own phone changes, a guardian's phone changes, a student-guardian link's `use_for_checkin` flag changes, or a link is created/deleted. Sync happens inside the SAME transaction/request as the triggering mutation — never as an out-of-band job.
- Duplicate check-in prevention relies on a Postgres partial unique index, not application-level pre-checks — this is deliberately different from (and simpler/safer than) the Stage 5.5 optimistic-locking pattern, because a plain `INSERT` has no read-then-write window to protect.
- The public kiosk flow (`POST /api/check-in/confirm`) NEVER sets `isException: true` and has no `allowException` input — the admin-exception override exists ONLY on `POST /api/check-ins/manual`. A kiosk confirm always hits the same partial unique index as everyone else and is unconditionally blocked by a same-day duplicate.
- No separate test DB — every server integration test hits the real local dev `DATABASE_URL` and must clean up every row it creates, in FK-safe order, and must never touch the real bootstrapped super-admin.
- `npm run check` must be clean after every task.

---

## File Structure

```
migrations/                                # new migration

shared/
  schema.ts                                # modified: add checkIns, checkInChangeLogs, studentCheckinPhones
  permissions.ts                           # modified: add PERMISSIONS.CHECKINS_MANAGE
  masking.ts                               # unchanged, reused (maskName)

server/
  utils/
    checkinToken.ts / .test.ts             # HMAC selection-token create/verify
    checkinPhones.ts / .test.ts            # sync helpers for student_checkin_phones
  middleware/
    rateLimit.ts / .test.ts                # in-memory sliding-window limiter
  routes/
    checkIn.ts / .test.ts                  # public: POST /search, POST /confirm
    checkIns.ts / .test.ts                 # admin: GET /, POST /manual, PATCH /:id, POST /:id/cancel, GET /:id/history
    students.ts / .test.ts                 # modified: wire checkinPhones sync into POST/PATCH/DELETE/:id/restore/:id/guardians
    guardians.ts / .test.ts                # modified: wire checkinPhones sync into PATCH (phone change)
    studentGuardians.ts / .test.ts         # modified: wire checkinPhones sync into PATCH (useForCheckin toggle) / DELETE
  app.ts                                   # modified: mount both new routers

client/
  src/
    features/
      checkin/
        CheckInKioskPage.tsx / .test.tsx   # public /check-in
        AdminCheckInsPage.tsx / .test.tsx  # /admin/check-ins
      dashboard/
        AdminHomePage.tsx                  # modified: add "등원 조회" nav link
    routes.tsx                             # modified: add /check-in (public), /admin/check-ins

tests/
  e2e/
    checkin.spec.ts
```

---

## Task 1: Schema, permission, token/sync utilities

**Files:**
- Modify: `shared/schema.ts`, `shared/permissions.ts`
- Create: `server/utils/checkinToken.ts`, `server/utils/checkinToken.test.ts`, `server/utils/checkinPhones.ts`, `server/utils/checkinPhones.test.ts`, `server/middleware/rateLimit.ts`, `server/middleware/rateLimit.test.ts`

**Interfaces:**
- Consumes: `students`, `guardians`, `studentGuardians` (Stage 4-5), `maskName` from `@shared/masking`, `getTodayKST`/`getNowKSTISOString` from `@shared/kst`.
- Produces: `checkIns`, `checkInChangeLogs`, `studentCheckinPhones` Drizzle tables. `PERMISSIONS.CHECKINS_MANAGE`. `createSelectionToken(studentId, secret): string`, `verifySelectionToken(token, secret): { studentId: string; nonce: string; issuedAt: number } | null` — used by Task 3. `syncStudentOwnPhone(tx, studentId, phoneNormalized): Promise<void>`, `syncGuardianPhone(tx, guardianId, phoneNormalized): Promise<void>`, `upsertGuardianLinkPhone(tx, studentId, guardianId, phoneNormalized, isActive): Promise<void>`, `removeGuardianLinkPhone(tx, studentId, guardianId): Promise<void>` — used by Task 2 (wired into students/guardians/studentGuardians routes) and, indirectly, by Task 3's search (reads the table these write). `createRateLimiter(opts: { windowMs: number; max: number }): RequestHandler` — used by Task 3.

- [ ] **Step 1: Add `date` (if not already imported) and confirm existing imports in `shared/schema.ts`**

The file already imports `boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid` from `drizzle-orm/pg-core` as of Stage 5 — verify this by reading the current file; if `date` is missing, add it.

- [ ] **Step 2: Add the three tables**

Append to `shared/schema.ts`:

```ts
export const checkIns = pgTable(
  'check_ins',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    checkInDate: date('check_in_date').notNull(),
    checkInAt: timestamp('check_in_at', { withTimezone: true }).notNull(),
    source: text('source', { enum: ['kiosk', 'admin', 'import'] }).notNull(),
    status: text('status', { enum: ['active', 'canceled'] }).notNull().default('active'),
    idempotencyKey: text('idempotency_key').notNull(),
    exceptionReason: text('exception_reason'),
    isException: boolean('is_exception').notNull().default(false),
    createdBy: uuid('created_by').references(() => admins.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('check_ins_idempotency_key_unique').on(table.idempotencyKey),
    uniqueIndex('check_ins_student_date_active_unique')
      .on(table.studentId, table.checkInDate)
      .where(sql`${table.status} = 'active' AND ${table.isException} = false`),
    index('check_ins_date_at_idx').on(table.checkInDate, table.checkInAt),
    index('check_ins_student_date_idx').on(table.studentId, table.checkInDate),
  ]
);

export const checkInChangeLogs = pgTable('check_in_change_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  checkInId: uuid('check_in_id')
    .notNull()
    .references(() => checkIns.id),
  action: text('action', { enum: ['create', 'update', 'cancel', 'exception_create'] }).notNull(),
  beforeData: jsonb('before_data'),
  afterData: jsonb('after_data'),
  reason: text('reason'),
  adminId: uuid('admin_id').references(() => admins.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const studentCheckinPhones = pgTable(
  'student_checkin_phones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id),
    sourceType: text('source_type', { enum: ['student', 'guardian'] }).notNull(),
    sourceId: uuid('source_id').notNull(),
    phoneNormalized: text('phone_normalized').notNull(),
    phoneLast4: text('phone_last4').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('student_checkin_phones_last4_active_idx').on(table.phoneLast4, table.isActive),
    index('student_checkin_phones_student_active_idx').on(table.studentId, table.isActive),
  ]
);
```

Note: `sql` is already imported in `shared/schema.ts` (used by the existing partial-unique-index tables from Stages 3-5) — verify, don't re-import.

- [ ] **Step 3: Add the permission constant to `shared/permissions.ts`**

```ts
export const PERMISSIONS = {
  ADMINS_MANAGE: 'admins:manage',
  ROLES_MANAGE: 'roles:manage',
  ACADEMY_MANAGE: 'academy:manage',
  GUARDIANS_MANAGE: 'guardians:manage',
  STUDENTS_MANAGE: 'students:manage',
  CHECKINS_MANAGE: 'checkins:manage',
} as const;
```

- [ ] **Step 4: Generate and apply the migration**

Run:
```bash
npm run db:generate
npm run db:migrate
```
Expected: clean apply, no errors.

- [ ] **Step 5: Write the failing test `server/utils/checkinToken.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createSelectionToken, verifySelectionToken } from './checkinToken';

const SECRET = 'test-checkin-token-secret';

describe('checkin selection token', () => {
  it('round-trips a valid token', () => {
    const token = createSelectionToken('11111111-1111-1111-1111-111111111111', SECRET);
    const payload = verifySelectionToken(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.studentId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('rejects a token signed with a different secret', () => {
    const token = createSelectionToken('11111111-1111-1111-1111-111111111111', SECRET);
    expect(verifySelectionToken(token, 'wrong-secret')).toBeNull();
  });

  it('rejects a tampered token', () => {
    const token = createSelectionToken('11111111-1111-1111-1111-111111111111', SECRET);
    const tampered = token.slice(0, -4) + 'aaaa';
    expect(verifySelectionToken(tampered, SECRET)).toBeNull();
  });

  it('rejects garbage input', () => {
    expect(verifySelectionToken('not-a-real-token', SECRET)).toBeNull();
    expect(verifySelectionToken('', SECRET)).toBeNull();
  });

  it('rejects an expired token', () => {
    const realNow = Date.now;
    let now = realNow();
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const token = createSelectionToken('11111111-1111-1111-1111-111111111111', SECRET);
    now += 61_000;
    expect(verifySelectionToken(token, SECRET)).toBeNull();

    vi.restoreAllMocks();
  });

  it('produces a different token each call (unique nonce)', () => {
    const a = createSelectionToken('11111111-1111-1111-1111-111111111111', SECRET);
    const b = createSelectionToken('11111111-1111-1111-1111-111111111111', SECRET);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run server/utils/checkinToken.test.ts`
Expected: FAIL — `Cannot find module './checkinToken'`.

- [ ] **Step 7: Write `server/utils/checkinToken.ts`**

```ts
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const TOKEN_TTL_MS = 60_000;
const TOKEN_NAMESPACE = 'checkin-selection';

export interface CheckinSelectionPayload {
  studentId: string;
  nonce: string;
  issuedAt: number;
}

export function createSelectionToken(studentId: string, secret: string): string {
  const nonce = randomUUID();
  const issuedAt = Date.now();
  const payload = `${TOKEN_NAMESPACE}:${studentId}:${nonce}:${issuedAt}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${payload}:${signature}`, 'utf8').toString('base64url');
}

export function verifySelectionToken(token: string, secret: string): CheckinSelectionPayload | null {
  let decoded: string;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const parts = decoded.split(':');
  if (parts.length !== 5) return null;
  const [namespace, studentId, nonce, issuedAtRaw, signature] = parts;
  if (namespace !== TOKEN_NAMESPACE || !studentId || !nonce) return null;

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > TOKEN_TTL_MS) return null;

  const payload = `${namespace}:${studentId}:${nonce}:${issuedAtRaw}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');

  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signature ?? '', 'hex');
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }

  return { studentId, nonce, issuedAt };
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run server/utils/checkinToken.test.ts`
Expected: PASS — 6 tests passing.

- [ ] **Step 9: Write the failing test `server/utils/checkinPhones.test.ts`**

```ts
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { students, guardians, gradeLevels, studentCheckinPhones } from '@shared/schema';
import {
  syncStudentOwnPhone,
  syncGuardianPhone,
  upsertGuardianLinkPhone,
  removeGuardianLinkPhone,
} from './checkinPhones';

const TEST_GRADE_NAME = 'test-checkinphones-grade';

async function seedStudentAndGuardian() {
  const [grade] = await db.insert(gradeLevels).values({ name: TEST_GRADE_NAME, sortOrder: 0 }).returning();
  const [student] = await db
    .insert(students)
    .values({
      name: 'test-checkinphones-학생',
      phoneNormalized: '01011110000',
      gradeLevelId: grade!.id,
      registrationDate: '2026-08-16',
      statusEffectiveDate: '2026-08-16',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  const [guardian] = await db
    .insert(guardians)
    .values({ name: 'test-checkinphones-보호자', phoneNormalized: '01022220000', createdAt: new Date(), updatedAt: new Date() })
    .returning();
  return { studentId: student!.id, guardianId: guardian!.id };
}

async function cleanup() {
  await db.delete(studentCheckinPhones).where(eq(studentCheckinPhones.phoneLast4, '0000'));
  await db.delete(students).where(eq(students.name, 'test-checkinphones-학생'));
  await db.delete(guardians).where(eq(guardians.name, 'test-checkinphones-보호자'));
  await db.delete(gradeLevels).where(eq(gradeLevels.name, TEST_GRADE_NAME));
}

describe('checkinPhones sync helpers', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('syncStudentOwnPhone inserts then updates the student-source row', async () => {
    const { studentId } = await seedStudentAndGuardian();

    await db.transaction((tx) => syncStudentOwnPhone(tx, studentId, '01011110000'));
    let rows = await db.select().from(studentCheckinPhones).where(eq(studentCheckinPhones.studentId, studentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourceType).toBe('student');
    expect(rows[0]!.phoneLast4).toBe('0000');

    await db.transaction((tx) => syncStudentOwnPhone(tx, studentId, '01099998888'));
    rows = await db.select().from(studentCheckinPhones).where(eq(studentCheckinPhones.studentId, studentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.phoneNormalized).toBe('01099998888');
    expect(rows[0]!.phoneLast4).toBe('8888');
  });

  it('upsertGuardianLinkPhone inserts, then removeGuardianLinkPhone deletes', async () => {
    const { studentId, guardianId } = await seedStudentAndGuardian();

    await db.transaction((tx) => upsertGuardianLinkPhone(tx, studentId, guardianId, '01022220000', true));
    let rows = await db
      .select()
      .from(studentCheckinPhones)
      .where(eq(studentCheckinPhones.studentId, studentId));
    expect(rows.filter((r) => r.sourceType === 'guardian')).toHaveLength(1);

    await db.transaction((tx) => removeGuardianLinkPhone(tx, studentId, guardianId));
    rows = await db.select().from(studentCheckinPhones).where(eq(studentCheckinPhones.studentId, studentId));
    expect(rows.filter((r) => r.sourceType === 'guardian')).toHaveLength(0);
  });

  it('upsertGuardianLinkPhone with isActive=false does not create a searchable row', async () => {
    const { studentId, guardianId } = await seedStudentAndGuardian();

    await db.transaction((tx) => upsertGuardianLinkPhone(tx, studentId, guardianId, '01022220000', false));
    const rows = await db
      .select()
      .from(studentCheckinPhones)
      .where(eq(studentCheckinPhones.studentId, studentId));
    const guardianRow = rows.find((r) => r.sourceType === 'guardian');
    expect(guardianRow?.isActive).toBe(false);
  });

  it('syncGuardianPhone updates every row for that guardian across all linked students', async () => {
    const { studentId, guardianId } = await seedStudentAndGuardian();
    await db.transaction((tx) => upsertGuardianLinkPhone(tx, studentId, guardianId, '01022220000', true));

    await db.transaction((tx) => syncGuardianPhone(tx, guardianId, '01077776666'));
    const rows = await db
      .select()
      .from(studentCheckinPhones)
      .where(eq(studentCheckinPhones.sourceId, guardianId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.phoneNormalized).toBe('01077776666');
    expect(rows[0]!.phoneLast4).toBe('6666');
  });
});
```

- [ ] **Step 10: Run to verify it fails**

Run: `npx vitest run server/utils/checkinPhones.test.ts`
Expected: FAIL — `Cannot find module './checkinPhones'`.

- [ ] **Step 11: Write `server/utils/checkinPhones.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { studentCheckinPhones } from '@shared/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function last4(phoneNormalized: string): string {
  return phoneNormalized.slice(-4);
}

/**
 * Upserts the single `source_type = 'student'` row for a student's own check-in-searchable
 * phone. A student's own phone is always check-in-eligible (unlike a guardian's, which is
 * gated by `student_guardians.use_for_checkin`), so this never needs an `isActive` argument.
 */
export async function syncStudentOwnPhone(tx: Tx, studentId: string, phoneNormalized: string): Promise<void> {
  const [existing] = await tx
    .select({ id: studentCheckinPhones.id })
    .from(studentCheckinPhones)
    .where(and(eq(studentCheckinPhones.studentId, studentId), eq(studentCheckinPhones.sourceType, 'student')));

  if (existing) {
    await tx
      .update(studentCheckinPhones)
      .set({ phoneNormalized, phoneLast4: last4(phoneNormalized), updatedAt: new Date() })
      .where(eq(studentCheckinPhones.id, existing.id));
    return;
  }

  await tx.insert(studentCheckinPhones).values({
    studentId,
    sourceType: 'student',
    sourceId: studentId,
    phoneNormalized,
    phoneLast4: last4(phoneNormalized),
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/**
 * Updates every `source_type = 'guardian'` row for this guardian, across every student they're
 * linked to (a guardian can be a sibling's shared contact) — called whenever a guardian's own
 * phone number changes.
 */
export async function syncGuardianPhone(tx: Tx, guardianId: string, phoneNormalized: string): Promise<void> {
  await tx
    .update(studentCheckinPhones)
    .set({ phoneNormalized, phoneLast4: last4(phoneNormalized), updatedAt: new Date() })
    .where(and(eq(studentCheckinPhones.sourceType, 'guardian'), eq(studentCheckinPhones.sourceId, guardianId)));
}

/**
 * Upserts the `source_type = 'guardian'` row for one specific student+guardian link — called
 * when a link is created, or when its `use_for_checkin` flag is toggled. `isActive` mirrors
 * the link's `use_for_checkin` value directly.
 */
export async function upsertGuardianLinkPhone(
  tx: Tx,
  studentId: string,
  guardianId: string,
  phoneNormalized: string,
  isActive: boolean
): Promise<void> {
  const [existing] = await tx
    .select({ id: studentCheckinPhones.id })
    .from(studentCheckinPhones)
    .where(
      and(
        eq(studentCheckinPhones.studentId, studentId),
        eq(studentCheckinPhones.sourceType, 'guardian'),
        eq(studentCheckinPhones.sourceId, guardianId)
      )
    );

  if (existing) {
    await tx
      .update(studentCheckinPhones)
      .set({ phoneNormalized, phoneLast4: last4(phoneNormalized), isActive, updatedAt: new Date() })
      .where(eq(studentCheckinPhones.id, existing.id));
    return;
  }

  await tx.insert(studentCheckinPhones).values({
    studentId,
    sourceType: 'guardian',
    sourceId: guardianId,
    phoneNormalized,
    phoneLast4: last4(phoneNormalized),
    isActive,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/** Removes the `source_type = 'guardian'` row for a link that was unlinked/deleted entirely. */
export async function removeGuardianLinkPhone(tx: Tx, studentId: string, guardianId: string): Promise<void> {
  await tx
    .delete(studentCheckinPhones)
    .where(
      and(
        eq(studentCheckinPhones.studentId, studentId),
        eq(studentCheckinPhones.sourceType, 'guardian'),
        eq(studentCheckinPhones.sourceId, guardianId)
      )
    );
}
```

- [ ] **Step 12: Run to verify it passes**

Run: `npx vitest run server/utils/checkinPhones.test.ts`
Expected: PASS — 4 tests passing.

- [ ] **Step 13: Write the failing test `server/middleware/rateLimit.test.ts`**

```ts
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rateLimit';

function buildApp() {
  const app = express();
  app.use(createRateLimiter({ windowMs: 1000, max: 2 }));
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('createRateLimiter', () => {
  it('allows requests up to the limit, then rejects with 429', async () => {
    const app = buildApp();

    const first = await request(app).get('/ping');
    const second = await request(app).get('/ping');
    const third = await request(app).get('/ping');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });

  it('resets after the window elapses', async () => {
    const app = express();
    app.use(createRateLimiter({ windowMs: 50, max: 1 }));
    app.get('/ping', (_req, res) => res.json({ ok: true }));

    const first = await request(app).get('/ping');
    expect(first.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 80));

    const second = await request(app).get('/ping');
    expect(second.status).toBe(200);
  });
});
```

- [ ] **Step 14: Run to verify it fails**

Run: `npx vitest run server/middleware/rateLimit.test.ts`
Expected: FAIL — `Cannot find module './rateLimit'`.

- [ ] **Step 15: Write `server/middleware/rateLimit.ts`**

```ts
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
}

/**
 * A simple in-memory sliding-window rate limiter, keyed by `req.ip`. This is correct for a
 * single Node process (this project's local dev server) but NOT correct across multiple
 * serverless function instances — revisit with a DB- or Redis-backed limiter before/when this
 * app is deployed to Vercel's multi-instance production environment (see CLAUDE.md).
 */
export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  const buckets = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const recent = (buckets.get(key) ?? []).filter((timestamp) => now - timestamp < options.windowMs);

    if (recent.length >= options.max) {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: '잠시 후 다시 시도해 주세요.', requestId: req.requestId },
      });
      return;
    }

    recent.push(now);
    buckets.set(key, recent);
    next();
  };
}
```

- [ ] **Step 16: Run to verify it passes**

Run: `npx vitest run server/middleware/rateLimit.test.ts`
Expected: PASS — 2 tests passing.

- [ ] **Step 17: Run check**

Run: `npm run check`
Expected: clean.

- [ ] **Step 18: Commit**

```bash
git add shared/schema.ts shared/permissions.ts migrations server/utils/checkinToken.ts server/utils/checkinToken.test.ts server/utils/checkinPhones.ts server/utils/checkinPhones.test.ts server/middleware/rateLimit.ts server/middleware/rateLimit.test.ts
git commit -m "feat: add check-in schema, CHECKINS_MANAGE permission, selection-token and phone-sync utilities, rate limiter"
```

---

## Task 2: Wire `student_checkin_phones` sync into students/guardians/studentGuardians + backfill

**Files:**
- Modify: `server/routes/students.ts`, `server/routes/students.test.ts`, `server/routes/guardians.ts`, `server/routes/guardians.test.ts`, `server/routes/studentGuardians.ts`, `server/routes/studentGuardians.test.ts`

**Interfaces:**
- Consumes: `syncStudentOwnPhone`, `syncGuardianPhone`, `upsertGuardianLinkPhone`, `removeGuardianLinkPhone` from `server/utils/checkinPhones` (Task 1).
- Produces: `student_checkin_phones` is now kept live-synced by every relevant mutation across three already-existing route files, plus a one-time backfill for any students/guardians/links created before this stage. Task 3's search endpoint depends on this table actually being populated correctly.

- [ ] **Step 1: Wire `students.ts`**

Read the current file first. There are four places to touch:

1. **`POST /` (create)** — after the successful insert, inside the same handler (no transaction currently wraps this insert; wrap the insert + sync in one `db.transaction` so they're atomic together):
   ```ts
   let created;
   try {
     created = await db.transaction(async (tx) => {
       const [row] = await tx
         .insert(students)
         .values({ /* ...existing values unchanged... */ })
         .returning();
       if (!row) return undefined;
       await syncStudentOwnPhone(tx, row.id, phoneNormalized);
       return row;
     });
   } catch (error) {
     /* ...existing FK-violation catch unchanged... */
   }
   ```
   (Add `import { syncStudentOwnPhone } from '../utils/checkinPhones';`)

2. **`PATCH /:id` (update)** — only when `phoneNormalized` is actually changing. After the existing atomic `UPDATE` succeeds (post Stage 5.5's pattern — this route already wraps its update in error handling, not necessarily a transaction; wrap the update + conditional sync call in `db.transaction` the same way):
   ```ts
   let updated;
   try {
     updated = await db.transaction(async (tx) => {
       const [row] = await tx
         .update(students)
         .set({ /* ...existing set unchanged... */ })
         .where(and(eq(students.id, id), eq(students.updatedAt, new Date(expectedUpdatedAt))))
         .returning();
       if (!row) return undefined;
       if (phoneNormalized !== undefined) {
         await syncStudentOwnPhone(tx, row.id, phoneNormalized);
       }
       return row;
     });
   } catch (error) {
     /* ...existing FK-violation catch unchanged... */
   }
   ```

3. **`DELETE /:id` (soft-delete)** — after the existing `deletedAt` update, deactivate the student's own check-in phone row so a soft-deleted student stops appearing in check-in search results:
   ```ts
   await db.update(studentCheckinPhones).set({ isActive: false, updatedAt: new Date() }).where(eq(studentCheckinPhones.studentId, id));
   ```
   Add this right after the existing `await db.update(students).set({ deletedAt: new Date(), ... })` line, before the audit log call. (Import `studentCheckinPhones` from `@shared/schema` if not already imported; import `and` if not already imported.)

4. **`POST /:id/restore`** — reactivate it symmetrically:
   ```ts
   await db.update(studentCheckinPhones).set({ isActive: true, updatedAt: new Date() }).where(eq(studentCheckinPhones.studentId, id));
   ```
   Add right after the existing restore `UPDATE`, before the audit log call.

5. **`POST /:id/guardians` (link creation)** — after the link is successfully created inside the existing transaction, sync the new guardian-source row using the guardian's phone (already fetched as `guardian.phoneNormalized` earlier in the handler) and the link's `useForCheckin` value:
   ```ts
         const [row] = await tx
           .insert(studentGuardians)
           .values({ /* ...existing values unchanged... */ })
           .returning();
         if (row) {
           await upsertGuardianLinkPhone(tx, id, parsed.guardianId, guardian.phoneNormalized, row.useForCheckin);
         }
         return row;
   ```
   (Add `import { upsertGuardianLinkPhone } from '../utils/checkinPhones';`)

- [ ] **Step 2: Wire `guardians.ts`**

Read the current file first. Only `PATCH /:id` needs a change — when `phoneNormalized` is changing, sync every student that guardian is linked to (this guardian may not be linked to any student yet in Stage 4-era tests, and `syncGuardianPhone` is a no-op `UPDATE` matching zero rows in that case, which is safe). Wrap the existing final `UPDATE` in a `db.transaction` the same way as `students.ts`, and call `syncGuardianPhone(tx, id, phoneNormalized)` after a successful update when `phoneNormalized !== undefined`.

(Add `import { syncGuardianPhone } from '../utils/checkinPhones';`)

- [ ] **Step 3: Wire `studentGuardians.ts`**

Read the current file first. Two places:

1. **`PATCH /:id`** — when `changes.useForCheckin !== undefined` (i.e. the caller is actually changing it) OR whenever the update otherwise succeeds and the link's guardian's phone might be stale (keep this simple: always call `upsertGuardianLinkPhone` after a successful update, using the UPDATED row's `useForCheckin` value and the guardian's current phone — fetch the guardian's `phoneNormalized` via a `SELECT` from `guardians` inside the same transaction, since this router doesn't already have it loaded). Add this inside the existing `db.transaction(...)` block, after the version-checked `UPDATE` succeeds (post this plan's Stage-5.5-pattern `PATCH`), before returning `row`:
   ```ts
         const [guardianRow] = await tx.select().from(guardians).where(eq(guardians.id, row.guardianId));
         if (guardianRow) {
           await upsertGuardianLinkPhone(tx, row.studentId, row.guardianId, guardianRow.phoneNormalized, row.useForCheckin);
         }
   ```
   (Add `import { guardians } from '@shared/schema';` if not already imported, and `import { upsertGuardianLinkPhone } from '../utils/checkinPhones';`)

2. **`DELETE /:id`** — after the existing hard delete, remove the corresponding check-in phone row:
   ```ts
   await removeGuardianLinkPhone(db as unknown as Parameters<typeof removeGuardianLinkPhone>[0], existing.studentId, existing.guardianId);
   ```
   Actually — simpler and type-safe: since `removeGuardianLinkPhone`'s `Tx` type is structurally compatible with the base `db` object for a single non-transactional call (both support `.delete().where()`), just wrap the delete + phone removal in one `db.transaction` for atomicity, matching the pattern used everywhere else in this plan:
   ```ts
   await db.transaction(async (tx) => {
     await tx.delete(studentGuardians).where(eq(studentGuardians.id, id));
     await removeGuardianLinkPhone(tx, existing.studentId, existing.guardianId);
   });
   ```
   (Add `import { removeGuardianLinkPhone } from '../utils/checkinPhones';`)

- [ ] **Step 4: Write failing tests proving the sync actually happens**

Add ONE test to each of the three test files' relevant `describe` blocks (read each file first to match its existing seed/cleanup helper names exactly):

`server/routes/students.test.ts` — after creating a student, query `studentCheckinPhones` directly and assert a `source_type: 'student'` row exists with the right `phoneLast4`; after `PATCH`ing the phone, assert the row's phone updated; after `DELETE`, assert `isActive: false`; after `POST /:id/restore`, assert `isActive: true` again. (One test covering create+update+delete+restore in sequence is fine, or split into 2 — your judgment, but cover all four transitions.)

`server/routes/guardians.test.ts` — link a guardian to a student first (via `POST /api/students/:id/guardians`), then `PATCH` the guardian's phone, then assert the corresponding `student_checkin_phones` row (found by `source_type: 'guardian'`, `source_id: guardianId`) has the new phone.

`server/routes/studentGuardians.test.ts` — link a guardian with `useForCheckin: true`, assert the phone row is `isActive: true`; `PATCH` the link to `useForCheckin: false`, assert the row flips to `isActive: false`; `DELETE` the link, assert the row is gone entirely.

Add cleanup for `studentCheckinPhones` rows to each file's existing `cleanup()` helper (delete by `studentId` matching the test students already being cleaned up — since `studentCheckinPhones.studentId` isn't nullable and always ties back to a real student, deleting by the SAME student-id lookup each file's `cleanup()` already does before deleting `students` will catch these too, as long as it runs BEFORE the `students` delete — check ordering).

- [ ] **Step 5: Run to verify the new tests fail, then implement, then verify they pass**

Run: `npx vitest run server/routes/students.test.ts server/routes/guardians.test.ts server/routes/studentGuardians.test.ts`
Expected: new sync-assertion tests FAIL before the wiring, PASS after. All pre-existing tests in all three files continue to pass throughout (this is proof the transaction-wrapping didn't change any existing behavior).

- [ ] **Step 6: One-time backfill for the local dev DB**

Write and run a one-off script (using the pattern already established in this project for ad-hoc DB scripts: `npx dotenv -e .env -- npx tsx --tsconfig server/tsconfig.json <script>.mts` with relative imports, since the `@shared/*` path alias does not resolve under plain `tsx`) that backfills `student_checkin_phones` for every existing non-deleted student and every existing active `student_guardians` link in the local dev DB, using the same `syncStudentOwnPhone`/`upsertGuardianLinkPhone` functions (relative-imported). This is idempotent (safe to re-run) since both functions upsert. Delete the script after running it once — it's a one-time local-dev operation, not a permanent migration script, since this project does not have production data yet (see CLAUDE.md — still pre-launch, local dev only).

- [ ] **Step 7: Run check and the full suite**

Run:
```bash
npm run check
npx vitest run
```
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add server/routes/students.ts server/routes/students.test.ts server/routes/guardians.ts server/routes/guardians.test.ts server/routes/studentGuardians.ts server/routes/studentGuardians.test.ts
git commit -m "feat: sync student_checkin_phones on every student/guardian/link mutation"
```

---

## Task 3: Public check-in API — search + confirm

**Files:**
- Create: `server/routes/checkIn.ts`, `server/routes/checkIn.test.ts`
- Modify: `server/app.ts`

**Interfaces:**
- Consumes: `studentCheckinPhones`, `students`, `checkIns` tables; `maskName` from `@shared/masking`; `createSelectionToken`/`verifySelectionToken` from `../utils/checkinToken`; `createRateLimiter` from `../middleware/rateLimit`; `getTodayKST`/`getNowKSTISOString` from `@shared/kst` (Task 1).
- Produces: `createCheckInRouter(deps: { sessionSecret: string }): Router`, mounted at `/api/check-in` (singular — matches spec's exact URL), with `POST /search` and `POST /confirm`. No auth middleware on either route. Response shape for search: `{ status: 'no_match' } | { status: 'candidates'; candidates: Array<{ selectionToken: string; maskedName: string }> }`. Confirm succeeds with `{ status: 'confirmed'; checkInAt: string; maskedName: string }` (200); a same-day duplicate is a `409 DUPLICATE_CHECKIN` error response, not a 200 `already_checked_in` status — the actual implementation in Step 3 below is the authority (this line was corrected post-implementation; an earlier draft of this line described a 200 `already_checked_in` shape that Step 3's code never implements).

- [ ] **Step 1: Write the failing test `server/routes/checkIn.test.ts`**

```ts
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { students, gradeLevels, checkIns, studentCheckinPhones } from '@shared/schema';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const TEST_GRADE_NAME = 'test-checkin-grade';
const TEST_STUDENT_NAME = 'test-checkin-학생';
const TEST_STUDENT_PHONE = '01099990000';

async function seedStudent() {
  const [grade] = await db.insert(gradeLevels).values({ name: TEST_GRADE_NAME, sortOrder: 0 }).returning();
  const [student] = await db
    .insert(students)
    .values({
      name: TEST_STUDENT_NAME,
      phoneNormalized: TEST_STUDENT_PHONE,
      gradeLevelId: grade!.id,
      registrationDate: '2026-08-16',
      statusEffectiveDate: '2026-08-16',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  await db.insert(studentCheckinPhones).values({
    studentId: student!.id,
    sourceType: 'student',
    sourceId: student!.id,
    phoneNormalized: TEST_STUDENT_PHONE,
    phoneLast4: TEST_STUDENT_PHONE.slice(-4),
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { studentId: student!.id };
}

async function cleanup() {
  const testStudents = await db.select({ id: students.id }).from(students).where(eq(students.name, TEST_STUDENT_NAME));
  for (const s of testStudents) {
    await db.delete(checkIns).where(eq(checkIns.studentId, s.id));
    await db.delete(studentCheckinPhones).where(eq(studentCheckinPhones.studentId, s.id));
  }
  await db.delete(students).where(eq(students.name, TEST_STUDENT_NAME));
  await db.delete(gradeLevels).where(eq(gradeLevels.name, TEST_GRADE_NAME));
}

describe('public check-in routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('returns no_match for an unknown last-4', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).post('/api/check-in/search').send({ last4: '0000' });
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('no_match');
  });

  it('returns a masked candidate and confirms a check-in', async () => {
    const { studentId } = await seedStudent();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });

    const search = await request(app).post('/api/check-in/search').send({ last4: '0000' });
    expect(search.status).toBe(200);
    expect(search.body.data.status).toBe('candidates');
    expect(search.body.data.candidates).toHaveLength(1);
    expect(search.body.data.candidates[0].maskedName).toBe('t***************생');
    expect(search.body.data.candidates[0]).not.toHaveProperty('phoneNormalized');
    expect(search.body.data.candidates[0]).not.toHaveProperty('studentId');

    const confirm = await request(app)
      .post('/api/check-in/confirm')
      .send({ selectionToken: search.body.data.candidates[0].selectionToken });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.status).toBe('confirmed');

    const rows = await db.select().from(checkIns).where(eq(checkIns.studentId, studentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe('kiosk');
    expect(rows[0]!.status).toBe('active');
  });

  it('rejects a second confirm the same day with already_checked_in', async () => {
    await seedStudent();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });

    const firstSearch = await request(app).post('/api/check-in/search').send({ last4: '0000' });
    await request(app).post('/api/check-in/confirm').send({ selectionToken: firstSearch.body.data.candidates[0].selectionToken });

    const secondSearch = await request(app).post('/api/check-in/search').send({ last4: '0000' });
    const secondConfirm = await request(app)
      .post('/api/check-in/confirm')
      .send({ selectionToken: secondSearch.body.data.candidates[0].selectionToken });

    expect(secondConfirm.status).toBe(409);
    expect(secondConfirm.body.error.code).toBe('DUPLICATE_CHECKIN');
  });

  it('rejects an expired or invalid selection token', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).post('/api/check-in/confirm').send({ selectionToken: 'garbage-not-a-real-token' });
    expect(response.status).toBe(410);
    expect(response.body.error.code).toBe('SELECTION_EXPIRED');
  });

  it('rejects a malformed last4', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).post('/api/check-in/search').send({ last4: 'abcd' });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/routes/checkIn.test.ts`
Expected: FAIL — 404s (route doesn't exist yet).

- [ ] **Step 3: Write `server/routes/checkIn.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString, getTodayKST } from '@shared/kst';
import { maskName } from '@shared/masking';
import { db } from '../db';
import { checkIns, students, studentCheckinPhones } from '@shared/schema';
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

    res.json({
      data: { status: 'confirmed', checkInAt: created.checkInAt.toISOString(), maskedName: maskName(student.name) },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  void randomUUID; // (reserved: not directly used, idempotencyKey comes from the token's own nonce)

  return router;
}
```

Remove the stray `void randomUUID;` line and its now-unnecessary import if your editor/linter flags it as dead code — it was included above only to make explicit that `idempotencyKey` deliberately reuses the token's `nonce` rather than minting a second random value; drop the import of `randomUUID` entirely if you don't end up needing it elsewhere in this file.

- [ ] **Step 4: Mount the router in `server/app.ts`**

```ts
import { createCheckInRouter } from './routes/checkIn';
// ...
app.use('/api/check-in', createCheckInRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run server/routes/checkIn.test.ts`
Expected: PASS — 5 tests passing.

- [ ] **Step 6: Run check**

Run: `npm run check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add server/routes/checkIn.ts server/routes/checkIn.test.ts server/app.ts
git commit -m "feat: add public check-in search and confirm API"
```

---

## Task 4: Admin check-in API

**Files:**
- Create: `server/routes/checkIns.ts`, `server/routes/checkIns.test.ts`
- Modify: `server/app.ts`

**Interfaces:**
- Consumes: `checkIns`, `checkInChangeLogs`, `students` tables; `PERMISSIONS.CHECKINS_MANAGE`; `sendVersionConflict` from `../utils/httpErrors` (Stage 5.5).
- Produces: `createCheckInsRouter(deps): Router`, mounted at `/api/check-ins` (plural), with `GET /` (list/filter), `POST /manual` (admin manual check-in — body accepts an optional `allowException: boolean`; when `true` AND a same-day active non-exception check-in already exists, this creates a SECOND row with `isException: true` instead of returning `409 DUPLICATE_CHECKIN`, logged as `check_in_change_logs.action = 'exception_create'`), `PATCH /:id` (edit time/reason, atomic optimistic locking), `POST /:id/cancel`, `GET /:id/history`.

- [ ] **Step 1: Write the failing test `server/routes/checkIns.test.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, students, gradeLevels, checkIns, checkInChangeLogs } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-checkins-super@example.com';
const PASSWORD = 'test-checkins-password-123';
const TEST_GRADE_NAME = 'test-checkins-grade';
const TEST_STUDENT_NAME = 'test-checkins-학생';

async function seedFixtures() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-checkins-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION], createdAt: new Date(), updatedAt: new Date() })
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
  const [grade] = await db.insert(gradeLevels).values({ name: TEST_GRADE_NAME, sortOrder: 0 }).returning();
  const [student] = await db
    .insert(students)
    .values({
      name: TEST_STUDENT_NAME,
      phoneNormalized: '01099991111',
      gradeLevelId: grade!.id,
      registrationDate: '2026-08-16',
      statusEffectiveDate: '2026-08-16',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return { studentId: student!.id };
}

async function loginAs(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('login did not return a session cookie');
  return cookie;
}

async function cleanup() {
  const testStudents = await db.select({ id: students.id }).from(students).where(eq(students.name, TEST_STUDENT_NAME));
  for (const s of testStudents) {
    const testCheckIns = await db.select({ id: checkIns.id }).from(checkIns).where(eq(checkIns.studentId, s.id));
    for (const c of testCheckIns) {
      await db.delete(checkInChangeLogs).where(eq(checkInChangeLogs.checkInId, c.id));
    }
    await db.delete(checkIns).where(eq(checkIns.studentId, s.id));
  }
  await db.delete(students).where(eq(students.name, TEST_STUDENT_NAME));
  await db.delete(gradeLevels).where(eq(gradeLevels.name, TEST_GRADE_NAME));

  const adminToDelete = await db.query.admins.findFirst({ where: eq(admins.email, SUPER_EMAIL) });
  if (adminToDelete) {
    const { auditLogs, authSessions, passwordResetTokens } = await import('@shared/schema');
    await db.delete(auditLogs).where(eq(auditLogs.adminId, adminToDelete.id));
    await db.delete(authSessions).where(eq(authSessions.adminId, adminToDelete.id));
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.adminId, adminToDelete.id));
    await db.delete(admins).where(eq(admins.id, adminToDelete.id));
  }
  await db.delete(roles).where(eq(roles.name, 'test-checkins-role'));
}

describe('admin check-ins routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/check-ins');
    expect(response.status).toBe(401);
  });

  it('creates a manual check-in, lists it, edits it, and cancels it', async () => {
    const { studentId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/check-ins/manual')
      .set('Cookie', cookie)
      .send({ studentId, reason: '기기 오류로 수동 등록' });
    expect(created.status).toBe(200);
    expect(created.body.data.source).toBe('admin');
    expect(created.body.data.exceptionReason).toBe('기기 오류로 수동 등록');

    const list = await request(app).get(`/api/check-ins?studentId=${studentId}`).set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const edited = await request(app)
      .patch(`/api/check-ins/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ checkInAt: '2026-08-16T09:00:00.000Z', reason: '시간 수정', expectedUpdatedAt: created.body.data.updatedAt });
    expect(edited.status).toBe(200);

    const history = await request(app).get(`/api/check-ins/${created.body.data.id}/history`).set('Cookie', cookie);
    expect(history.status).toBe(200);
    expect(history.body.data.length).toBeGreaterThanOrEqual(2);

    const canceled = await request(app)
      .post(`/api/check-ins/${created.body.data.id}/cancel`)
      .set('Cookie', cookie)
      .send({ reason: '오등록 취소' });
    expect(canceled.status).toBe(200);
    expect(canceled.body.data.status).toBe('canceled');
  });

  it('rejects duplicate manual check-in for the same student and date', async () => {
    const { studentId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app).post('/api/check-ins/manual').set('Cookie', cookie).send({ studentId, reason: '첫 등록' });
    const second = await request(app).post('/api/check-ins/manual').set('Cookie', cookie).send({ studentId, reason: '두번째' });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_CHECKIN');
  });

  it('allows an explicit exception duplicate when allowException is true, and logs it as exception_create', async () => {
    const { studentId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const first = await request(app)
      .post('/api/check-ins/manual')
      .set('Cookie', cookie)
      .send({ studentId, reason: '첫 등록' });
    expect(first.status).toBe(200);

    const withoutOverride = await request(app)
      .post('/api/check-ins/manual')
      .set('Cookie', cookie)
      .send({ studentId, reason: '오후 보강 재등원' });
    expect(withoutOverride.status).toBe(409);

    const exception = await request(app)
      .post('/api/check-ins/manual')
      .set('Cookie', cookie)
      .send({ studentId, reason: '오후 보강 재등원', allowException: true });
    expect(exception.status).toBe(200);
    expect(exception.body.data.id).not.toBe(first.body.data.id);

    const list = await request(app).get(`/api/check-ins?studentId=${studentId}`).set('Cookie', cookie);
    expect(list.body.data).toHaveLength(2);

    const history = await request(app).get(`/api/check-ins/${exception.body.data.id}/history`).set('Cookie', cookie);
    expect(history.body.data[0].action).toBe('exception_create');
  });

  it('rejects a stale PATCH with VERSION_CONFLICT', async () => {
    const { studentId } = await seedFixtures();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app).post('/api/check-ins/manual').set('Cookie', cookie).send({ studentId, reason: '등록' });
    await request(app)
      .patch(`/api/check-ins/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ reason: '첫 수정', expectedUpdatedAt: created.body.data.updatedAt });

    const staleEdit = await request(app)
      .patch(`/api/check-ins/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ reason: '두번째 수정', expectedUpdatedAt: created.body.data.updatedAt });

    expect(staleEdit.status).toBe(409);
    expect(staleEdit.body.error.code).toBe('VERSION_CONFLICT');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/routes/checkIns.test.ts`
Expected: FAIL — 404s.

- [ ] **Step 3: Write `server/routes/checkIns.ts`**

```ts
import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString, getTodayKST } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { checkIns, checkInChangeLogs, students } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';
import { sendVersionConflict } from '../utils/httpErrors';

const listQuerySchema = z.object({
  studentId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const manualCreateSchema = z.object({
  studentId: z.string().min(1),
  reason: z.string().min(1),
  allowException: z.boolean().optional(),
});

const updateCheckInSchema = z.object({
  checkInAt: z.iso.datetime().optional(),
  reason: z.string().min(1),
  expectedUpdatedAt: z.iso.datetime(),
});

const cancelSchema = z.object({
  reason: z.string().min(1),
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

export interface CheckInsRouterDeps {
  sessionSecret: string;
}

export function createCheckInsRouter(deps: CheckInsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireCheckinsManage = createRequirePermission(PERMISSIONS.CHECKINS_MANAGE);

  router.get('/', requireAuth, requireCheckinsManage, async (req, res) => {
    const parsedQuery = listQuerySchema.safeParse(req.query);
    const query = parsedQuery.success ? parsedQuery.data : {};

    const conditions = [];
    if (query.studentId) conditions.push(eq(checkIns.studentId, query.studentId));

    const rows = await db
      .select()
      .from(checkIns)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(checkIns.checkInAt));

    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/manual', requireAuth, requireCheckinsManage, async (req, res) => {
    const parsed = parseBody(manualCreateSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [student] = await db.select().from(students).where(eq(students.id, parsed.studentId));
    if (!student || student.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '학생을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const checkInDate = getTodayKST();
    const checkInAt = new Date();
    const isException = parsed.allowException === true;

    let created;
    try {
      [created] = await db
        .insert(checkIns)
        .values({
          studentId: parsed.studentId,
          checkInDate,
          checkInAt,
          source: 'admin',
          status: 'active',
          idempotencyKey: randomUUID(),
          exceptionReason: parsed.reason,
          isException,
          createdBy: req.admin!.id,
          createdAt: checkInAt,
          updatedAt: checkInAt,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, 'check_ins_student_date_active_unique')) {
        res.status(409).json({
          error: {
            code: 'DUPLICATE_CHECKIN',
            message: isException
              ? '등원 등록에 실패했습니다.'
              : '오늘 이미 등원 기록이 있습니다. 예외로 추가 등록하려면 allowException을 사용해 주세요.',
            requestId: req.requestId,
          },
        });
        return;
      }
      throw error;
    }
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '등원 등록에 실패했습니다.', requestId: req.requestId } });
      return;
    }

    await db.insert(checkInChangeLogs).values({
      checkInId: created.id,
      action: isException ? 'exception_create' : 'create',
      beforeData: null,
      afterData: { checkInAt: created.checkInAt, source: 'admin', reason: parsed.reason, isException },
      reason: parsed.reason,
      adminId: req.admin!.id,
      createdAt: new Date(),
    });

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'checkIn.manualCreate',
      targetType: 'checkIn',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { studentId: created.studentId, checkInDate: created.checkInDate },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/:id', requireAuth, requireCheckinsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateCheckInSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(checkIns).where(eq(checkIns.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '등원 기록을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const { expectedUpdatedAt, reason, checkInAt } = parsed;
    const [updated] = await db
      .update(checkIns)
      .set({ ...(checkInAt ? { checkInAt: new Date(checkInAt) } : {}), updatedAt: new Date() })
      .where(and(eq(checkIns.id, id), eq(checkIns.updatedAt, new Date(expectedUpdatedAt))))
      .returning();
    if (!updated) {
      sendVersionConflict(res, req.requestId);
      return;
    }

    await db.insert(checkInChangeLogs).values({
      checkInId: updated.id,
      action: 'update',
      beforeData: { checkInAt: before.checkInAt },
      afterData: { checkInAt: updated.checkInAt },
      reason,
      adminId: req.admin!.id,
      createdAt: new Date(),
    });

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'checkIn.update',
      targetType: 'checkIn',
      targetId: updated.id,
      beforeDataSafe: { checkInAt: before.checkInAt },
      afterDataSafe: { checkInAt: updated.checkInAt },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/cancel', requireAuth, requireCheckinsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(cancelSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(checkIns).where(eq(checkIns.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '등원 기록을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    if (before.status === 'canceled') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '이미 취소된 등원 기록입니다.', requestId: req.requestId } });
      return;
    }

    const [updated] = await db
      .update(checkIns)
      .set({ status: 'canceled', updatedAt: new Date() })
      .where(eq(checkIns.id, id))
      .returning();
    if (!updated) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '취소에 실패했습니다.', requestId: req.requestId } });
      return;
    }

    await db.insert(checkInChangeLogs).values({
      checkInId: updated.id,
      action: 'cancel',
      beforeData: { status: before.status },
      afterData: { status: 'canceled' },
      reason: parsed.reason,
      adminId: req.admin!.id,
      createdAt: new Date(),
    });

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'checkIn.cancel',
      targetType: 'checkIn',
      targetId: updated.id,
      beforeDataSafe: { status: before.status },
      afterDataSafe: { status: 'canceled' },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.get('/:id/history', requireAuth, requireCheckinsManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const rows = await db
      .select()
      .from(checkInChangeLogs)
      .where(eq(checkInChangeLogs.checkInId, id))
      .orderBy(desc(checkInChangeLogs.createdAt));

    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
```

- [ ] **Step 4: Mount the router in `server/app.ts`**

```ts
import { createCheckInsRouter } from './routes/checkIns';
// ...
app.use('/api/check-ins', createCheckInsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run server/routes/checkIns.test.ts`
Expected: PASS — 5 tests passing.

- [ ] **Step 6: Run check**

Run: `npm run check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add server/routes/checkIns.ts server/routes/checkIns.test.ts server/app.ts
git commit -m "feat: add admin check-in list, manual create, edit, cancel, and history API"
```

---

## Task 5: Client — public check-in kiosk page

**Files:**
- Create: `client/src/features/checkin/CheckInKioskPage.tsx`, `client/src/features/checkin/CheckInKioskPage.test.tsx`
- Modify: `client/src/routes.tsx`

**Interfaces:**
- Consumes: `apiPost` from `client/src/lib/apiClient.ts`.
- Produces: a rendered `/check-in` page — public, NOT wrapped in `ProtectedRoute` — consumed by Task 7's e2e test.

- [ ] **Step 1: Write the failing test `client/src/features/checkin/CheckInKioskPage.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckInKioskPage } from './CheckInKioskPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-16T00:00:00+09:00' } }),
  };
}

describe('CheckInKioskPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('searches by last 4 digits, shows one candidate, and confirms check-in', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/check-in/search') {
        return Promise.resolve(
          jsonResponse({ status: 'candidates', candidates: [{ selectionToken: 'tok-1', maskedName: '김*수' }] })
        );
      }
      if (path === '/api/check-in/confirm') {
        return Promise.resolve(jsonResponse({ status: 'confirmed', checkInAt: '2026-08-16T00:00:00.000Z', maskedName: '김*수' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CheckInKioskPage />);

    fireEvent.change(screen.getByLabelText('전화번호 뒤 4자리'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: '등원' }));

    await screen.findByText('김*수');
    fireEvent.click(screen.getByRole('button', { name: '김*수' }));

    await waitFor(() => expect(screen.getByText(/등원.*완료|환영/)).toBeInTheDocument());
  });

  it('shows a no-match message when nothing is found', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ status: 'no_match' })));
    vi.stubGlobal('fetch', fetchMock);

    render(<CheckInKioskPage />);
    fireEvent.change(screen.getByLabelText('전화번호 뒤 4자리'), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: '등원' }));

    await screen.findByText(/등록된 학생을 찾을 수 없습니다/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/src/features/checkin/CheckInKioskPage.test.tsx`
Expected: FAIL — `Cannot find module './CheckInKioskPage'`.

- [ ] **Step 3: Write `client/src/features/checkin/CheckInKioskPage.tsx`**

```tsx
import { type FormEvent, useState } from 'react';
import { ApiRequestError, apiPost } from '../../lib/apiClient';

interface Candidate {
  selectionToken: string;
  maskedName: string;
}

type SearchResponse = { status: 'no_match' } | { status: 'candidates'; candidates: Candidate[] };
type ConfirmResponse =
  | { status: 'confirmed'; checkInAt: string; maskedName: string }
  | { status: 'already_checked_in'; checkInAt: string };

export function CheckInKioskPage() {
  const [last4, setLast4] = useState('');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [noMatch, setNoMatch] = useState(false);
  const [confirmed, setConfirmed] = useState<{ maskedName: string; checkInAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resetAndSearchAgain() {
    setLast4('');
    setCandidates(null);
    setNoMatch(false);
    setConfirmed(null);
    setError(null);
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNoMatch(false);
    setCandidates(null);
    try {
      const response = await apiPost<SearchResponse>('/api/check-in/search', { last4 });
      if (response.status === 'no_match') {
        setNoMatch(true);
        return;
      }
      setCandidates(response.candidates);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '검색하지 못했습니다.');
    }
  }

  async function handleConfirm(selectionToken: string) {
    setError(null);
    try {
      const response = await apiPost<ConfirmResponse>('/api/check-in/confirm', { selectionToken });
      if (response.status === 'confirmed') {
        setConfirmed({ maskedName: response.maskedName, checkInAt: response.checkInAt });
        setCandidates(null);
      } else {
        setError(`이미 ${response.checkInAt}에 등원했습니다.`);
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '등원 처리에 실패했습니다.');
    }
  }

  if (confirmed) {
    return (
      <section className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
        <p className="text-2xl font-semibold">{confirmed.maskedName}님, 환영합니다!</p>
        <p className="mt-2 text-gray-600">등원 처리가 완료되었습니다.</p>
        <button type="button" onClick={resetAndSearchAgain} className="mt-6 rounded bg-blue-600 px-6 py-3 text-white">
          처음으로
        </button>
      </section>
    );
  }

  return (
    <section className="flex min-h-screen flex-col items-center justify-center p-4">
      <h1 className="text-xl font-semibold">등원 체크인</h1>

      {!candidates && (
        <form onSubmit={handleSearch} className="mt-6 flex flex-col items-center gap-3">
          <label className="flex flex-col items-center gap-1">
            <span>전화번호 뒤 4자리</span>
            <input
              value={last4}
              onChange={(event) => setLast4(event.target.value)}
              inputMode="numeric"
              maxLength={4}
              required
              className="w-40 rounded border border-gray-300 px-3 py-3 text-center text-2xl"
            />
          </label>
          <button type="submit" className="rounded bg-blue-600 px-8 py-3 text-lg text-white">
            등원
          </button>
        </form>
      )}

      {noMatch && (
        <p role="alert" className="mt-4 text-red-600">
          등록된 학생을 찾을 수 없습니다. 관리자에게 문의해 주세요.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 text-red-600">
          {error}
        </p>
      )}

      {candidates && candidates.length > 0 && (
        <div className="mt-6 flex flex-col gap-2">
          <p>본인 이름을 선택해 주세요</p>
          {candidates.map((candidate) => (
            <button
              key={candidate.selectionToken}
              type="button"
              onClick={() => handleConfirm(candidate.selectionToken)}
              className="rounded border border-gray-300 px-6 py-3 text-lg"
            >
              {candidate.maskedName}
            </button>
          ))}
          <button type="button" onClick={resetAndSearchAgain} className="mt-2 text-sm text-gray-500 underline">
            다시 검색
          </button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/src/features/checkin/CheckInKioskPage.test.tsx`
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Add the public `/check-in` route to `client/src/routes.tsx`**

Add the import `import { CheckInKioskPage } from './features/checkin/CheckInKioskPage';` and a new route — **not** wrapped in `ProtectedRoute`, since this is a public kiosk screen (matches the existing `/` and `/login` routes' pattern):

```tsx
      <Route path="/check-in" component={CheckInKioskPage} />
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
git add client/src/features/checkin/CheckInKioskPage.tsx client/src/features/checkin/CheckInKioskPage.test.tsx client/src/routes.tsx
git commit -m "feat: add public check-in kiosk page"
```

---

## Task 6: Client — admin check-in management page

**Files:**
- Create: `client/src/features/checkin/AdminCheckInsPage.tsx`, `client/src/features/checkin/AdminCheckInsPage.test.tsx`
- Modify: `client/src/routes.tsx`, `client/src/features/dashboard/AdminHomePage.tsx`, `client/src/features/dashboard/AdminHomePage.test.tsx`

**Interfaces:**
- Consumes: `apiGet`, `apiPost`, `apiPatch` from `client/src/lib/apiClient.ts`.
- Produces: a rendered `/admin/check-ins` page — consumed by Task 7's e2e test.

- [ ] **Step 1: Write the failing test `client/src/features/checkin/AdminCheckInsPage.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminCheckInsPage } from './AdminCheckInsPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-16T00:00:00+09:00' } }),
  };
}

describe('AdminCheckInsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the list and cancels a check-in', async () => {
    const rows = [
      { id: 'c1', studentId: 's1', checkInDate: '2026-08-16', checkInAt: '2026-08-16T00:00:00.000Z', source: 'kiosk', status: 'active', exceptionReason: null, updatedAt: '2026-08-16T00:00:00.000Z' },
    ];
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/check-ins' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse(rows));
      if (path === '/api/check-ins/c1/cancel' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ ...rows[0], status: 'canceled' }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('prompt', () => '취소 사유');

    render(<AdminCheckInsPage />);

    await screen.findByText('active');
    fireEvent.click(screen.getByRole('button', { name: '취소' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/check-ins/c1/cancel', expect.objectContaining({ method: 'POST' })));
  });

  it('submits a manual check-in with the exception checkbox checked as allowException: true', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/check-ins' && (!init || init.method === undefined)) return Promise.resolve(jsonResponse([]));
      if (path === '/api/check-ins/manual' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            id: 'c2',
            studentId: 's9',
            checkInDate: '2026-08-16',
            checkInAt: '2026-08-16T00:00:00.000Z',
            source: 'admin',
            status: 'active',
            exceptionReason: '오후 보강 재등원',
            updatedAt: '2026-08-16T00:00:00.000Z',
          })
        );
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminCheckInsPage />);

    fireEvent.change(screen.getByLabelText('학생 ID'), { target: { value: 's9' } });
    fireEvent.change(screen.getByLabelText('사유'), { target: { value: '오후 보강 재등원' } });
    fireEvent.click(screen.getByLabelText('예외 등원 허용 (이미 등원 기록이 있어도 추가 등록)'));
    fireEvent.click(screen.getByRole('button', { name: '수동 등원 등록' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/check-ins/manual',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ studentId: 's9', reason: '오후 보강 재등원', allowException: true }),
        })
      )
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/src/features/checkin/AdminCheckInsPage.test.tsx`
Expected: FAIL — `Cannot find module './AdminCheckInsPage'`.

- [ ] **Step 3: Write `client/src/features/checkin/AdminCheckInsPage.tsx`**

```tsx
import { type FormEvent, useState } from 'react';
import { ApiRequestError, apiGet, apiPost } from '../../lib/apiClient';

interface CheckIn {
  id: string;
  studentId: string;
  checkInDate: string;
  checkInAt: string;
  source: string;
  status: string;
  exceptionReason: string | null;
  updatedAt: string;
}

export function AdminCheckInsPage() {
  const [rows, setRows] = useState<CheckIn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [manualStudentId, setManualStudentId] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [allowException, setAllowException] = useState(false);

  async function load() {
    try {
      setRows(await apiGet<CheckIn[]>('/api/check-ins'));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
    }
  }

  async function handleCancel(id: string) {
    const reason = window.prompt('취소 사유를 입력해 주세요');
    if (!reason) return;
    setError(null);
    try {
      await apiPost(`/api/check-ins/${id}/cancel`, { reason });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '취소하지 못했습니다.');
    }
  }

  async function handleManualCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiPost('/api/check-ins/manual', { studentId: manualStudentId, reason: manualReason, allowException });
      setManualStudentId('');
      setManualReason('');
      setAllowException(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '수동 등원 등록에 실패했습니다.');
    }
  }

  useState(() => {
    void load();
  });

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">등원 조회</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <form onSubmit={handleManualCreate} className="mt-4 flex flex-col gap-2 rounded border border-gray-200 p-3">
        <h2 className="font-medium">수동 등원 등록</h2>
        <label className="flex flex-col gap-1">
          <span>학생 ID</span>
          <input
            value={manualStudentId}
            onChange={(event) => setManualStudentId(event.target.value)}
            required
            className="rounded border border-gray-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>사유</span>
          <input
            value={manualReason}
            onChange={(event) => setManualReason(event.target.value)}
            required
            className="rounded border border-gray-300 px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={allowException} onChange={(event) => setAllowException(event.target.checked)} />
          <span>예외 등원 허용 (이미 등원 기록이 있어도 추가 등록)</span>
        </label>
        <button type="submit" className="mt-1 self-start rounded bg-blue-600 px-4 py-2 text-white">
          수동 등원 등록
        </button>
      </form>

      <ul className="mt-4 space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between rounded border border-gray-200 p-2">
            <span>
              {row.checkInDate} — {row.status} ({row.source})
            </span>
            {row.status === 'active' && (
              <button type="button" onClick={() => handleCancel(row.id)} className="text-sm text-red-600 underline">
                취소
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Note: `useState(() => { void load(); })` is a lazy-initializer trick to run `load()` exactly once on mount without triggering the `react-hooks/set-state-in-effect` lint rule via a `useEffect` — this is a DIFFERENT (and simpler) workaround than the named-async-function-in-`useEffect` pattern used elsewhere in this codebase. If `npm run check` still flags this (lint rules can be stricter than expected), fall back to the established `useEffect` + named-async-function pattern from `StudentListPage.tsx`/`GuardianListPage.tsx` instead — check which one actually passes lint in this codebase before committing either way.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/src/features/checkin/AdminCheckInsPage.test.tsx`
Expected: PASS — 1 test passing.

- [ ] **Step 5: Add the route to `client/src/routes.tsx`**

```tsx
      <Route path="/admin/check-ins">
        <ProtectedRoute>
          <AdminCheckInsPage />
        </ProtectedRoute>
      </Route>
```

- [ ] **Step 6: Add a nav link to `client/src/features/dashboard/AdminHomePage.tsx`**

Add a new `<li>` after "학생 관리":

```tsx
          <li>
            <Link href="/admin/check-ins" className="text-blue-600 underline">
              등원 조회
            </Link>
          </li>
```

Update `AdminHomePage.test.tsx` to assert this new link, matching the existing pattern for the other nav links.

- [ ] **Step 7: Run check and the full client test suite**

Run:
```bash
npm run check
npx vitest run
```
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add client/src/features/checkin/AdminCheckInsPage.tsx client/src/features/checkin/AdminCheckInsPage.test.tsx client/src/routes.tsx client/src/features/dashboard/AdminHomePage.tsx client/src/features/dashboard/AdminHomePage.test.tsx
git commit -m "feat: add admin check-in management client page"
```

---

## Task 7: End-to-end verification and full check

**Files:**
- Create: `tests/e2e/checkin.spec.ts`

**Interfaces:**
- Consumes: the running app from `npm run dev`, `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD` from `.env`.

- [ ] **Step 1: Write `tests/e2e/checkin.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('creates a student via admin, then checks them in via the public kiosk', async ({ page }) => {
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

  await page.goto('/admin');
  await page.getByRole('link', { name: '학생 관리' }).click();

  const studentName = `e2e등원${Date.now()}`;
  const studentPhone = `010${Date.now().toString().slice(-8)}`;
  await page.getByLabel('이름').fill(studentName);
  await page.getByLabel('전화번호').fill(studentPhone);
  await page.getByLabel('학년').selectOption({ label: gradeName });
  await page.getByRole('button', { name: '학생 등록' }).click();

  const maskedName = `${Array.from(studentName)[0]}${'*'.repeat(Array.from(studentName).length - 2)}${Array.from(studentName)[Array.from(studentName).length - 1]}`;
  await expect(page.getByText(maskedName)).toBeVisible();

  await page.goto('/check-in');
  await page.getByLabel('전화번호 뒤 4자리').fill(studentPhone.slice(-4));
  await page.getByRole('button', { name: '등원' }).click();

  await page.getByRole('button', { name: maskedName }).click();
  await expect(page.getByText(/환영/)).toBeVisible();

  await page.goto('/check-in');
  await page.getByLabel('전화번호 뒤 4자리').fill(studentPhone.slice(-4));
  await page.getByRole('button', { name: '등원' }).click();
  await page.getByRole('button', { name: maskedName }).click();
  await expect(page.getByText(/이미.*등원했습니다/)).toBeVisible();
});
```

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

Run `npm run dev`, log in with `.env`'s credentials, create a test student, visit `/check-in` (public, no login) in a fresh browser context, search by the last 4 digits, confirm check-in, verify it appears in `/admin/check-ins`, edit its time, verify the history shows both the create and update entries, then cancel it. Also verify the rate limiter genuinely returns 429 after enough rapid requests to `/api/check-in/search` (e.g. via a quick shell loop of curl calls). Stop the dev server afterward and verify via `netstat -ano | grep -E ":5173|:8787"` and a process listing that nothing is left running — show the actual re-check output in your report.

- [ ] **Step 5: Commit and push**

```bash
git add tests/e2e/checkin.spec.ts
git commit -m "test: add end-to-end coverage for public check-in kiosk flow"
git push
git status
```
Expected: `git status` reports a clean working tree, up to date with `origin/main`.
