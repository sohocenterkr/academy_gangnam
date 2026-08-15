# Stage 4: Guardians & PII Masking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build guardian (보호자) management as an independent entity — full CRUD, phone-duplicate warning/confirm flow, name/phone masking on list views, audit logging, and a client UI — verified against the real local dev database. This is the first of two plans covering spec §9.4/§13.1; the second plan (students + student-guardian linking + check-in phone index) builds on this one.

**Architecture:** Guardians are a standalone table with no student relationship yet (that arrives in the next plan). Two new small, pure-function shared modules (`shared/phone.ts`, `shared/masking.ts`) implement normalization and masking once, reused by every route that touches personal data from here on. The duplicate-phone-warning flow follows spec §13.1's exact requirement ("중복 전화번호는 금지하지 않되 경고하고 사용자가 확인해야 저장됩니다") via a two-step create/update: the first call without `confirmDuplicate` returns a warning listing masked matches instead of creating/saving; the caller re-submits with `confirmDuplicate: true` to proceed.

**Tech Stack:** Same as prior plans — Drizzle ORM, Express 5, Zod, React 19/Vite, wouter, Vitest, Playwright.

**Spec:** [`../../../academy_automation_final_development_prompt.md`](../../../academy_automation_final_development_prompt.md) — this plan implements the `guardians` portion of §9.4, the guardian-masking rules of §10.5, the guardian-duplicate-warning rule from §13.1 step 5, and the guardian portion of §12.3's API list (`GET/POST /api/guardians`, `GET/PATCH /api/guardians/:id` — no `DELETE` for guardians exists in the spec's API list, so this plan doesn't add one). Student linking (`POST /api/students/:id/guardians`), consent, and check-in phone indexing are deliberately deferred to the next plan, once `students` exists.

**Prior plans:** [`2026-08-14-stage1-base-project.md`](2026-08-14-stage1-base-project.md), [`2026-08-14-stage2-db-auth.md`](2026-08-14-stage2-db-auth.md), [`2026-08-15-stage3-academic-reference-data.md`](2026-08-15-stage3-academic-reference-data.md) — `server/routes/schools.ts` is the pattern this plan's routes largely follow (optimistic locking, audit logging, `.cause`-walking error detection); `client/src/features/settings/AcademicsSettingsPage.tsx` is the pattern this plan's list/create UI follows.

## Global Constraints

