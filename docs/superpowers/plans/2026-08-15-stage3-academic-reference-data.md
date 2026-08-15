# Stage 3: Academy Settings & Academic Reference Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the academy's own basic info (name/phone/address/sender name) and the school/grade-level reference data that students will later be classified by — full CRUD, server-enforced permissions, audit logging, and a client UI — verified against the real local dev database.

**Architecture:** Three new tables (`academy_settings` — always exactly one row, lazily created; `schools`; `grade_levels`) follow the exact conventions already established in Stage 2's `admins`/`roles` routes: Zod validation, `parseBody`, optimistic locking via `expectedUpdatedAt`/`VERSION_CONFLICT`, `writeAuditLog` on every mutation, and a single new permission (`academy:manage`) gating all of it. `client/src/lib/apiClient.ts` gains `apiPatch`/`apiDelete` (this is the first stage needing them).

**Tech Stack:** Same as Stage 1/2 — Drizzle ORM, Express 5, Zod, React 19/Vite, Vitest, Playwright.

**Spec:** [`../../../academy_automation_final_development_prompt.md`](../../../academy_automation_final_development_prompt.md) — this plan implements the `academy_settings`/`schools`/`grade_levels` portions of §9.3, the settings/schools/grade-levels portion of §12.2, and the "학원, 학교, 학년" portion of §18 Stage 3 (the "관리자 관리" portion of that stage was already built in Stage 2, and "학생·보호자·동의·수신거부" is deliberately deferred to a following plan — see Global Constraints).

**Prior plans:** [`2026-08-14-stage1-base-project.md`](2026-08-14-stage1-base-project.md), [`2026-08-14-stage2-db-auth.md`](2026-08-14-stage2-db-auth.md) — read these if you need context on existing files (`server/routes/admins.ts` in particular is the pattern this plan's routes copy almost exactly; `client/src/features/settings/ProfilePage.tsx` is the pattern this plan's client pages copy).

## Global Constraints