- KST (`Asia/Seoul`) for all timestamps — `getNowKSTISOString` from `@shared/kst` in every API response.
- API envelope: `{ data, meta: { requestId, kstTimestamp } }` / `{ error: { code, message, fieldErrors?, requestId } }` (`shared/types.ts`).
- Error codes: `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 VERSION_CONFLICT` (optimistic-lock conflict only).
- **Every mutating + list/detail route requires `requireAuth` + `requirePermission(PERMISSIONS.GUARDIANS_MANAGE)`.**
- **Every create/update writes an audit log** via `writeAuditLog` — and per spec §16/§10.5, phone numbers in audit `beforeDataSafe`/`afterDataSafe` must be masked (via `maskPhone`), never stored raw in the audit trail.
- **Every PATCH endpoint uses optimistic locking**: `expectedUpdatedAt`/`409 VERSION_CONFLICT`, exactly like `server/routes/schools.ts`.
- **List/summary responses return masked name + masked phone** (spec §10.5, and this project's own established constraint from Stage 1's CLAUDE.md: "list/summary endpoints return masked names/phones"). Detail (`GET /:id`) responses return full, unmasked data — a detail view is reached deliberately by an authorized admin, not exposed in a scan-friendly list.
- **Name masking rule (spec §10.5, exact)**: 3+ characters → keep first and last, mask everything between with `*` (one asterisk per hidden character); 2 characters → keep the first character, mask the second; 1 character → `*`.
- **Guardian phone is never unique-constrained** (spec §13.1: "보호자 번호는 형제·자매 때문에 unique로 강제하지 않습니다. 중복후보를 경고합니다") — duplicates are allowed but flagged. `POST`/`PATCH` must warn (not block) on a phone that matches an existing guardian, and only save once the caller explicitly confirms.
- No separate test DB — every server-side integration test hits the real local dev `DATABASE_URL` and must clean up its own rows. Any test admin/role you seed and log in with needs the exact FK-safe cleanup order established in prior plans (`auth_sessions`/`audit_logs` before `admins`, `admins` before `roles`).
- Never touch, modify, or delete the real bootstrapped super-admin (`.env`'s `INITIAL_ADMIN_EMAIL`) in any test. **This project has a documented history of a test accidentally destroying this real admin (Stage 2/3) — if any task in this plan needs to seed an admin for testing, it MUST use its own disposable test-only role/admin, never touch or query by the real `최고관리자` role name.**
- Every test constructing `createApp(...)` must pass an explicit fake email adapter (`createApp({ emailAdapter: createFakeEmailAdapter() })`).
- `npm run check` must be clean after every task — no exceptions, this has been enforced strictly across every prior plan in this project.

---

## File Structure

```
migrations/                       # new migration generated by drizzle-kit

shared/
  schema.ts                       # modified: add guardians table
  permissions.ts                  # modified: add PERMISSIONS.GUARDIANS_MANAGE
  phone.ts / .test.ts             # new: normalizePhone, maskPhone
  masking.ts / .test.ts           # new: maskName

server/
  routes/
    guardians.ts / .test.ts
  app.ts                          # modified: mount the guardians router

client/
  src/
    lib/
      phone.ts                    # re-export of @shared/phone
      masking.ts                  # re-export of @shared/masking
    features/
      guardians/
        GuardianListPage.tsx / .test.tsx
        GuardianDetailPage.tsx / .test.tsx
    features/
      dashboard/
        AdminHomePage.tsx         # modified: add "보호자 관리" nav link
    routes.tsx                    # modified: add /admin/guardians, /admin/guardians/:guardianId

tests/
  e2e/
    guardians.spec.ts
```

---

## Task 1: Schema, migration, permission, shared phone/masking utilities

**Files:**
- Modify: `shared/schema.ts`, `shared/permissions.ts`
- Create: `shared/phone.ts`, `shared/phone.test.ts`, `shared/masking.ts`, `shared/masking.test.ts`, `client/src/lib/phone.ts`, `client/src/lib/masking.ts`
- Migration output: `migrations/` (generated, then committed)

**Interfaces:**
- Consumes: nothing new.
- Produces: `guardians` Drizzle table from `shared/schema.ts` (imported as `@shared/schema`) — used by Tasks 2-3. `PERMISSIONS.GUARDIANS_MANAGE` from `@shared/permissions` — used by Tasks 2-3. `normalizePhone(raw: string): string`, `maskPhone(phoneNormalized: string): string` from `@shared/phone` — used by Tasks 2-3 (server) and Tasks 4-5 (client, via the re-export). `maskName(name: string): string` from `@shared/masking` — used by Task 2 (server) and Tasks 4-5 (client, via the re-export).

- [ ] **Step 1: Add the `guardians` table to `shared/schema.ts`**

Add `index` to the existing `drizzle-orm/pg-core` import (currently `boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid`), then append this table definition to the end of the file:

```ts
export const guardians = pgTable(
  'guardians',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    phoneNormalized: text('phone_normalized').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => admins.id),
    updatedBy: uuid('updated_by').references(() => admins.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('guardians_phone_idx').on(table.phoneNormalized)]
);
```

Note: deliberately NO unique index on `phoneNormalized` — see Global Constraints. The plain (non-unique) index exists only for lookup performance on the duplicate-candidate query.

- [ ] **Step 2: Add the permission constant to `shared/permissions.ts`**

Change:
```ts
export const PERMISSIONS = {
  ADMINS_MANAGE: 'admins:manage',
  ROLES_MANAGE: 'roles:manage',
  ACADEMY_MANAGE: 'academy:manage',
} as const;
```
to:
```ts
export const PERMISSIONS = {
  ADMINS_MANAGE: 'admins:manage',
  ROLES_MANAGE: 'roles:manage',
  ACADEMY_MANAGE: 'academy:manage',
  GUARDIANS_MANAGE: 'guardians:manage',
} as const;
```

- [ ] **Step 3: Generate and apply the migration against the real local dev DB**

Run:
```bash
npm run db:generate
npm run db:migrate
```
Expected: `db:generate` writes new SQL under `migrations/`; `db:migrate` prints `Migrations applied.` with no errors. If this fails, stop and report — do not proceed with a broken migration.

- [ ] **Step 4: Write the failing test `shared/phone.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { maskPhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('strips all non-digit characters', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678');
    expect(normalizePhone('010 1234 5678')).toBe('01012345678');
    expect(normalizePhone('(02) 123-4567')).toBe('021234567');
  });

  it('returns an empty string for input with no digits', () => {
    expect(normalizePhone('abc')).toBe('');
  });
});

describe('maskPhone', () => {
  it('masks the middle segment of an 11-digit mobile number', () => {
    expect(maskPhone('01012345678')).toBe('010-****-5678');
  });

  it('masks the middle segment of a 10-digit number', () => {
    expect(maskPhone('0101234567')).toBe('010-***-4567');
  });

  it('masks a short number entirely', () => {
    expect(maskPhone('123')).toBe('***');
  });

  it('returns an empty string for empty input', () => {
    expect(maskPhone('')).toBe('');
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npx vitest run shared/phone.test.ts`
Expected: FAIL — `Cannot find module './phone'`.

- [ ] **Step 6: Write `shared/phone.ts`**

```ts
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function maskPhone(phoneNormalized: string): string {
  const digits = phoneNormalized.replace(/\D/g, '');

  if (digits.length === 0) return '';
  if (digits.length <= 4) return '*'.repeat(digits.length);
  if (digits.length < 7) {
    const tail = digits.slice(-4);
    return `${'*'.repeat(digits.length - 4)}-${tail}`;
  }

  const head = digits.slice(0, 3);
  const tail = digits.slice(-4);
  const middleLength = digits.length - head.length - tail.length;

  return middleLength > 0 ? `${head}-${'*'.repeat(middleLength)}-${tail}` : `${head}-${tail}`;
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run shared/phone.test.ts`
Expected: PASS — 6 tests passing.

- [ ] **Step 8: Write the failing test `shared/masking.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { maskName } from './masking';

describe('maskName', () => {
  it('masks the middle of a 3-character name, keeping first and last', () => {
    expect(maskName('김철수')).toBe('김*수');
  });

  it('masks every middle character of a 4-character name', () => {
    expect(maskName('김철수민')).toBe('김**민');
  });

  it('keeps only the first character of a 2-character name', () => {
    expect(maskName('이가')).toBe('이*');
  });

  it('fully masks a 1-character name', () => {
    expect(maskName('이')).toBe('*');
  });

  it('returns an empty string for empty input', () => {
    expect(maskName('')).toBe('');
  });
});
```

- [ ] **Step 9: Run to verify it fails**

Run: `npx vitest run shared/masking.test.ts`
Expected: FAIL — `Cannot find module './masking'`.

- [ ] **Step 10: Write `shared/masking.ts`**

```ts
export function maskName(name: string): string {
  const chars = Array.from(name);

  if (chars.length === 0) return '';
  if (chars.length === 1) return '*';
  if (chars.length === 2) return `${chars[0]}*`;

  const first = chars[0];
  const last = chars[chars.length - 1];
  const middle = '*'.repeat(chars.length - 2);

  return `${first}${middle}${last}`;
}
```

- [ ] **Step 11: Run to verify it passes**

Run: `npx vitest run shared/masking.test.ts`
Expected: PASS — 5 tests passing.

- [ ] **Step 12: Write the client re-exports**

`client/src/lib/phone.ts`:
```ts
export * from '../../../shared/phone';
```

`client/src/lib/masking.ts`:
```ts
export * from '../../../shared/masking';
```

- [ ] **Step 13: Run check**

Run: `npm run check`
Expected: clean.

- [ ] **Step 14: Commit**

```bash
git add shared/schema.ts shared/permissions.ts shared/phone.ts shared/phone.test.ts shared/masking.ts shared/masking.test.ts migrations client/src/lib/phone.ts client/src/lib/masking.ts
git commit -m "feat: add guardians schema, GUARDIANS_MANAGE permission, and phone/name masking utilities"
```

---

## Task 2: Guardians API — list (masked, search) + create (with duplicate warning)

**Files:**
- Create: `server/routes/guardians.ts`, `server/routes/guardians.test.ts`
- Modify: `server/app.ts`

**Interfaces:**
- Consumes: `guardians` table, `PERMISSIONS.GUARDIANS_MANAGE` (Task 1); `normalizePhone`/`maskPhone` from `@shared/phone`, `maskName` from `@shared/masking` (Task 1).
- Produces: `createGuardiansRouter(deps: { sessionSecret: string }): Router`, mounted at `/api/guardians`, with `GET /` and `POST /` in this task (Task 3 adds `GET /:id` and `PATCH /:id` to the same file). The create response shape `{ status: 'created'; guardian: SafeGuardian } | { status: 'duplicate_warning'; duplicates: Array<{ id: string; name: string; phoneNormalized: string }> }` is relied on by Task 4's client code — the `duplicates[].phoneNormalized` field is ALREADY MASKED by the server (via `maskPhone`), so the client must not attempt to mask it again.

- [ ] **Step 1: Write the failing test `server/routes/guardians.test.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, guardians } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-guardians-super@example.com';
const PASSWORD = 'test-guardians-password-123';
const TEST_GUARDIAN_NAME = 'test-guardian-김철수';
const TEST_GUARDIAN_PHONE = '01099998888';

async function seedSuperAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-guardians-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION] })
    .returning();
  await db.insert(admins).values({
    email: SUPER_EMAIL,
    name: '수퍼',
    passwordHash: await hashPassword(PASSWORD),
    roleId: role!.id,
    status: 'active',
  });
}

async function loginAs(app: ReturnType<typeof createApp>, email: string) {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return response.headers['set-cookie'][0];
}

async function cleanup() {
  await db.delete(guardians).where(eq(guardians.name, TEST_GUARDIAN_NAME));
  await db.delete(guardians).where(eq(guardians.phoneNormalized, TEST_GUARDIAN_PHONE));
  await db.delete(admins).where(eq(admins.email, SUPER_EMAIL));
  await db.delete(roles).where(eq(roles.name, 'test-guardians-role'));
}

describe('guardians routes — list and create', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/guardians');
    expect(response.status).toBe(401);
  });

  it('creates a guardian and returns it in the masked list', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/guardians')
      .set('Cookie', cookie)
      .send({ name: TEST_GUARDIAN_NAME, phone: '010-9999-8888', notes: '테스트' });

    expect(created.status).toBe(200);
    expect(created.body.data.status).toBe('created');
    expect(created.body.data.guardian.phoneNormalized).toBe(TEST_GUARDIAN_PHONE);

    const list = await request(app).get('/api/guardians').set('Cookie', cookie);
    expect(list.status).toBe(200);
    const found = list.body.data.find((g: { id: string }) => g.id === created.body.data.guardian.id);
    expect(found).toBeDefined();
    expect(found.name).toBe('test-guardian-김*수');
    expect(found.phoneNormalized).toBe('010-****-8888');
  });

  it('warns about a duplicate phone instead of creating, until confirmDuplicate is set', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app)
      .post('/api/guardians')
      .set('Cookie', cookie)
      .send({ name: TEST_GUARDIAN_NAME, phone: TEST_GUARDIAN_PHONE });

    const secondAttempt = await request(app)
      .post('/api/guardians')
      .set('Cookie', cookie)
      .send({ name: 'test-guardian-이영희', phone: TEST_GUARDIAN_PHONE });

    expect(secondAttempt.status).toBe(200);
    expect(secondAttempt.body.data.status).toBe('duplicate_warning');
    expect(secondAttempt.body.data.duplicates).toHaveLength(1);
    expect(secondAttempt.body.data.duplicates[0].phoneNormalized).toBe('010-****-8888');

    const listBeforeConfirm = await request(app).get('/api/guardians').set('Cookie', cookie);
    expect(listBeforeConfirm.body.data.filter((g: { phoneNormalized: string }) => g.phoneNormalized === '010-****-8888')).toHaveLength(1);

    const confirmed = await request(app)
      .post('/api/guardians')
      .set('Cookie', cookie)
      .send({ name: 'test-guardian-이영희', phone: TEST_GUARDIAN_PHONE, confirmDuplicate: true });

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe('created');

    await db.delete(guardians).where(and(eq(guardians.name, 'test-guardian-이영희'), eq(guardians.phoneNormalized, TEST_GUARDIAN_PHONE)));
  });

  it('searches the guardian list by name', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app).post('/api/guardians').set('Cookie', cookie).send({ name: TEST_GUARDIAN_NAME, phone: TEST_GUARDIAN_PHONE });

    const searchResult = await request(app).get('/api/guardians?search=김철수').set('Cookie', cookie);
    expect(searchResult.status).toBe(200);
    expect(searchResult.body.data.length).toBeGreaterThanOrEqual(1);

    const noResult = await request(app).get('/api/guardians?search=존재하지않는이름xyz').set('Cookie', cookie);
    expect(noResult.body.data).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/routes/guardians.test.ts`
Expected: FAIL — 404s (route doesn't exist yet).

- [ ] **Step 3: Write `server/routes/guardians.ts`**

```ts
import { and, eq, ilike, isNull, or } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { maskName } from '@shared/masking';
import { maskPhone, normalizePhone } from '@shared/phone';
import { db } from '../db';
import { guardians } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';

const listQuerySchema = z.object({
  search: z.string().optional(),
});

const createGuardianSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  notes: z.string().optional(),
  confirmDuplicate: z.boolean().optional(),
});

function toMaskedGuardian(guardian: typeof guardians.$inferSelect) {
  return {
    id: guardian.id,
    name: maskName(guardian.name),
    phoneNormalized: maskPhone(guardian.phoneNormalized),
    notes: guardian.notes,
    updatedAt: guardian.updatedAt,
  };
}

export interface GuardiansRouterDeps {
  sessionSecret: string;
}

export function createGuardiansRouter(deps: GuardiansRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireGuardiansManage = createRequirePermission(PERMISSIONS.GUARDIANS_MANAGE);

  router.get('/', requireAuth, requireGuardiansManage, async (req, res) => {
    const parsedQuery = listQuerySchema.safeParse(req.query);
    const search = parsedQuery.success ? parsedQuery.data.search : undefined;

    const conditions = [isNull(guardians.deletedAt)];
    if (search) {
      const normalizedSearch = normalizePhone(search);
      const searchConditions = [ilike(guardians.name, `%${search}%`)];
      if (normalizedSearch) {
        searchConditions.push(ilike(guardians.phoneNormalized, `%${normalizedSearch}%`));
      }
      conditions.push(or(...searchConditions)!);
    }

    const rows = await db
      .select()
      .from(guardians)
      .where(and(...conditions))
      .orderBy(guardians.name);

    res.json({
      data: rows.map(toMaskedGuardian),
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.post('/', requireAuth, requireGuardiansManage, async (req, res) => {
    const parsed = parseBody(createGuardianSchema, req.body, res, req.requestId);
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
        .from(guardians)
        .where(and(eq(guardians.phoneNormalized, phoneNormalized), isNull(guardians.deletedAt)));

      if (existingMatches.length > 0) {
        res.json({
          data: {
            status: 'duplicate_warning',
            duplicates: existingMatches.map((g) => ({ id: g.id, name: g.name, phoneNormalized: maskPhone(g.phoneNormalized) })),
          },
          meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
        });
        return;
      }
    }

    const [created] = await db
      .insert(guardians)
      .values({
        name: parsed.name,
        phoneNormalized,
        notes: parsed.notes,
        createdBy: req.admin!.id,
        updatedBy: req.admin!.id,
      })
      .returning();
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '보호자를 등록하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'guardian.create',
      targetType: 'guardian',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { name: created.name, phoneNormalized: maskPhone(created.phoneNormalized) },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({
      data: { status: 'created', guardian: created },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  return router;
}
```

- [ ] **Step 4: Mount the router in `server/app.ts`**

Add the import and mount line (alongside the existing `/api/schools` mount, before the `/api` health/404 mounts):
```ts
import { createGuardiansRouter } from './routes/guardians';
// ...
app.use('/api/guardians', createGuardiansRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run server/routes/guardians.test.ts`
Expected: PASS — 4 tests passing, against the real dev DB.

- [ ] **Step 6: Run check**

Run: `npm run check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add server/routes/guardians.ts server/routes/guardians.test.ts server/app.ts
git commit -m "feat: add guardians list/search and create API with duplicate-phone warning"
```

---

## Task 3: Guardians API — detail (unmasked) + update

**Files:**
- Modify: `server/routes/guardians.ts`, `server/routes/guardians.test.ts`

**Interfaces:**
- Consumes: everything from Task 2 (same file, extending it).
- Produces: `GET /:id` (full unmasked guardian) and `PATCH /:id` (update, with the same `{status: 'updated', guardian} | {status: 'duplicate_warning', duplicates}` shape as create) added to the same router — used by Task 5's client detail page.

- [ ] **Step 1: Write the failing test additions to `server/routes/guardians.test.ts`**

Add this `describe` block to the same file (keep the existing `describe('guardians routes — list and create', ...)` block and its helpers unchanged):

```ts
describe('guardians routes — detail and update', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('returns 404 for a missing guardian', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app).get('/api/guardians/00000000-0000-0000-0000-000000000000').set('Cookie', cookie);
    expect(response.status).toBe(404);
  });

  it('returns full unmasked data on the detail endpoint', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/guardians')
      .set('Cookie', cookie)
      .send({ name: TEST_GUARDIAN_NAME, phone: TEST_GUARDIAN_PHONE });

    const detail = await request(app).get(`/api/guardians/${created.body.data.guardian.id}`).set('Cookie', cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.data.name).toBe(TEST_GUARDIAN_NAME);
    expect(detail.body.data.phoneNormalized).toBe(TEST_GUARDIAN_PHONE);
  });

  it('updates a guardian with optimistic locking', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/guardians')
      .set('Cookie', cookie)
      .send({ name: TEST_GUARDIAN_NAME, phone: TEST_GUARDIAN_PHONE });

    const edited = await request(app)
      .patch(`/api/guardians/${created.body.data.guardian.id}`)
      .set('Cookie', cookie)
      .send({ notes: '수정된 메모', expectedUpdatedAt: created.body.data.guardian.updatedAt });

    expect(edited.status).toBe(200);
    expect(edited.body.data.status).toBe('updated');
    expect(edited.body.data.guardian.notes).toBe('수정된 메모');

    const staleEdit = await request(app)
      .patch(`/api/guardians/${created.body.data.guardian.id}`)
      .set('Cookie', cookie)
      .send({ notes: '또 수정', expectedUpdatedAt: created.body.data.guardian.updatedAt });

    expect(staleEdit.status).toBe(409);
    expect(staleEdit.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('warns about a duplicate phone on update, until confirmDuplicate is set', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app).post('/api/guardians').set('Cookie', cookie).send({ name: TEST_GUARDIAN_NAME, phone: TEST_GUARDIAN_PHONE });
    const second = await request(app)
      .post('/api/guardians')
      .set('Cookie', cookie)
      .send({ name: 'test-guardian-박민수', phone: '01077776666', confirmDuplicate: true });

    const attempt = await request(app)
      .patch(`/api/guardians/${second.body.data.guardian.id}`)
      .set('Cookie', cookie)
      .send({ phone: TEST_GUARDIAN_PHONE, expectedUpdatedAt: second.body.data.guardian.updatedAt });

    expect(attempt.status).toBe(200);
    expect(attempt.body.data.status).toBe('duplicate_warning');

    await db.delete(guardians).where(eq(guardians.name, 'test-guardian-박민수'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/routes/guardians.test.ts`
Expected: FAIL — the 4 new tests fail with 404s (`GET/PATCH /:id` don't exist yet); the 4 tests from Task 2 still pass.

- [ ] **Step 3: Extend `server/routes/guardians.ts`**

Add this import at the top (merge into the existing `drizzle-orm` import line — add `ne` to it):
```ts
import { and, eq, ilike, isNull, ne, or } from 'drizzle-orm';
```

Add this schema definition alongside `createGuardianSchema`:
```ts
const updateGuardianSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  notes: z.string().optional(),
  confirmDuplicate: z.boolean().optional(),
  expectedUpdatedAt: z.string(),
});
```

Add these two routes inside `createGuardiansRouter`, after the existing `POST /` route and before the closing `return router;`:

```ts
  router.get('/:id', requireAuth, requireGuardiansManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [guardian] = await db.select().from(guardians).where(eq(guardians.id, id));
    if (!guardian || guardian.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '보호자를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    res.json({ data: guardian, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/:id', requireAuth, requireGuardiansManage, async (req, res) => {
    const id = req.params.id;
    if (!id || Array.isArray(id)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateGuardianSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(guardians).where(eq(guardians.id, id));
    if (!before || before.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '보호자를 찾을 수 없습니다.', requestId: req.requestId } });
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
          .from(guardians)
          .where(and(eq(guardians.phoneNormalized, phoneNormalized), isNull(guardians.deletedAt), ne(guardians.id, id)));

        if (existingMatches.length > 0) {
          res.json({
            data: {
              status: 'duplicate_warning',
              duplicates: existingMatches.map((g) => ({ id: g.id, name: g.name, phoneNormalized: maskPhone(g.phoneNormalized) })),
            },
            meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
          });
          return;
        }
      }
    }

    const { expectedUpdatedAt: _expected, phone: _phone, confirmDuplicate: _confirm, ...rest } = parsed;
    const [updated] = await db
      .update(guardians)
      .set({
        ...rest,
        ...(phoneNormalized !== undefined ? { phoneNormalized } : {}),
        updatedBy: req.admin!.id,
        updatedAt: new Date(),
      })
      .where(eq(guardians.id, id))
      .returning();
    if (!updated) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '보호자를 수정하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'guardian.update',
      targetType: 'guardian',
      targetId: updated.id,
      beforeDataSafe: { name: before.name, phoneNormalized: maskPhone(before.phoneNormalized) },
      afterDataSafe: { name: updated.name, phoneNormalized: maskPhone(updated.phoneNormalized) },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({
      data: { status: 'updated', guardian: updated },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/routes/guardians.test.ts`
Expected: PASS — 8 tests passing (4 from Task 2 + 4 new).

- [ ] **Step 5: Run check**

Run: `npm run check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add server/routes/guardians.ts server/routes/guardians.test.ts
git commit -m "feat: add guardian detail and update API"
```

---

## Task 4: Client — guardian list, search, and create

**Files:**
- Create: `client/src/features/guardians/GuardianListPage.tsx`, `client/src/features/guardians/GuardianListPage.test.tsx`
- Modify: `client/src/routes.tsx`, `client/src/features/dashboard/AdminHomePage.tsx`, `client/src/features/dashboard/AdminHomePage.test.tsx`

**Interfaces:**
- Consumes: `apiGet`, `apiPost`, `ApiRequestError` from `client/src/lib/apiClient.ts` (existing); `ProtectedRoute` (existing).
- Produces: a rendered `/admin/guardians` page — consumed by Task 6's e2e test. `GuardianListPage` itself is not imported by any later task's code (Task 5 is a separate page), only linked to via `routes.tsx`.

- [ ] **Step 1: Write the failing test `client/src/features/guardians/GuardianListPage.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuardianListPage } from './GuardianListPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-15T00:00:00+09:00' } }),
  };
}

describe('GuardianListPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the guardian list and creates a new guardian', async () => {
    const guardiansState = [{ id: 'g1', name: '김*수', phoneNormalized: '010-****-5678', notes: null, updatedAt: '2026-08-15T00:00:00+09:00' }];

    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith('/api/guardians') && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(guardiansState));
      }
      if (path === '/api/guardians' && init?.method === 'POST') {
        const created = { id: 'g2', name: '새보호자', phoneNormalized: '01011112222', notes: null, updatedAt: '2026-08-15T00:05:00+09:00' };
        guardiansState.push({ id: 'g2', name: '새*자', phoneNormalized: '010-****-2222', notes: null, updatedAt: created.updatedAt });
        return Promise.resolve(jsonResponse({ status: 'created', guardian: created }));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<GuardianListPage />);

    await screen.findByText('김*수');

    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '새보호자' } });
    fireEvent.change(screen.getByLabelText('전화번호'), { target: { value: '010-1111-2222' } });
    fireEvent.click(screen.getByRole('button', { name: '보호자 등록' }));

    await waitFor(() => expect(screen.getByText('새*자')).toBeInTheDocument());
  });

  it('shows a duplicate warning and requires confirmation before creating', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path.startsWith('/api/guardians') && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse([]));
      }
      if (path === '/api/guardians' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string) as { confirmDuplicate?: boolean };
        if (!body.confirmDuplicate) {
          return Promise.resolve(
            jsonResponse({ status: 'duplicate_warning', duplicates: [{ id: 'g1', name: '김철수', phoneNormalized: '010-****-5678' }] })
          );
        }
        return Promise.resolve(
          jsonResponse({ status: 'created', guardian: { id: 'g3', name: '중복보호자', phoneNormalized: '01099998888', notes: null, updatedAt: '2026-08-15T00:00:00+09:00' } })
        );
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<GuardianListPage />);
    await screen.findByRole('button', { name: '보호자 등록' });

    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '중복보호자' } });
    fireEvent.change(screen.getByLabelText('전화번호'), { target: { value: '010-9999-8888' } });
    fireEvent.click(screen.getByRole('button', { name: '보호자 등록' }));

    await screen.findByText(/이미 등록된 전화번호/);
    expect(screen.getByText(/김철수/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '그래도 등록' }));

    await waitFor(() => expect(screen.queryByText(/이미 등록된 전화번호/)).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/src/features/guardians/GuardianListPage.test.tsx`
Expected: FAIL — `Cannot find module './GuardianListPage'`.

- [ ] **Step 3: Write `client/src/features/guardians/GuardianListPage.tsx`**

```tsx
import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ApiRequestError, apiGet, apiPost } from '../../lib/apiClient';

interface MaskedGuardian {
  id: string;
  name: string;
  phoneNormalized: string;
  notes: string | null;
  updatedAt: string;
}

interface DuplicateCandidate {
  id: string;
  name: string;
  phoneNormalized: string;
}

type CreateGuardianResponse =
  | { status: 'created'; guardian: { id: string } }
  | { status: 'duplicate_warning'; duplicates: DuplicateCandidate[] };

export function GuardianListPage() {
  const [guardians, setGuardians] = useState<MaskedGuardian[]>([]);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadGuardians(query?: string) {
    const path = query ? `/api/guardians?search=${encodeURIComponent(query)}` : '/api/guardians';
    setGuardians(await apiGet<MaskedGuardian[]>(path));
  }

  useEffect(() => {
    loadGuardians().catch((err: unknown) => {
      setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
    });
  }, []);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await loadGuardians(search);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '검색하지 못했습니다.');
    }
  }

  async function submitCreate(confirmDuplicate: boolean) {
    setError(null);
    try {
      const response = await apiPost<CreateGuardianResponse>('/api/guardians', { name, phone, notes, confirmDuplicate });
      if (response.status === 'duplicate_warning') {
        setDuplicates(response.duplicates);
        return;
      }
      setDuplicates(null);
      setName('');
      setPhone('');
      setNotes('');
      await loadGuardians(search);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '보호자를 등록하지 못했습니다.');
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitCreate(false);
  }

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">보호자 관리</h1>
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
        {guardians.map((guardian) => (
          <li key={guardian.id} className="rounded border border-gray-200 p-2">
            <Link href={`/admin/guardians/${guardian.id}`} className="text-blue-600 underline">
              {guardian.name}
            </Link>
            <span className="ml-2 text-gray-600">{guardian.phoneNormalized}</span>
          </li>
        ))}
      </ul>

      <form onSubmit={handleCreate} className="mt-6 flex flex-col gap-3 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-medium">새 보호자 등록</h2>
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
          <span>메모</span>
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>

        {duplicates && duplicates.length > 0 && (
          <div role="alert" className="rounded border border-yellow-400 bg-yellow-50 p-3 text-sm">
            <p>이미 등록된 전화번호와 일치하는 보호자가 있습니다:</p>
            <ul className="mt-1 list-disc pl-5">
              {duplicates.map((candidate) => (
                <li key={candidate.id}>
                  {candidate.name} ({candidate.phoneNormalized})
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => submitCreate(true)}
              className="mt-2 rounded bg-yellow-500 px-3 py-1 text-white"
            >
              그래도 등록
            </button>
          </div>
        )}

        <button type="submit" className="self-start rounded bg-blue-600 px-4 py-2 text-white">
          보호자 등록
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/src/features/guardians/GuardianListPage.test.tsx`
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Add the `/admin/guardians` route to `client/src/routes.tsx`**

Add the import `import { GuardianListPage } from './features/guardians/GuardianListPage';` and a new route, inserted after the `/admin/settings/academics` route and before the closing `</Switch>`:

```tsx
      <Route path="/admin/guardians">
        <ProtectedRoute>
          <GuardianListPage />
        </ProtectedRoute>
      </Route>
```

(Task 5 adds `/admin/guardians/:guardianId` right after this one, in the same file.)

- [ ] **Step 6: Add a nav link to `client/src/features/dashboard/AdminHomePage.tsx`**

Add a new `<li>` to the existing `<ul>` inside `<nav>`, after the "학교·학년 기준정보" link and before "내 계정":

```tsx
          <li>
            <Link href="/admin/guardians" className="text-blue-600 underline">
              보호자 관리
            </Link>
          </li>
```

Update the existing test `client/src/features/dashboard/AdminHomePage.test.tsx` to also assert this new link is present (find the existing test that checks for the other nav links and add a matching assertion, e.g. `expect(screen.getByRole('link', { name: '보호자 관리' })).toHaveAttribute('href', '/admin/guardians');`).

- [ ] **Step 7: Run check and the full client test suite**

Run:
```bash
npm run check
npx vitest run
```
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add client/src/features/guardians/GuardianListPage.tsx client/src/features/guardians/GuardianListPage.test.tsx client/src/routes.tsx client/src/features/dashboard/AdminHomePage.tsx client/src/features/dashboard/AdminHomePage.test.tsx
git commit -m "feat: add guardian list, search, and create client page"
```

---

## Task 5: Client — guardian detail and edit

**Files:**
- Create: `client/src/features/guardians/GuardianDetailPage.tsx`, `client/src/features/guardians/GuardianDetailPage.test.tsx`
- Modify: `client/src/routes.tsx`

**Interfaces:**
- Consumes: `apiGet`, `apiPatch`, `ApiRequestError` from `client/src/lib/apiClient.ts`; `useParams` from `wouter`.
- Produces: a rendered `/admin/guardians/:guardianId` page — consumed by Task 6's e2e test.

- [ ] **Step 1: Write the failing test `client/src/features/guardians/GuardianDetailPage.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { GuardianDetailPage } from './GuardianDetailPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-15T00:00:00+09:00' } }),
  };
}