- KST (`Asia/Seoul`) for all timestamps — use `getNowKSTISOString` from `@shared/kst` in every API response, matching every existing route.
- API envelope is `{ data, meta: { requestId, kstTimestamp } }` / `{ error: { code, message, fieldErrors?, requestId } }` (`shared/types.ts`).
- Error codes: `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 VERSION_CONFLICT` (optimistic-lock conflict — do not reuse for other 409 situations), `409 IN_USE` (new in this plan — a school/grade level a future table references cannot be hard-deleted; not in spec's §14.2 table but a reasonable extension of it, following the same pattern as this plan's own precedent-setting `LAST_SUPER_ADMIN` code from Stage 2).
- **Every mutating route requires both `requireAuth` and `requirePermission(PERMISSIONS.ACADEMY_MANAGE)`** — copy the exact middleware chain pattern from `server/routes/admins.ts`.
- **Every create/update/delete writes an audit log row** via `writeAuditLog` (`server/services/audit.ts`, already built) — actor, KST timestamp, target, safe before/after values, request id. No secrets in audit data (not a concern here — none of these tables hold secrets).
- **Every PATCH endpoint uses optimistic locking**: the request body requires `expectedUpdatedAt: string`, compared against the row's current `updatedAt.toISOString()`, rejecting with `409 VERSION_CONFLICT` on mismatch — copy this exact pattern from `server/routes/admins.ts`'s `PATCH /:id`. (Stage 2's final review flagged `roles.ts` for originally missing this same pattern — don't repeat that gap here.)
- **`schools`/`grade_levels` active-name uniqueness**: spec §9.3 requires "활성 이름의 중복을 방지하는 인덱스" (prevent duplicate names among active rows) — implement as a partial unique index (`WHERE is_active = true`), not a table-wide unique constraint, so a renamed-and-reused name doesn't collide with an inactive historical row.
- **DELETE is a genuine hard delete, gated on non-use.** Nothing references `schools`/`grade_levels` yet in this codebase (the `students` table doesn't exist until a later plan), so every DELETE in this plan will succeed today — but write the handler to catch a foreign-key violation and respond `409 IN_USE` with a message suggesting deactivation instead, so it's correct once `students` exists and references these tables. Do not attempt to detect "in use" any other way (e.g. don't add a manual reference-count query against a table that doesn't exist).
- **`academy_settings` is a true singleton** — never insert a second row. `GET`/`PATCH` both lazily create the one row if it doesn't exist yet (mirroring the lazy-creation shape of Stage 2's admin bootstrap, but simpler — no idempotency race handling needed here since this plan doesn't add a startup hook, just an on-request lazy-create).
- No separate test DB — every server-side integration test in this plan hits the real local dev `DATABASE_URL` and must clean up its own rows. This plan's tables have no admin-referencing foreign keys of their own to worry about (only `createdBy`/`updatedBy`/`audit_logs.targetId` reference `admins.id`, and none of those are `NOT NULL` with cascading deletes that would block admin cleanup) — but any test admin/role you seed to authenticate as still needs the exact FK-safe cleanup order established in Stage 2 (`auth_sessions` → `admins` → `roles`) if it logs in for real.
- Never touch, modify, or delete the real bootstrapped super-admin (`.env`'s `INITIAL_ADMIN_EMAIL`) in any test.
- Every test constructing `createApp(...)` must pass an explicit fake email adapter (`createApp({ emailAdapter: createFakeEmailAdapter() })`) — this codebase's invariant from Stage 2, still binding even though this plan's routes never send email.
- Library API syntax (Drizzle's partial-index builder in particular) can shift between versions — install nothing new for this plan (all dependencies already exist), but if the `uniqueIndex(...).on(...).where(...)` snippet below doesn't compile against the already-installed `drizzle-orm` version, check its actual type definitions and adjust while preserving the same intent (a partial unique index on `name` where `is_active = true`), noting any such deviation in your report.
- `npm run check` must be clean after every task — this project's history (both prior plans) shows skipping this lets bugs accumulate silently for many tasks in a row. No exceptions.

---

## File Structure

```
migrations/                       # new migration generated by drizzle-kit

shared/
  schema.ts                       # modified: add academySettings, schools, gradeLevels tables
  permissions.ts                  # modified: add PERMISSIONS.ACADEMY_MANAGE

server/
  routes/
    academySettings.ts / .test.ts
    schools.ts / .test.ts
    gradeLevels.ts / .test.ts
  app.ts                          # modified: mount the three new routers

client/
  src/
    lib/
      apiClient.ts / .test.ts     # modified: add apiPatch/apiDelete
    features/
      settings/
        AcademySettingsPage.tsx / .test.tsx
        AcademicsSettingsPage.tsx / .test.tsx
    routes.tsx                    # modified: add /admin/settings/academy, /admin/settings/academics

tests/
  e2e/
    academics-settings.spec.ts
```

---

## Task 1: Schema, migration, permission constant, apiPatch/apiDelete

**Files:**
- Modify: `shared/schema.ts`, `shared/permissions.ts`, `client/src/lib/apiClient.ts`, `client/src/lib/apiClient.test.ts`
- Migration output: `migrations/` (generated, then committed)

**Interfaces:**
- Consumes: nothing new.
- Produces: `academySettings`, `schools`, `gradeLevels` Drizzle tables from `shared/schema.ts` (imported as `@shared/schema`) — used by Tasks 2-4. `PERMISSIONS.ACADEMY_MANAGE` from `@shared/permissions` — used by Tasks 2-4. `apiPatch<T>(path: string, body: unknown): Promise<T>` and `apiDelete<T>(path: string): Promise<T>` from `client/src/lib/apiClient.ts` — used by Task 5.

- [ ] **Step 1: Add the three tables to `shared/schema.ts`**

Add these imports to the existing `import { ... } from 'drizzle-orm/pg-core';` line at the top of the file (merge with what's already imported — currently `boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid`; this task needs the same set, nothing new from `pg-core`), and add a new import line:

```ts
import { sql } from 'drizzle-orm';
```

Then append these three table definitions to the end of the file (after `auditLogs`):

```ts
export const academySettings = pgTable('academy_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  academyName: text('academy_name').notNull(),
  phoneNormalized: text('phone_normalized'),
  address: text('address'),
  senderName: text('sender_name'),
  logoMediaId: text('logo_media_id'),
  brandColors: jsonb('brand_colors'),
  brandFonts: jsonb('brand_fonts'),
  updatedBy: uuid('updated_by').references(() => admins.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schools = pgTable(
  'schools',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    region: text('region'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => admins.id),
    updatedBy: uuid('updated_by').references(() => admins.id),
  },
  (table) => [
    uniqueIndex('schools_active_name_unique')
      .on(table.name)
      .where(sql`${table.isActive} = true`),
  ]
);

export const gradeLevels = pgTable(
  'grade_levels',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => admins.id),
    updatedBy: uuid('updated_by').references(() => admins.id),
  },
  (table) => [
    uniqueIndex('grade_levels_active_name_unique')
      .on(table.name)
      .where(sql`${table.isActive} = true`),
  ]
);
```

- [ ] **Step 2: Add the permission constant to `shared/permissions.ts`**

Change:
```ts
export const PERMISSIONS = {
  ADMINS_MANAGE: 'admins:manage',
  ROLES_MANAGE: 'roles:manage',
} as const;
```
to:
```ts
export const PERMISSIONS = {
  ADMINS_MANAGE: 'admins:manage',
  ROLES_MANAGE: 'roles:manage',
  ACADEMY_MANAGE: 'academy:manage',
} as const;
```

- [ ] **Step 3: Generate and apply the migration against the real local dev DB**

Run:
```bash
npm run db:generate
npm run db:migrate
```
Expected: `db:generate` writes new SQL under `migrations/`; `db:migrate` prints `Migrations applied.` with no errors, against the real dev Neon database. If this fails, stop and report — do not proceed with a broken migration.

- [ ] **Step 4: Verify the tables exist**

Run a read-only check (any method — e.g. a throwaway script using `pg` directly, deleted afterward) confirming `academy_settings`, `schools`, `grade_levels` now appear in `information_schema.tables`. Leave no stray files (`git status` clean).

- [ ] **Step 5: Write the failing test additions to `client/src/lib/apiClient.test.ts`**

Add these two `describe` blocks (alongside the existing `apiGet`/`apiPost` blocks — do not remove or alter the existing tests):

```ts
describe('apiPatch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a JSON body via PATCH and returns the data payload on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { id: '1', name: 'updated' },
        meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:30:00+09:00' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiPatch('/api/schools/1', { name: 'updated' })).resolves.toEqual({
      id: '1',
      name: 'updated',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/schools/1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'updated' }) })
    );
  });

  it('throws ApiRequestError with the server-provided code and message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { code: 'VERSION_CONFLICT', message: '다른 곳에서 이미 변경되었습니다.', requestId: 'req-2' },
        }),
      })
    );

    await expect(apiPatch('/api/schools/1', {})).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe('apiDelete', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a DELETE request and returns the data payload on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { success: true },
        meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:30:00+09:00' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiDelete('/api/schools/1')).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/schools/1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('throws ApiRequestError with the server-provided code and message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { code: 'IN_USE', message: '사용 중입니다.', requestId: 'req-2' },
        }),
      })
    );

    await expect(apiDelete('/api/schools/1')).rejects.toBeInstanceOf(ApiRequestError);
  });
});
```

Add `apiPatch, apiDelete` to the existing `import { apiGet, apiPost, ApiRequestError } from './apiClient';` line at the top of the test file.

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run client/src/lib/apiClient.test.ts`
Expected: FAIL — `apiPatch`/`apiDelete` are not exported from `./apiClient`.

- [ ] **Step 7: Add `apiPatch` and `apiDelete` to `client/src/lib/apiClient.ts`**

Append to the end of the file (after the existing `apiPost`):

```ts
export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });

  let parsed: ApiResponse<T>;
  try {
    parsed = (await response.json()) as ApiResponse<T>;
  } catch {
    throwInvalidResponse();
  }

  if (!response.ok || 'error' in parsed) {
    const errorBody = (parsed as Extract<ApiResponse<T>, { error: unknown }> | undefined)?.error;
    if (!errorBody) {
      throwInvalidResponse();
    }
    throw new ApiRequestError(errorBody.message, errorBody.code, errorBody.requestId ?? '');
  }

  if (!('data' in parsed)) {
    throwInvalidResponse();
  }

  return parsed.data;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });

  let parsed: ApiResponse<T>;
  try {
    parsed = (await response.json()) as ApiResponse<T>;
  } catch {
    throwInvalidResponse();
  }

  if (!response.ok || 'error' in parsed) {
    const errorBody = (parsed as Extract<ApiResponse<T>, { error: unknown }> | undefined)?.error;
    if (!errorBody) {
      throwInvalidResponse();
    }
    throw new ApiRequestError(errorBody.message, errorBody.code, errorBody.requestId ?? '');
  }

  if (!('data' in parsed)) {
    throwInvalidResponse();
  }

  return parsed.data;
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run client/src/lib/apiClient.test.ts`
Expected: PASS — all tests (existing `apiGet`/`apiPost` + new `apiPatch`/`apiDelete`) passing.

- [ ] **Step 9: Run check**

Run: `npm run check`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add shared/schema.ts shared/permissions.ts migrations client/src/lib/apiClient.ts client/src/lib/apiClient.test.ts
git commit -m "feat: add academy settings, schools, and grade levels schema; apiPatch/apiDelete"
```

---

## Task 2: Academy settings API

**Files:**
- Create: `server/routes/academySettings.ts`, `server/routes/academySettings.test.ts`
- Modify: `server/app.ts`

**Interfaces:**
- Consumes: `academySettings` table, `PERMISSIONS.ACADEMY_MANAGE` (Task 1); `createRequireAuth`, `createRequirePermission`, `writeAuditLog`, `parseBody`, `getNowKSTISOString` (all already built in Stage 1/2).
- Produces: `createAcademySettingsRouter(deps: { sessionSecret: string }): Router`, mounted at `/api/settings/academy` — no other task in this plan depends on it, but it establishes the singleton-lazy-create pattern.

- [ ] **Step 1: Write the failing test `server/routes/academySettings.test.ts`**

```ts
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, academySettings } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { PERMISSIONS, SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-academy-settings-super@example.com';
const PASSWORD = 'test-academy-settings-password-123';

async function seedSuperAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-academy-settings-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION] })
    .returning();
  await db.insert(admins).values({
    email: SUPER_EMAIL,
    name: '수퍼',
    passwordHash: await hashPassword(PASSWORD),
    roleId: role!.id,
    status: 'active',
  });
  return { role: role! };
}

async function loginAs(app: ReturnType<typeof createApp>, email: string) {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return response.headers['set-cookie'][0];
}

async function cleanup() {
  await db.delete(admins).where(eq(admins.email, SUPER_EMAIL));
  await db.delete(roles).where(eq(roles.name, 'test-academy-settings-role'));
}

describe('academy settings routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/settings/academy');
    expect(response.status).toBe(401);
  });

  it('lazily creates the single settings row on first GET, then returns the same row on subsequent calls', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const first = await request(app).get('/api/settings/academy').set('Cookie', cookie);
    expect(first.status).toBe(200);
    expect(first.body.data.id).toEqual(expect.any(String));

    const second = await request(app).get('/api/settings/academy').set('Cookie', cookie);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);

    const rows = await db.select().from(academySettings);
    expect(rows).toHaveLength(1);
  });

  it('updates the settings and reflects the change on the next GET', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app).get('/api/settings/academy').set('Cookie', cookie);

    const patchResponse = await request(app)
      .patch('/api/settings/academy')
      .set('Cookie', cookie)
      .send({ academyName: '강남 학원', phoneNormalized: '0212345678' });
    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.data.academyName).toBe('강남 학원');

    const getResponse = await request(app).get('/api/settings/academy').set('Cookie', cookie);
    expect(getResponse.body.data.academyName).toBe('강남 학원');
    expect(getResponse.body.data.phoneNormalized).toBe('0212345678');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/routes/academySettings.test.ts`