function renderAtGuardianDetail(guardianId: string) {
  const { hook } = memoryLocation({ path: `/admin/guardians/${guardianId}`, static: true });
  return render(
    <Router hook={hook}>
      <GuardianDetailPage />
    </Router>
  );
}

describe('GuardianDetailPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the full unmasked guardian and saves an edit', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'g1', name: '김철수', phoneNormalized: '01012345678', notes: '기존 메모', updatedAt: '2026-08-15T00:00:00+09:00' })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'updated', guardian: { id: 'g1', name: '김철수', phoneNormalized: '01012345678', notes: '새 메모', updatedAt: '2026-08-15T00:10:00+09:00' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    renderAtGuardianDetail('g1');

    const notesInput = await screen.findByLabelText('메모');
    expect(notesInput).toHaveValue('기존 메모');

    fireEvent.change(notesInput, { target: { value: '새 메모' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(screen.getByText('저장되었습니다.')).toBeInTheDocument());
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: 'PATCH' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/src/features/guardians/GuardianDetailPage.test.tsx`
Expected: FAIL — `Cannot find module './GuardianDetailPage'`. (If `wouter/memory-location` doesn't exist in the installed version, check the installed `wouter` version's actual in-memory router test helper — this exact import already works elsewhere in this codebase, e.g. `client/src/components/layout/ProtectedRoute.test.tsx`, so copy the working pattern from there instead of guessing.)

- [ ] **Step 3: Write `client/src/features/guardians/GuardianDetailPage.tsx`**

```tsx
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { ApiRequestError, apiGet, apiPatch } from '../../lib/apiClient';

interface Guardian {
  id: string;
  name: string;
  phoneNormalized: string;
  notes: string | null;
  updatedAt: string;
}

interface DuplicateCandidate {
  id: string;
  name: string;
  phoneNormalized: string;
}

type UpdateGuardianResponse =
  | { status: 'updated'; guardian: Guardian }
  | { status: 'duplicate_warning'; duplicates: DuplicateCandidate[] };

export function GuardianDetailPage() {
  const params = useParams<{ guardianId: string }>();
  const guardianId = params.guardianId;

  const [guardian, setGuardian] = useState<Guardian | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!guardianId) return;
    apiGet<Guardian>(`/api/guardians/${guardianId}`)
      .then((data) => {
        setGuardian(data);
        setName(data.name);
        setPhone(data.phoneNormalized);
        setNotes(data.notes ?? '');
        setStatus('idle');
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
        setStatus('error');
      });
  }, [guardianId]);

  async function submitUpdate(confirmDuplicate: boolean) {
    if (!guardian) return;
    setStatus('saving');
    setError(null);
    try {
      const response = await apiPatch<UpdateGuardianResponse>(`/api/guardians/${guardian.id}`, {
        name,
        phone,
        notes,
        confirmDuplicate,
        expectedUpdatedAt: guardian.updatedAt,
      });
      if (response.status === 'duplicate_warning') {
        setDuplicates(response.duplicates);
        setStatus('idle');
        return;
      }
      setDuplicates(null);
      setGuardian(response.guardian);
      setStatus('saved');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '저장하지 못했습니다.');
      setStatus('error');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitUpdate(false);
  }

  if (status === 'loading') return <p className="p-4 text-gray-500">불러오는 중...</p>;
  if (!guardian) return null;

  return (
    <section className="p-4">
      <Link href="/admin/guardians" className="text-blue-600 underline">
        목록으로
      </Link>
      <h1 className="mt-2 text-xl font-semibold">보호자 상세</h1>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
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
          <span>메모</span>
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>

        {duplicates && duplicates.length > 0 && (
          <div role="alert" className="rounded border border-yellow-400 bg-yellow-50 p-3 text-sm">
            <p>이미 등록된 전화번호와 일치하는 보호자가 있습니다:</p>
            <ul className="mt-1 list-disc pl-5">
              {duplicates.map((candidate) => (
                <li key={candidate.id}>
                  {candidate.name} ({candidate.phoneNormalized})
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => submitUpdate(true)}
              className="mt-2 rounded bg-yellow-500 px-3 py-1 text-white"
            >
              그래도 저장
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {status === 'saved' && <p className="text-sm text-green-700">저장되었습니다.</p>}

        <button
          type="submit"
          disabled={status === 'saving'}
          className="self-start rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          저장
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/src/features/guardians/GuardianDetailPage.test.tsx`
Expected: PASS — 1 test passing.

- [ ] **Step 5: Add the route to `client/src/routes.tsx`**

Add the import `import { GuardianDetailPage } from './features/guardians/GuardianDetailPage';` and a new route, right after the `/admin/guardians` route added in Task 4:

```tsx
      <Route path="/admin/guardians/:guardianId">
        <ProtectedRoute>
          <GuardianDetailPage />
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
git add client/src/features/guardians/GuardianDetailPage.tsx client/src/features/guardians/GuardianDetailPage.test.tsx client/src/routes.tsx
git commit -m "feat: add guardian detail and edit client page"
```

---

## Task 6: End-to-end verification and full check

**Files:**
- Create: `tests/e2e/guardians.spec.ts`

**Interfaces:**
- Consumes: the running app from `npm run dev`, and `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD` from `.env` (already loaded into the Playwright process).

- [ ] **Step 1: Write `tests/e2e/guardians.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('logs in, creates a guardian, edits it, and confirms a duplicate-phone warning', async ({ page }) => {
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

  await page.getByRole('link', { name: '보호자 관리' }).click();
  await expect(page).toHaveURL(/\/admin\/guardians$/);

  const guardianName = `e2e보호자${Date.now()}`;
  const guardianPhone = `010${Date.now().toString().slice(-8)}`;

  await page.getByLabel('이름').fill(guardianName);
  await page.getByLabel('전화번호').fill(guardianPhone);
  await page.getByRole('button', { name: '보호자 등록' }).click();

  const maskedName = `${Array.from(guardianName)[0]}${'*'.repeat(Array.from(guardianName).length - 2)}${Array.from(guardianName)[Array.from(guardianName).length - 1]}`;
  await expect(page.getByText(maskedName)).toBeVisible();

  await page.getByRole('link', { name: maskedName }).click();
  await expect(page).toHaveURL(/\/admin\/guardians\/.+/);
  await expect(page.getByLabel('이름')).toHaveValue(guardianName);

  await page.getByLabel('메모').fill('e2e 테스트 메모');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('저장되었습니다.')).toBeVisible();

  await page.getByRole('link', { name: '목록으로' }).click();
  await expect(page).toHaveURL(/\/admin\/guardians$/);

  const secondGuardianName = `e2e보호자2-${Date.now()}`;
  await page.getByLabel('이름').fill(secondGuardianName);
  await page.getByLabel('전화번호').fill(guardianPhone);
  await page.getByRole('button', { name: '보호자 등록' }).click();

  await expect(page.getByText(/이미 등록된 전화번호/)).toBeVisible();
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `npm run test:e2e`
Expected: PASS — includes all pre-existing e2e specs from prior plans plus this new one.

- [ ] **Step 3: Run the full unit/integration suite, check, and build**

Run:
```bash
npx vitest run
npm run check
npm run build
```
Expected: all clean.

- [ ] **Step 4: Manual verification and cleanup**

Run `npm run dev`, log in with `.env`'s credentials, visit `/admin/guardians`, add a guardian, click into its detail page, edit it, go back, and try creating another guardian with the same phone to see the duplicate warning. Stop the dev server afterward and verify via `netstat -ano | grep -E ":5173|:8787"` and a process listing that nothing is left running — show the actual re-check output in your report, not just a claim (this project's history has repeatedly caught false "it's stopped" claims — be the one that actually shows real evidence).

- [ ] **Step 5: Commit and push**

```bash
git add tests/e2e/guardians.spec.ts
git commit -m "test: add end-to-end coverage for guardian create, edit, and duplicate-phone warning"
git push
git status
```
Expected: `git status` reports a clean working tree, up to date with `origin/main`.