Expected: FAIL — 404s (route doesn't exist yet).

- [ ] **Step 3: Write `server/routes/academySettings.ts`**

```ts
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { academySettings } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';

const DEFAULT_ACADEMY_NAME = '학원';

const updateAcademySettingsSchema = z.object({
  academyName: z.string().min(1).optional(),
  phoneNormalized: z.string().optional(),
  address: z.string().optional(),
  senderName: z.string().optional(),
});

async function getOrCreateAcademySettings() {
  const [existing] = await db.select().from(academySettings).limit(1);
  if (existing) return existing;

  const [created] = await db.insert(academySettings).values({ academyName: DEFAULT_ACADEMY_NAME }).returning();
  if (!created) {
    throw new Error('Failed to create the default academy settings row.');
  }
  return created;
}

export interface AcademySettingsRouterDeps {
  sessionSecret: string;
}

export function createAcademySettingsRouter(deps: AcademySettingsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireAcademyManage = createRequirePermission(PERMISSIONS.ACADEMY_MANAGE);

  router.get('/', requireAuth, requireAcademyManage, async (req, res) => {
    const settings = await getOrCreateAcademySettings();
    res.json({ data: settings, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/', requireAuth, requireAcademyManage, async (req, res) => {
    const parsed = parseBody(updateAcademySettingsSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const settings = await getOrCreateAcademySettings();
    const [updated] = await db
      .update(academySettings)
      .set({ ...parsed, updatedBy: req.admin!.id, updatedAt: new Date() })
      .where(eq(academySettings.id, settings.id))
      .returning();
    if (!updated) {
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: '설정을 저장하지 못했습니다.', requestId: req.requestId },
      });
      return;
    }

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
```

- [ ] **Step 4: Mount the router in `server/app.ts`**

Add the import and mount line (alongside the existing `/api/admins` mount, before the `/api` health/404 mounts):
```ts
import { createAcademySettingsRouter } from './routes/academySettings';
// ...
app.use('/api/settings/academy', createAcademySettingsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run server/routes/academySettings.test.ts`
Expected: PASS — 3 tests passing, against the real dev DB.

- [ ] **Step 6: Run check**

Run: `npm run check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add server/routes/academySettings.ts server/routes/academySettings.test.ts server/app.ts
git commit -m "feat: add academy settings API"
```

---

## Task 3: Schools API

**Files:**
- Create: `server/routes/schools.ts`, `server/routes/schools.test.ts`
- Modify: `server/app.ts`

**Interfaces:**
- Consumes: `schools` table, `PERMISSIONS.ACADEMY_MANAGE` (Task 1).
- Produces: `createSchoolsRouter(deps: { sessionSecret: string }): Router`, mounted at `/api/schools`.

- [ ] **Step 1: Write the failing test `server/routes/schools.test.ts`**

```ts
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, schools } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-schools-super@example.com';
const PASSWORD = 'test-schools-password-123';
const TEST_SCHOOL_NAME = 'test-school-일반중학교';
const TEST_SCHOOL_NAME_2 = 'test-school-이름변경중학교';

async function seedSuperAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-schools-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION] })
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
  await db.delete(schools).where(eq(schools.name, TEST_SCHOOL_NAME));
  await db.delete(schools).where(eq(schools.name, TEST_SCHOOL_NAME_2));
  await db.delete(admins).where(eq(admins.email, SUPER_EMAIL));
  await db.delete(roles).where(eq(roles.name, 'test-schools-role'));
}

describe('schools routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/schools');
    expect(response.status).toBe(401);
  });

  it('creates, lists, edits, and deletes a school end to end', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/schools')
      .set('Cookie', cookie)
      .send({ name: TEST_SCHOOL_NAME, region: '서울 강남구', sortOrder: 1 });
    expect(created.status).toBe(200);
    expect(created.body.data.name).toBe(TEST_SCHOOL_NAME);
    expect(created.body.data.isActive).toBe(true);

    const list = await request(app).get('/api/schools').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.data.some((s: { id: string }) => s.id === created.body.data.id)).toBe(true);

    const edited = await request(app)
      .patch(`/api/schools/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ name: TEST_SCHOOL_NAME_2, expectedUpdatedAt: created.body.data.updatedAt });
    expect(edited.status).toBe(200);
    expect(edited.body.data.name).toBe(TEST_SCHOOL_NAME_2);

    const staleEdit = await request(app)
      .patch(`/api/schools/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ name: 'test-school-또변경', expectedUpdatedAt: created.body.data.updatedAt });
    expect(staleEdit.status).toBe(409);
    expect(staleEdit.body.error.code).toBe('VERSION_CONFLICT');

    const deleted = await request(app).delete(`/api/schools/${created.body.data.id}`).set('Cookie', cookie);
    expect(deleted.status).toBe(200);

    const listAfterDelete = await request(app).get('/api/schools').set('Cookie', cookie);
    expect(listAfterDelete.body.data.some((s: { id: string }) => s.id === created.body.data.id)).toBe(false);
  });

  it('rejects creating a second active school with the same name', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app).post('/api/schools').set('Cookie', cookie).send({ name: TEST_SCHOOL_NAME });
    const duplicate = await request(app).post('/api/schools').set('Cookie', cookie).send({ name: TEST_SCHOOL_NAME });

    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('can deactivate a school via PATCH without deleting it', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app).post('/api/schools').set('Cookie', cookie).send({ name: TEST_SCHOOL_NAME });

    const deactivated = await request(app)
      .patch(`/api/schools/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ isActive: false, expectedUpdatedAt: created.body.data.updatedAt });

    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.isActive).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/routes/schools.test.ts`
Expected: FAIL — 404s (route doesn't exist yet).

- [ ] **Step 3: Write `server/routes/schools.ts`**

```ts
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { schools } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';

const createSchoolSchema = z.object({
  name: z.string().min(1),
  region: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

const updateSchoolSchema = z.object({
  name: z.string().min(1).optional(),
  region: z.string().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  expectedUpdatedAt: z.string(),
});

function isUniqueViolation(error: unknown, indexName: string): boolean {
  return error instanceof Error && error.message.includes(indexName);
}

export interface SchoolsRouterDeps {
  sessionSecret: string;
}

export function createSchoolsRouter(deps: SchoolsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireAcademyManage = createRequirePermission(PERMISSIONS.ACADEMY_MANAGE);

  router.get('/', requireAuth, requireAcademyManage, async (req, res) => {
    const rows = await db.select().from(schools).orderBy(schools.sortOrder);
    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/', requireAuth, requireAcademyManage, async (req, res) => {
    const parsed = parseBody(createSchoolSchema, req.body, res, req.requestId);
    if (!parsed) return;

    let created;
    try {
      [created] = await db
        .insert(schools)
        .values({
          name: parsed.name,
          region: parsed.region,
          sortOrder: parsed.sortOrder ?? 0,
          createdBy: req.admin!.id,
          updatedBy: req.admin!.id,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, 'schools_active_name_unique')) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: '입력값을 확인해 주세요.',
            fieldErrors: { name: ['이미 사용 중인 이름입니다.'] },
            requestId: req.requestId,
          },
        });
        return;
      }
      throw error;
    }
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '학교를 등록하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'school.create',
      targetType: 'school',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { name: created.name, region: created.region },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/:id', requireAuth, requireAcademyManage, async (req, res) => {
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateSchoolSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(schools).where(eq(schools.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '학교를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    if (before.updatedAt.toISOString() !== parsed.expectedUpdatedAt) {
      res.status(409).json({
        error: { code: 'VERSION_CONFLICT', message: '다른 곳에서 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.', requestId: req.requestId },
      });
      return;
    }

    const { expectedUpdatedAt: _expected, ...changes } = parsed;

    let updated;
    try {
      [updated] = await db
        .update(schools)
        .set({ ...changes, updatedBy: req.admin!.id, updatedAt: new Date() })
        .where(eq(schools.id, id))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, 'schools_active_name_unique')) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: '입력값을 확인해 주세요.',
            fieldErrors: { name: ['이미 사용 중인 이름입니다.'] },
            requestId: req.requestId,
          },
        });
        return;
      }
      throw error;
    }
    if (!updated) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '학교를 수정하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'school.update',
      targetType: 'school',
      targetId: updated.id,
      beforeDataSafe: { name: before.name, region: before.region, isActive: before.isActive },
      afterDataSafe: { name: updated.name, region: updated.region, isActive: updated.isActive },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.delete('/:id', requireAuth, requireAcademyManage, async (req, res) => {
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [existing] = await db.select().from(schools).where(eq(schools.id, id));
    if (!existing) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '학교를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    try {
      await db.delete(schools).where(eq(schools.id, id));
    } catch {
      res.status(409).json({
        error: {
          code: 'IN_USE',
          message: '이 학교를 사용 중인 데이터가 있어 삭제할 수 없습니다. 비활성화를 이용해 주세요.',
          requestId: req.requestId,
        },
      });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'school.delete',
      targetType: 'school',
      targetId: id,
      beforeDataSafe: { name: existing.name },
      afterDataSafe: null,
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: { success: true }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
```

- [ ] **Step 4: Mount the router in `server/app.ts`**

```ts
import { createSchoolsRouter } from './routes/schools';
// ...
app.use('/api/schools', createSchoolsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run server/routes/schools.test.ts`
Expected: PASS — 4 tests passing.

- [ ] **Step 6: Run check**

Run: `npm run check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add server/routes/schools.ts server/routes/schools.test.ts server/app.ts
git commit -m "feat: add schools CRUD API"
```

---

## Task 4: Grade levels API

**Files:**
- Create: `server/routes/gradeLevels.ts`, `server/routes/gradeLevels.test.ts`
- Modify: `server/app.ts`

**Interfaces:**
- Consumes: `gradeLevels` table, `PERMISSIONS.ACADEMY_MANAGE` (Task 1).
- Produces: `createGradeLevelsRouter(deps: { sessionSecret: string }): Router`, mounted at `/api/grade-levels`.

This task is structurally identical to Task 3, minus the `region` field. Same TDD approach.

- [ ] **Step 1: Write the failing test `server/routes/gradeLevels.test.ts`**

```ts
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, roles, gradeLevels } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-grade-levels-super@example.com';
const PASSWORD = 'test-grade-levels-password-123';
const TEST_GRADE_NAME = 'test-grade-중등1학년';
const TEST_GRADE_NAME_2 = 'test-grade-이름변경1학년';

async function seedSuperAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-grade-levels-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION] })
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
  await db.delete(gradeLevels).where(eq(gradeLevels.name, TEST_GRADE_NAME));
  await db.delete(gradeLevels).where(eq(gradeLevels.name, TEST_GRADE_NAME_2));
  await db.delete(admins).where(eq(admins.email, SUPER_EMAIL));
  await db.delete(roles).where(eq(roles.name, 'test-grade-levels-role'));
}

describe('grade levels routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/grade-levels');
    expect(response.status).toBe(401);
  });

  it('creates, lists, edits, and deletes a grade level end to end', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/grade-levels')
      .set('Cookie', cookie)
      .send({ name: TEST_GRADE_NAME, sortOrder: 1 });
    expect(created.status).toBe(200);
    expect(created.body.data.name).toBe(TEST_GRADE_NAME);
    expect(created.body.data.isActive).toBe(true);

    const list = await request(app).get('/api/grade-levels').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.data.some((g: { id: string }) => g.id === created.body.data.id)).toBe(true);

    const edited = await request(app)
      .patch(`/api/grade-levels/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ name: TEST_GRADE_NAME_2, expectedUpdatedAt: created.body.data.updatedAt });
    expect(edited.status).toBe(200);
    expect(edited.body.data.name).toBe(TEST_GRADE_NAME_2);

    const staleEdit = await request(app)
      .patch(`/api/grade-levels/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ name: 'test-grade-또변경', expectedUpdatedAt: created.body.data.updatedAt });
    expect(staleEdit.status).toBe(409);
    expect(staleEdit.body.error.code).toBe('VERSION_CONFLICT');

    const deleted = await request(app).delete(`/api/grade-levels/${created.body.data.id}`).set('Cookie', cookie);
    expect(deleted.status).toBe(200);

    const listAfterDelete = await request(app).get('/api/grade-levels').set('Cookie', cookie);
    expect(listAfterDelete.body.data.some((g: { id: string }) => g.id === created.body.data.id)).toBe(false);
  });

  it('rejects creating a second active grade level with the same name', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    await request(app).post('/api/grade-levels').set('Cookie', cookie).send({ name: TEST_GRADE_NAME });
    const duplicate = await request(app).post('/api/grade-levels').set('Cookie', cookie).send({ name: TEST_GRADE_NAME });

    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error.code).toBe('VALIDATION_ERROR');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/routes/gradeLevels.test.ts`
Expected: FAIL — 404s.

- [ ] **Step 3: Write `server/routes/gradeLevels.ts`**

```ts
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { gradeLevels } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';

const createGradeLevelSchema = z.object({
  name: z.string().min(1),
  sortOrder: z.number().int().optional(),
});

const updateGradeLevelSchema = z.object({
  name: z.string().min(1).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  expectedUpdatedAt: z.string(),
});

function isUniqueViolation(error: unknown, indexName: string): boolean {
  return error instanceof Error && error.message.includes(indexName);
}

export interface GradeLevelsRouterDeps {
  sessionSecret: string;
}

export function createGradeLevelsRouter(deps: GradeLevelsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireAcademyManage = createRequirePermission(PERMISSIONS.ACADEMY_MANAGE);

  router.get('/', requireAuth, requireAcademyManage, async (req, res) => {
    const rows = await db.select().from(gradeLevels).orderBy(gradeLevels.sortOrder);
    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/', requireAuth, requireAcademyManage, async (req, res) => {
    const parsed = parseBody(createGradeLevelSchema, req.body, res, req.requestId);
    if (!parsed) return;

    let created;
    try {
      [created] = await db
        .insert(gradeLevels)
        .values({
          name: parsed.name,
          sortOrder: parsed.sortOrder ?? 0,
          createdBy: req.admin!.id,
          updatedBy: req.admin!.id,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, 'grade_levels_active_name_unique')) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: '입력값을 확인해 주세요.',
            fieldErrors: { name: ['이미 사용 중인 이름입니다.'] },
            requestId: req.requestId,
          },
        });
        return;
      }
      throw error;
    }
    if (!created) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '학년을 등록하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'gradeLevel.create',
      targetType: 'gradeLevel',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { name: created.name },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/:id', requireAuth, requireAcademyManage, async (req, res) => {
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const parsed = parseBody(updateGradeLevelSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(gradeLevels).where(eq(gradeLevels.id, id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '학년을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    if (before.updatedAt.toISOString() !== parsed.expectedUpdatedAt) {
      res.status(409).json({
        error: { code: 'VERSION_CONFLICT', message: '다른 곳에서 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.', requestId: req.requestId },
      });
      return;
    }

    const { expectedUpdatedAt: _expected, ...changes } = parsed;

    let updated;
    try {
      [updated] = await db
        .update(gradeLevels)
        .set({ ...changes, updatedBy: req.admin!.id, updatedAt: new Date() })
        .where(eq(gradeLevels.id, id))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, 'grade_levels_active_name_unique')) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: '입력값을 확인해 주세요.',
            fieldErrors: { name: ['이미 사용 중인 이름입니다.'] },
            requestId: req.requestId,
          },
        });
        return;
      }
      throw error;
    }
    if (!updated) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '학년을 수정하지 못했습니다.', requestId: req.requestId } });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'gradeLevel.update',
      targetType: 'gradeLevel',
      targetId: updated.id,
      beforeDataSafe: { name: before.name, isActive: before.isActive },
      afterDataSafe: { name: updated.name, isActive: updated.isActive },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.delete('/:id', requireAuth, requireAcademyManage, async (req, res) => {
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', requestId: req.requestId } });
      return;
    }

    const [existing] = await db.select().from(gradeLevels).where(eq(gradeLevels.id, id));
    if (!existing) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '학년을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    try {
      await db.delete(gradeLevels).where(eq(gradeLevels.id, id));
    } catch {
      res.status(409).json({
        error: {
          code: 'IN_USE',
          message: '이 학년을 사용 중인 데이터가 있어 삭제할 수 없습니다. 비활성화를 이용해 주세요.',
          requestId: req.requestId,
        },
      });
      return;
    }

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'gradeLevel.delete',
      targetType: 'gradeLevel',
      targetId: id,
      beforeDataSafe: { name: existing.name },
      afterDataSafe: null,
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: { success: true }, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
```

- [ ] **Step 4: Mount the router in `server/app.ts`**

```ts
import { createGradeLevelsRouter } from './routes/gradeLevels';
// ...
app.use('/api/grade-levels', createGradeLevelsRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run server/routes/gradeLevels.test.ts`
Expected: PASS — 3 tests passing.

- [ ] **Step 6: Run check**

Run: `npm run check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add server/routes/gradeLevels.ts server/routes/gradeLevels.test.ts server/app.ts
git commit -m "feat: add grade levels CRUD API"
```

---

## Task 5: Client — academy settings & academics reference-data pages

**Files:**
- Create: `client/src/features/settings/AcademySettingsPage.tsx`, `client/src/features/settings/AcademySettingsPage.test.tsx`, `client/src/features/settings/AcademicsSettingsPage.tsx`, `client/src/features/settings/AcademicsSettingsPage.test.tsx`
- Modify: `client/src/routes.tsx`

**Interfaces:**
- Consumes: `apiGet`, `apiPost`, `apiPatch`, `apiDelete`, `ApiRequestError` from `client/src/lib/apiClient.ts` (Task 1 + existing); `ProtectedRoute` from `client/src/components/layout/ProtectedRoute.tsx` (existing, Stage 2).
- Produces: nothing consumed by a later task in this plan — this is the last content task before verification.

- [ ] **Step 1: Write the failing test `client/src/features/settings/AcademySettingsPage.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcademySettingsPage } from './AcademySettingsPage';

describe('AcademySettingsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads and displays the current academy settings, then saves an edit', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          id: 's1',
          academyName: '기존학원',
          phoneNormalized: '',
          address: '',
          senderName: '',
          updatedAt: '2026-08-15T00:00:00+09:00',
        },
        meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:00:00+09:00' },
      }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          id: 's1',
          academyName: '새이름학원',
          phoneNormalized: '',
          address: '',
          senderName: '',
          updatedAt: '2026-08-15T00:10:00+09:00',
        },
        meta: { requestId: 'req-2', kstTimestamp: '2026-08-15T00:10:00+09:00' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AcademySettingsPage />);

    const nameInput = await screen.findByLabelText('학원 이름');
    expect(nameInput).toHaveValue('기존학원');

    fireEvent.change(nameInput, { target: { value: '새이름학원' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(screen.getByText('저장되었습니다.')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/settings/academy');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PATCH' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/src/features/settings/AcademySettingsPage.test.tsx`
Expected: FAIL — `Cannot find module './AcademySettingsPage'`.

- [ ] **Step 3: Write `client/src/features/settings/AcademySettingsPage.tsx`**

```tsx
import { type FormEvent, useEffect, useState } from 'react';
import { ApiRequestError, apiGet, apiPatch } from '../../lib/apiClient';

interface AcademySettings {
  id: string;
  academyName: string;
  phoneNormalized: string | null;
  address: string | null;
  senderName: string | null;
  updatedAt: string;
}

export function AcademySettingsPage() {
  const [settings, setSettings] = useState<AcademySettings | null>(null);
  const [academyName, setAcademyName] = useState('');
  const [phoneNormalized, setPhoneNormalized] = useState('');
  const [address, setAddress] = useState('');
  const [senderName, setSenderName] = useState('');
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<AcademySettings>('/api/settings/academy')
      .then((data) => {
        setSettings(data);
        setAcademyName(data.academyName);
        setPhoneNormalized(data.phoneNormalized ?? '');
        setAddress(data.address ?? '');
        setSenderName(data.senderName ?? '');
        setStatus('idle');
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
        setStatus('error');
      });
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    setStatus('saving');
    setError(null);
    try {
      const updated = await apiPatch<AcademySettings>('/api/settings/academy', {
        academyName,
        phoneNormalized,
        address,
        senderName,
      });
      setSettings(updated);
      setStatus('saved');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '저장하지 못했습니다.');
      setStatus('error');
    }
  }

  if (status === 'loading') return <p className="p-4 text-gray-500">불러오는 중...</p>;

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">학원 기본정보</h1>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span>학원 이름</span>
          <input
            value={academyName}
            onChange={(event) => setAcademyName(event.target.value)}
            required
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>전화번호</span>
          <input
            value={phoneNormalized}
            onChange={(event) => setPhoneNormalized(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>주소</span>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>발신자명</span>
          <input
            value={senderName}
            onChange={(event) => setSenderName(event.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-base"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {status === 'saved' && <p className="text-sm text-green-700">저장되었습니다.</p>}
        <button
          type="submit"
          disabled={status === 'saving'}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          저장
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/src/features/settings/AcademySettingsPage.test.tsx`
Expected: PASS — 1 test passing.

- [ ] **Step 5: Write the failing test `client/src/features/settings/AcademicsSettingsPage.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcademicsSettingsPage } from './AcademicsSettingsPage';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => ({ data, meta: { requestId: 'req', kstTimestamp: '2026-08-15T00:00:00+09:00' } }),
  };
}

describe('AcademicsSettingsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads schools and grade levels, and creates a new school', async () => {
    // Mutable in-memory list so a GET after the POST reflects the newly created row —
    // a static mock would make the new school vanish on the post-create refetch.
    const schoolsState = [
      { id: 'sc1', name: '기존초등학교', region: null, sortOrder: 0, isActive: true, updatedAt: '2026-08-15T00:00:00+09:00' },
    ];
    const gradeLevelsState = [
      { id: 'g1', name: '초등 1학년', sortOrder: 0, isActive: true, updatedAt: '2026-08-15T00:00:00+09:00' },
    ];

    const fetchMock = vi.fn();
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/schools' && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(schoolsState));
      }
      if (path === '/api/grade-levels' && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse(gradeLevelsState));
      }
      if (path === '/api/schools' && init?.method === 'POST') {
        const created = { id: 'sc2', name: '새학교', region: null, sortOrder: 0, isActive: true, updatedAt: '2026-08-15T00:05:00+09:00' };
        schoolsState.push(created);
        return Promise.resolve(jsonResponse(created));
      }
      throw new Error(`unexpected fetch: ${path} ${init?.method ?? 'GET'}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AcademicsSettingsPage />);

    await screen.findByText('기존초등학교');
    await screen.findByText('초등 1학년');

    fireEvent.change(screen.getByLabelText('새 학교 이름'), { target: { value: '새학교' } });
    fireEvent.click(screen.getByRole('button', { name: '학교 추가' }));

    await waitFor(() => expect(screen.getByText('새학교')).toBeInTheDocument());
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run client/src/features/settings/AcademicsSettingsPage.test.tsx`
Expected: FAIL — `Cannot find module './AcademicsSettingsPage'`.

- [ ] **Step 7: Write `client/src/features/settings/AcademicsSettingsPage.tsx`**

```tsx
import { type FormEvent, useEffect, useState } from 'react';
import { ApiRequestError, apiDelete, apiGet, apiPatch, apiPost } from '../../lib/apiClient';

interface School {
  id: string;
  name: string;
  region: string | null;
  sortOrder: number;
  isActive: boolean;
  updatedAt: string;
}

interface GradeLevel {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  updatedAt: string;
}

export function AcademicsSettingsPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [gradeLevels, setGradeLevels] = useState<GradeLevel[]>([]);
  const [newSchoolName, setNewSchoolName] = useState('');
  const [newGradeLevelName, setNewGradeLevelName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function loadSchools() {
    setSchools(await apiGet<School[]>('/api/schools'));
  }

  async function loadGradeLevels() {
    setGradeLevels(await apiGet<GradeLevel[]>('/api/grade-levels'));
  }

  useEffect(() => {
    Promise.all([loadSchools(), loadGradeLevels()]).catch((err: unknown) => {
      setError(err instanceof ApiRequestError ? err.message : '불러오지 못했습니다.');
    });
  }, []);

  async function handleAddSchool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiPost('/api/schools', { name: newSchoolName });
      setNewSchoolName('');
      await loadSchools();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '학교를 등록하지 못했습니다.');
    }
  }

  async function handleToggleSchool(school: School) {
    setError(null);
    try {
      await apiPatch(`/api/schools/${school.id}`, {
        isActive: !school.isActive,
        expectedUpdatedAt: school.updatedAt,
      });
      await loadSchools();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '학교를 수정하지 못했습니다.');
    }
  }

  async function handleDeleteSchool(school: School) {
    setError(null);
    try {
      await apiDelete(`/api/schools/${school.id}`);
      await loadSchools();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '학교를 삭제하지 못했습니다.');
    }
  }

  async function handleAddGradeLevel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await apiPost('/api/grade-levels', { name: newGradeLevelName });
      setNewGradeLevelName('');
      await loadGradeLevels();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '학년을 등록하지 못했습니다.');
    }
  }

  async function handleToggleGradeLevel(gradeLevel: GradeLevel) {
    setError(null);
    try {
      await apiPatch(`/api/grade-levels/${gradeLevel.id}`, {
        isActive: !gradeLevel.isActive,
        expectedUpdatedAt: gradeLevel.updatedAt,
      });
      await loadGradeLevels();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '학년을 수정하지 못했습니다.');
    }
  }

  async function handleDeleteGradeLevel(gradeLevel: GradeLevel) {
    setError(null);
    try {
      await apiDelete(`/api/grade-levels/${gradeLevel.id}`);
      await loadGradeLevels();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '학년을 삭제하지 못했습니다.');
    }
  }

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">학교·학년 기준정보</h1>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-6">
        <h2 className="text-lg font-medium">학교</h2>
        <ul className="mt-2 space-y-2">
          {schools.map((school) => (
            <li key={school.id} className="flex items-center justify-between gap-2 rounded border border-gray-200 p-2">
              <span className={school.isActive ? '' : 'text-gray-400 line-through'}>{school.name}</span>
              <span className="flex gap-2">
                <button onClick={() => handleToggleSchool(school)} className="rounded bg-gray-200 px-2 py-1 text-sm">
                  {school.isActive ? '비활성화' : '활성화'}
                </button>
                <button onClick={() => handleDeleteSchool(school)} className="rounded bg-red-100 px-2 py-1 text-sm text-red-700">
                  삭제
                </button>
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={handleAddSchool} className="mt-3 flex gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span>새 학교 이름</span>
            <input
              value={newSchoolName}
              onChange={(event) => setNewSchoolName(event.target.value)}
              required
              className="rounded border border-gray-300 px-3 py-2 text-base"
            />
          </label>
          <button type="submit" className="self-end rounded bg-blue-600 px-4 py-2 text-white">
            학교 추가
          </button>
        </form>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-medium">학년</h2>
        <ul className="mt-2 space-y-2">
          {gradeLevels.map((gradeLevel) => (
            <li
              key={gradeLevel.id}
              className="flex items-center justify-between gap-2 rounded border border-gray-200 p-2"
            >
              <span className={gradeLevel.isActive ? '' : 'text-gray-400 line-through'}>{gradeLevel.name}</span>
              <span className="flex gap-2">
                <button onClick={() => handleToggleGradeLevel(gradeLevel)} className="rounded bg-gray-200 px-2 py-1 text-sm">
                  {gradeLevel.isActive ? '비활성화' : '활성화'}
                </button>
                <button
                  onClick={() => handleDeleteGradeLevel(gradeLevel)}
                  className="rounded bg-red-100 px-2 py-1 text-sm text-red-700"
                >
                  삭제
                </button>
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={handleAddGradeLevel} className="mt-3 flex gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span>새 학년 이름</span>
            <input
              value={newGradeLevelName}
              onChange={(event) => setNewGradeLevelName(event.target.value)}
              required
              className="rounded border border-gray-300 px-3 py-2 text-base"
            />
          </label>
          <button type="submit" className="self-end rounded bg-blue-600 px-4 py-2 text-white">
            학년 추가
          </button>
        </form>
      </div>
    </section>
  );
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run client/src/features/settings/AcademicsSettingsPage.test.tsx`
Expected: PASS — 1 test passing.

- [ ] **Step 9: Update `client/src/routes.tsx`**

```tsx
import { Route, Switch } from 'wouter';
import { DevHomePage } from './features/dashboard/DevHomePage';
import { AdminHomePage } from './features/dashboard/AdminHomePage';
import { LoginPage } from './features/auth/LoginPage';
import { ProfilePage } from './features/settings/ProfilePage';
import { AcademySettingsPage } from './features/settings/AcademySettingsPage';
import { AcademicsSettingsPage } from './features/settings/AcademicsSettingsPage';
import { ProtectedRoute } from './components/layout/ProtectedRoute';

export function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={DevHomePage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/admin">
        <ProtectedRoute>
          <AdminHomePage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/profile">
        <ProtectedRoute>
          <ProfilePage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/settings/academy">
        <ProtectedRoute>
          <AcademySettingsPage />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/settings/academics">
        <ProtectedRoute>
          <AcademicsSettingsPage />
        </ProtectedRoute>
      </Route>
    </Switch>
  );
}
```

- [ ] **Step 10: Run check and the full client test suite**

Run:
```bash
npm run check
npx vitest run
```
Expected: both clean.

- [ ] **Step 11: Commit**

```bash
git add client/src/features/settings/AcademySettingsPage.tsx client/src/features/settings/AcademySettingsPage.test.tsx client/src/features/settings/AcademicsSettingsPage.tsx client/src/features/settings/AcademicsSettingsPage.test.tsx client/src/routes.tsx
git commit -m "feat: add academy settings and academics reference-data client pages"
```

---

## Task 6: End-to-end verification and full check

**Files:**
- Create: `tests/e2e/academics-settings.spec.ts`

**Interfaces:**
- Consumes: the running app from `npm run dev`, and `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD` from `.env` (already loaded into the Playwright process per Stage 2's `test:e2e` script).

- [ ] **Step 1: Write `tests/e2e/academics-settings.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('logs in, updates academy name, adds and removes a school', async ({ page }) => {
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

  const schoolName = `e2e-테스트학교-${Date.now()}`;
  await page.getByLabel('새 학교 이름').fill(schoolName);
  await page.getByRole('button', { name: '학교 추가' }).click();
  await expect(page.getByText(schoolName)).toBeVisible();

  const schoolRow = page.locator('li', { hasText: schoolName });
  await schoolRow.getByRole('button', { name: '삭제' }).click();
  await expect(page.getByText(schoolName)).not.toBeVisible();
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `npm run test:e2e`
Expected: PASS — includes the pre-existing `dev-home.spec.ts` and `login.spec.ts` from earlier plans, plus this new test (4 tests total), against the real dev server and real dev DB.

- [ ] **Step 3: Run the full unit/integration suite, check, and build**

Run:
```bash
npx vitest run
npm run check
npm run build
```
Expected: all clean.

- [ ] **Step 4: Manual verification and cleanup**

Run `npm run dev`, log in with `.env`'s credentials, visit `/admin/settings/academy` and confirm the form loads and saves, visit `/admin/settings/academics` and confirm you can add/deactivate/delete a school and a grade level. Stop the dev server afterward and verify via `netstat -ano | grep -E ":5173|:8787"` and a process listing that nothing is left running — show the actual re-check output in your report, not just a claim.

- [ ] **Step 5: Commit and push**

```bash
git add tests/e2e/academics-settings.spec.ts
git commit -m "test: add end-to-end coverage for academy settings and academics reference data"
git push
git status
```
Expected: `git status` reports a clean working tree, up to date with `origin/main`.
