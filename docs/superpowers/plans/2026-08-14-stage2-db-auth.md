# Stage 2: Database, Authentication & Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the Stage-1 scaffold to a real Neon Postgres database, and build working admin authentication end-to-end: initial super-admin bootstrap, login/logout/session, Resend-based password reset, role-based permission middleware, roles/admins CRUD, an audit-log write path, and a minimal login/profile UI — all verified against the user's real local dev database.

**Architecture:** `shared/schema.ts` holds the Drizzle table definitions (single source of truth for both the app and `drizzle-kit`'s migration generator). `server/db.ts` exposes a singleton `db`/`pool`. Sessions are opaque random tokens: the raw token lives only in an HttpOnly cookie in the browser; the server stores only an HMAC-keyed hash of it in `auth_sessions`, so a DB leak alone can't forge a session. `createApp()` gains an optional dependency-injection point for the email adapter so tests never call the real Resend API.

**Tech Stack:** Drizzle ORM + drizzle-kit + `pg` (Neon over standard Postgres wire protocol), bcryptjs, Resend SDK, existing Stage-1 stack (Express 5, React 19, Vite, Vitest, Playwright).

**Spec:** [`../../../academy_automation_final_development_prompt.md`](../../../academy_automation_final_development_prompt.md) — this plan implements §9.2 (roles/admins/auth_sessions/password_reset_tokens), §10.1–§10.4 (bootstrap, login/session, Resend reset, permissions), the auth/admin/role portion of §12.1, and §18 Stage 2. Also see [`../../../CLAUDE.md`](../../../CLAUDE.md) for the local-dev environment.

**Prior plan:** [`2026-08-14-stage1-base-project.md`](2026-08-14-stage1-base-project.md) built the scaffold this plan extends — read it if you need context on existing files (`server/app.ts`, `server/env.ts`, `client/src/lib/apiClient.ts`, `shared/types.ts`, `@shared/*` path alias, the `vitest.config.ts` client/server/shared projects split).

## Global Constraints

- KST (`Asia/Seoul`) for all business timestamps — use `getNowKSTISOString`/`getTodayKST` from `@shared/kst`, never UTC truncation. DB timestamps are `timestamp with time zone`.
- API envelope is `{ data, meta: { requestId, kstTimestamp } }` / `{ error: { code, message, fieldErrors?, requestId } }` (`shared/types.ts`, already built).
- Error codes/status pairs from spec §14.2 are binding where listed: `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 VERSION_CONFLICT`, `429 RATE_LIMITED`. Use these exact code strings.
- Login and password-reset responses never reveal whether an email/account exists, whether an account is locked, or any other detail beyond "invalid credentials" / "if this email exists, we sent a link" — this prevents user enumeration (spec §10.3.1).
- Passwords are hashed (bcrypt) and never logged or returned in any response. Session tokens are never stored in the DB in raw form — only an HMAC-SHA256 hash keyed by `AUTH_SESSION_SECRET`. Password-reset tokens follow the same rule.
- The last active super-admin can never be deactivated (spec §10.4).
- Every state-changing admin/role action (create, edit, deactivate) writes an audit log row: actor, KST timestamp, target, safe before/after values, request id (spec §16). Viewing/listing audit logs is out of scope for this plan (later stage).
- **No separate test database was set up for this project** (a deliberate Stage-1 decision — dev vs. prod Neon only). From this plan onward, server-side integration tests run against the real local dev `DATABASE_URL` in `.env`. Every such test must clean up (delete) any rows it creates, in an `afterEach`/`afterAll`, using an identifiable pattern (e.g. `test-*@example.com` emails) so re-runs never collide or leave litter in the dev DB. Never touch or assume a `NODE_ENV=test`-specific database.
- Never write to or migrate the production Neon project from this plan — only the dev `DATABASE_URL` the user configured in `.env`. `.env` is git-ignored and already contains real values (do not print its contents to logs or commit it).
- Client file/directory layout follows the existing Stage-1 pattern: `client/src/features/<domain>/`, `client/src/components/<category>/`, `client/src/lib/`, `client/src/hooks/`.
- Library API surfaces (Drizzle table/index builder syntax in particular) can shift between versions. Install packages first, then check the installed version's TypeScript types/docs if a snippet in this plan fails to compile, and adjust syntax while keeping the same intent — note any such deviation in your task report.
- `npm run check` must stay clean after every task (Stage 1's final review found that skipping this let bugs accumulate for 8 tasks — don't repeat that).

---

## File Structure

```
drizzle.config.ts
scripts/
  migrate.ts
migrations/                       # generated by drizzle-kit, committed to git

shared/
  schema.ts                       # roles, admins, auth_sessions, password_reset_tokens, audit_logs
  permissions.ts                  # PERMISSIONS constants, SUPER_ADMIN_ROLE_NAME

server/
  db.ts
  env.ts                          # extended: DATABASE_URL, AUTH_SESSION_SECRET, INITIAL_ADMIN_*, RESEND_*
  env.test.ts
  utils/
    password.ts / .test.ts
    sessionToken.ts / .test.ts
    cookies.ts / .test.ts
    rateLimit.ts / .test.ts
    validate.ts / .test.ts
  services/
    bootstrapAdmin.ts / .test.ts
    session.ts / .test.ts
    email.ts                      # EmailAdapter interface + Resend + fake test adapter
    passwordReset.ts / .test.ts
    audit.ts / .test.ts
  middleware/
    auth.ts / .test.ts            # requireAuth
    permissions.ts / .test.ts     # requirePermission
  routes/
    auth.ts / .test.ts            # login, logout, me, forgot-password, reset-password
    roles.ts / .test.ts
    admins.ts / .test.ts
  app.ts                          # modified: wire new routers + deps
  index.ts                        # modified: call bootstrapAdmin before listen

client/
  src/
    lib/
      apiClient.ts / .test.ts     # modified: add apiPost/apiPatch
    hooks/
      useAuth.ts / .test.ts
    components/
      layout/
        ProtectedRoute.tsx / .test.ts
    features/
      auth/
        LoginPage.tsx / .test.tsx
      settings/
        ProfilePage.tsx / .test.tsx
      dashboard/
        AdminHomePage.tsx / .test.tsx
    routes.tsx                    # modified

tests/
  e2e/
    login.spec.ts
```

---

## Task 1: Neon connection, Drizzle schema & migration, extended health check

**Files:**
- Create: `drizzle.config.ts`, `server/db.ts`, `shared/schema.ts`, `scripts/migrate.ts`
- Modify: `server/env.ts`, `server/env.test.ts`, `server/routes/health.ts`, `server/routes/health.test.ts`, `package.json`, `tsconfig.node.json`
- Migration output: `migrations/` (generated, then committed)

**Interfaces:**
- Consumes: nothing new.
- Produces: `db` (Drizzle instance) and `pool` (pg `Pool`) and `checkDbConnection(): Promise<boolean>` from `server/db.ts` — used by every later service/route file and by `health.ts`. Table objects `roles`, `admins`, `authSessions`, `passwordResetTokens` from `shared/schema.ts` (imported as `@shared/schema`) — used by every service in Tasks 3–6. `loadEnv()`'s `Env` type gains `DATABASE_URL: string`, `AUTH_SESSION_SECRET: string`, `INITIAL_ADMIN_EMAIL: string`, `INITIAL_ADMIN_PASSWORD: string`, `INITIAL_ADMIN_NAME: string`, `RESEND_API_KEY: string`, `RESEND_FROM_EMAIL: string` — all now **required** (no defaults), used everywhere `loadEnv()` is called from this task onward.

- [ ] **Step 1: Install dependencies**

```bash
npm install drizzle-orm pg
npm install -D drizzle-kit @types/pg dotenv-cli
```

- [ ] **Step 2: Write `shared/schema.ts`**

```ts
import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const admins = pgTable(
  'admins',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    status: text('status', { enum: ['active', 'inactive', 'locked'] })
      .notNull()
      .default('active'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('admins_email_unique').on(table.email)]
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('auth_sessions_token_hash_unique').on(table.tokenHash)]
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('password_reset_tokens_token_hash_unique').on(table.tokenHash)]
);

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  adminId: uuid('admin_id').references(() => admins.id),
  roleSnapshot: text('role_snapshot'),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  beforeDataSafe: jsonb('before_data_safe'),
  afterDataSafe: jsonb('after_data_safe'),
  result: text('result', { enum: ['success', 'failure'] }).notNull(),
  requestId: text('request_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Write `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './shared/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 4: Add DB scripts to `package.json`**

Add to `"scripts"`:
```json
"db:generate": "dotenv -e .env -- drizzle-kit generate",
"db:migrate": "dotenv -e .env -- tsx --tsconfig server/tsconfig.json scripts/migrate.ts",
```
Also change the existing `test:e2e` script (Task 8 needs `.env` loaded in the Playwright process too) to:
```json
"test:e2e": "dotenv -e .env -- playwright test"
```

- [ ] **Step 5: Write `scripts/migrate.ts`**

```ts
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from '../server/db';

async function main() {
  await migrate(db, { migrationsFolder: './migrations' });
  await pool.end();
  console.log('Migrations applied.');
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
```

- [ ] **Step 6: Write `server/db.ts`**

```ts
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@shared/schema';
import { loadEnv } from './env';

const env = loadEnv();

export const pool = new Pool({ connectionString: env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export async function checkDbConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 7: Extend `tsconfig.node.json` to cover `scripts/`**

Change `"include"` from `["*.config.ts", "tests/**/*.ts"]` to `["*.config.ts", "tests/**/*.ts", "scripts/**/*.ts"]`.

- [ ] **Step 8: Update `server/env.ts` (required DB/auth/email vars)**

```ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  APP_URL: z.string().url().optional(),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  AUTH_SESSION_SECRET: z.string().min(16, 'AUTH_SESSION_SECRET must be at least 16 characters'),
  INITIAL_ADMIN_EMAIL: z.string().email(),
  INITIAL_ADMIN_PASSWORD: z.string().min(8, 'INITIAL_ADMIN_PASSWORD must be at least 8 characters'),
  INITIAL_ADMIN_NAME: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.string().email(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment variables: ${details}`);
  }

  return result.data;
}
```

- [ ] **Step 9: Replace `server/env.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  AUTH_SESSION_SECRET: 'a'.repeat(32),
  INITIAL_ADMIN_EMAIL: 'admin@example.com',
  INITIAL_ADMIN_PASSWORD: 'password123',
  INITIAL_ADMIN_NAME: '관리자',
  RESEND_API_KEY: 're_test_key',
  RESEND_FROM_EMAIL: 'noreply@example.com',
};

describe('loadEnv', () => {
  it('applies defaults for optional values when required values are present', () => {
    const env = loadEnv(validEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(8787);
  });

  it('coerces PORT from a string to a number', () => {
    const env = loadEnv({ ...validEnv, PORT: '3000' });
    expect(env.PORT).toBe(3000);
  });

  it('rejects an invalid APP_URL', () => {
    expect(() => loadEnv({ ...validEnv, APP_URL: 'not-a-url' })).toThrow(/APP_URL/);
  });

  it('rejects when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = validEnv;
    expect(() => loadEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('rejects when AUTH_SESSION_SECRET is too short', () => {
    expect(() => loadEnv({ ...validEnv, AUTH_SESSION_SECRET: 'short' })).toThrow(
      /AUTH_SESSION_SECRET/
    );
  });

  it('rejects an invalid INITIAL_ADMIN_EMAIL', () => {
    expect(() => loadEnv({ ...validEnv, INITIAL_ADMIN_EMAIL: 'not-an-email' })).toThrow(
      /INITIAL_ADMIN_EMAIL/
    );
  });
});
```

- [ ] **Step 10: Run the updated env tests**

Run: `npx vitest run server/env.test.ts`
Expected: PASS — 6 tests passing.

- [ ] **Step 11: Generate and apply the migration against the real local dev DB**

Run:
```bash
npm run db:generate
npm run db:migrate
```
Expected: `db:generate` writes SQL under `migrations/`; `db:migrate` prints `Migrations applied.` with no errors, connecting to the `DATABASE_URL` in the user's `.env` (the dev Neon project). If this fails, stop and report — do not proceed with a broken DB connection.

- [ ] **Step 12: Extend `server/routes/health.ts` to report DB status**

```ts
import { Router } from 'express';
import { getNowKSTISOString } from '@shared/kst';
import { checkDbConnection } from '../db';

export const healthRouter = Router();

healthRouter.get('/health', async (req, res) => {
  const dbOk = await checkDbConnection();

  res.json({
    data: {
      status: 'ok',
      db: dbOk ? 'ok' : 'error',
    },
    meta: {
      requestId: req.requestId,
      kstTimestamp: getNowKSTISOString(),
    },
  });
});
```

- [ ] **Step 13: Extend `server/routes/health.test.ts`**

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';

describe('GET /api/health', () => {
  it('returns an ok status and db status inside the standard success envelope', async () => {
    const app = createApp();

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
    expect(response.body.data.db).toBe('ok');
    expect(response.body.meta.requestId).toEqual(expect.any(String));
    expect(response.body.meta.kstTimestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/
    );
  });
});
```

- [ ] **Step 14: Run the health test against the real dev DB**

Run: `npx vitest run server/routes/health.test.ts`
Expected: PASS — 1 test passing, `data.db` is genuinely `'ok'` because the test hit the real Neon dev database.

- [ ] **Step 15: Commit**

```bash
git add drizzle.config.ts server/db.ts shared/schema.ts scripts/migrate.ts migrations server/env.ts server/env.test.ts server/routes/health.ts server/routes/health.test.ts package.json package-lock.json tsconfig.node.json
git commit -m "feat: connect Neon DB via Drizzle, add auth schema and migration, extend health check"
```

---

## Task 2: Auth utilities — password hashing, session tokens, cookies, permissions, validation

**Files:**
- Create: `shared/permissions.ts`, `server/utils/password.ts` + test, `server/utils/sessionToken.ts` + test, `server/utils/cookies.ts` + test, `server/utils/validate.ts` + test

**Interfaces:**
- Consumes: nothing.
- Produces: `hashPassword(plain): Promise<string>`, `verifyPassword(plain, hash): Promise<boolean>` — used by Task 3 (bootstrap) and Task 6 (admin create). `generateToken(): string`, `hashToken(rawToken: string, secret: string): string` — used by Task 4 (session) and Task 5 (password reset). `readSessionCookie(cookieHeader?: string): string | null`, `buildSessionCookie(token: string, isProduction: boolean): string`, `buildExpiredSessionCookie(isProduction: boolean): string`, `SESSION_COOKIE_NAME`, `SESSION_MAX_AGE_SECONDS` — used by Task 4. `PERMISSIONS` (object of permission-string constants), `SUPER_ADMIN_ROLE_NAME` — used by Tasks 3 and 6. `parseBody<T>(schema, body, res, requestId): T | undefined` — used by Tasks 4, 5, 6 for every validated POST/PATCH body.

- [ ] **Step 1: Install dependency**

```bash
npm install bcryptjs
npm install -D @types/bcryptjs
```

- [ ] **Step 2: Write the failing test `server/utils/password.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('hashes a password so the raw value is not stored', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('verifies a correct password against its hash', async () => {
    const hash = await hashPassword('my-secret-password');
    await expect(verifyPassword('my-secret-password', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('my-secret-password');
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run server/utils/password.test.ts`
Expected: FAIL — `Cannot find module './password'`.

- [ ] **Step 4: Write `server/utils/password.ts`**

```ts
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run server/utils/password.test.ts`
Expected: PASS — 3 tests passing.

- [ ] **Step 6: Write the failing test `server/utils/sessionToken.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { generateToken, hashToken } from './sessionToken';

describe('session token utilities', () => {
  it('generates a long random token each time', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toHaveLength(64);
  });

  it('hashes the same token+secret pair to the same value deterministically', () => {
    const token = generateToken();
    expect(hashToken(token, 'secret-a')).toBe(hashToken(token, 'secret-a'));
  });

  it('produces different hashes for different secrets given the same token', () => {
    const token = generateToken();
    expect(hashToken(token, 'secret-a')).not.toBe(hashToken(token, 'secret-b'));
  });

  it('produces different hashes for different tokens given the same secret', () => {
    expect(hashToken(generateToken(), 'secret-a')).not.toBe(hashToken(generateToken(), 'secret-a'));
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npx vitest run server/utils/sessionToken.test.ts`
Expected: FAIL — `Cannot find module './sessionToken'`.

- [ ] **Step 8: Write `server/utils/sessionToken.ts`**

```ts
import { randomBytes, createHmac } from 'node:crypto';

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(rawToken: string, secret: string): string {
  return createHmac('sha256', secret).update(rawToken).digest('hex');
}
```

- [ ] **Step 9: Run to verify it passes**

Run: `npx vitest run server/utils/sessionToken.test.ts`
Expected: PASS — 4 tests passing.

- [ ] **Step 10: Write the failing test `server/utils/cookies.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE_NAME,
  buildExpiredSessionCookie,
  buildSessionCookie,
  readSessionCookie,
} from './cookies';

describe('session cookie utilities', () => {
  it('reads the session token back out of a Cookie header', () => {
    const header = `other=1; ${SESSION_COOKIE_NAME}=abc123; another=2`;
    expect(readSessionCookie(header)).toBe('abc123');
  });

  it('returns null when the session cookie is absent', () => {
    expect(readSessionCookie('other=1; another=2')).toBeNull();
  });

  it('returns null when there is no cookie header at all', () => {
    expect(readSessionCookie(undefined)).toBeNull();
  });

  it('builds a session cookie without Secure in non-production', () => {
    const cookie = buildSessionCookie('tok', false);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=tok`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
  });

  it('builds a session cookie with Secure in production', () => {
    expect(buildSessionCookie('tok', true)).toContain('Secure');
  });

  it('builds an expired cookie that clears the value', () => {
    const cookie = buildExpiredSessionCookie(false);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cookie).toContain('Max-Age=0');
  });
});
```

- [ ] **Step 11: Run to verify it fails**

Run: `npx vitest run server/utils/cookies.test.ts`
Expected: FAIL — `Cannot find module './cookies'`.

- [ ] **Step 12: Write `server/utils/cookies.ts`**

```ts
export const SESSION_COOKIE_NAME = 'academy_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;

  const parts = cookieHeader.split(';').map((part) => part.trim());
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq);
    if (name === SESSION_COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1));
    }
  }
  return null;
}

export function buildSessionCookie(token: string, isProduction: boolean): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isProduction) attributes.push('Secure');
  return attributes.join('; ');
}

export function buildExpiredSessionCookie(isProduction: boolean): string {
  const attributes = [`${SESSION_COOKIE_NAME}=;`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
  if (isProduction) attributes.push('Secure');
  return attributes.join('; ');
}
```

- [ ] **Step 13: Run to verify it passes**

Run: `npx vitest run server/utils/cookies.test.ts`
Expected: PASS — 6 tests passing.

- [ ] **Step 14: Write `shared/permissions.ts`** (no test — pure constants)

```ts
export const PERMISSIONS = {
  ADMINS_MANAGE: 'admins:manage',
  ROLES_MANAGE: 'roles:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const SUPER_ADMIN_ROLE_NAME = '최고관리자';

export const SUPER_ADMIN_WILDCARD_PERMISSION = '*';
```

- [ ] **Step 15: Write the failing test `server/utils/validate.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { parseBody } from './validate';

describe('parseBody', () => {
  const schema = z.object({ email: z.string().email(), age: z.number().int().min(0) });

  it('returns the parsed data when the body is valid', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as never;
    const result = parseBody(schema, { email: 'a@b.com', age: 5 }, res, 'req-1');
    expect(result).toEqual({ email: 'a@b.com', age: 5 });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('responds with a 400 VALIDATION_ERROR envelope and returns undefined on invalid input', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status } as never;

    const result = parseBody(schema, { email: 'not-an-email', age: -1 }, res, 'req-2');

    expect(result).toBeUndefined();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
          requestId: 'req-2',
          fieldErrors: expect.objectContaining({
            email: expect.any(Array),
            age: expect.any(Array),
          }),
        }),
      })
    );
  });
});
```

- [ ] **Step 16: Run to verify it fails**

Run: `npx vitest run server/utils/validate.test.ts`
Expected: FAIL — `Cannot find module './validate'`.

- [ ] **Step 17: Write `server/utils/validate.ts`**

```ts
import type { Response } from 'express';
import type { ZodType } from 'zod';

export function parseBody<T>(
  schema: ZodType<T>,
  body: unknown,
  res: Response,
  requestId: string
): T | undefined {
  const result = schema.safeParse(body);

  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_root';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: '입력값을 확인해 주세요.',
        fieldErrors,
        requestId,
      },
    });
    return undefined;
  }

  return result.data;
}
```

- [ ] **Step 18: Run to verify it passes**

Run: `npx vitest run server/utils/validate.test.ts`
Expected: PASS — 2 tests passing.

- [ ] **Step 19: Commit**

```bash
git add shared/permissions.ts server/utils
git commit -m "feat: add password hashing, session token, cookie, and validation utilities"
```

---

## Task 3: Admin bootstrap on server start

**Files:**
- Create: `server/services/bootstrapAdmin.ts`, `server/services/bootstrapAdmin.test.ts`
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: `db`, `roles`, `admins` from Task 1; `hashPassword` from Task 2; `SUPER_ADMIN_ROLE_NAME`, `SUPER_ADMIN_WILDCARD_PERMISSION` from Task 2.
- Produces: `bootstrapAdmin(env: Pick<Env, 'INITIAL_ADMIN_EMAIL'|'INITIAL_ADMIN_PASSWORD'|'INITIAL_ADMIN_NAME'>): Promise<void>` — called once from `server/index.ts` before `app.listen`.

- [ ] **Step 1: Write the failing test `server/services/bootstrapAdmin.test.ts`**

This is an integration test against the real dev DB. It cleans up its own rows.

```ts
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { admins, roles } from '@shared/schema';
import { SUPER_ADMIN_ROLE_NAME } from '@shared/permissions';
import { verifyPassword } from '../utils/password';
import { bootstrapAdmin } from './bootstrapAdmin';

const TEST_EMAIL = 'test-bootstrap-admin@example.com';

async function cleanup(): Promise<void> {
  await db.delete(admins).where(eq(admins.email, TEST_EMAIL));
  await db.delete(roles).where(eq(roles.name, SUPER_ADMIN_ROLE_NAME));
}

describe('bootstrapAdmin', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('creates the super-admin role and initial admin when none exists', async () => {
    await cleanup();

    await bootstrapAdmin({
      INITIAL_ADMIN_EMAIL: TEST_EMAIL,
      INITIAL_ADMIN_PASSWORD: 'initial-password-123',
      INITIAL_ADMIN_NAME: '테스트관리자',
    });

    const [role] = await db.select().from(roles).where(eq(roles.name, SUPER_ADMIN_ROLE_NAME));
    expect(role).toBeDefined();
    expect(role.permissions).toEqual(['*']);

    const [admin] = await db.select().from(admins).where(eq(admins.email, TEST_EMAIL));
    expect(admin).toBeDefined();
    expect(admin.name).toBe('테스트관리자');
    expect(admin.roleId).toBe(role.id);
    await expect(verifyPassword('initial-password-123', admin.passwordHash)).resolves.toBe(true);
  });

  it('does nothing on a second run once a super-admin already exists', async () => {
    await cleanup();

    await bootstrapAdmin({
      INITIAL_ADMIN_EMAIL: TEST_EMAIL,
      INITIAL_ADMIN_PASSWORD: 'initial-password-123',
      INITIAL_ADMIN_NAME: '테스트관리자',
    });
    await bootstrapAdmin({
      INITIAL_ADMIN_EMAIL: 'test-bootstrap-admin-2@example.com',
      INITIAL_ADMIN_PASSWORD: 'different-password-456',
      INITIAL_ADMIN_NAME: '다른관리자',
    });

    const allAdmins = await db
      .select()
      .from(admins)
      .where(
        and(eq(admins.email, TEST_EMAIL))
      );
    expect(allAdmins).toHaveLength(1);

    const second = await db
      .select()
      .from(admins)
      .where(eq(admins.email, 'test-bootstrap-admin-2@example.com'));
    expect(second).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/services/bootstrapAdmin.test.ts`
Expected: FAIL — `Cannot find module './bootstrapAdmin'`.

- [ ] **Step 3: Write `server/services/bootstrapAdmin.ts`**

```ts
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { admins, roles } from '@shared/schema';
import { SUPER_ADMIN_ROLE_NAME, SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { hashPassword } from '../utils/password';

interface BootstrapEnv {
  INITIAL_ADMIN_EMAIL: string;
  INITIAL_ADMIN_PASSWORD: string;
  INITIAL_ADMIN_NAME: string;
}

export async function bootstrapAdmin(env: BootstrapEnv): Promise<void> {
  const [existingSuperAdminRole] = await db
    .select()
    .from(roles)
    .where(eq(roles.name, SUPER_ADMIN_ROLE_NAME));

  if (existingSuperAdminRole) {
    const [existingAdmin] = await db
      .select()
      .from(admins)
      .where(eq(admins.roleId, existingSuperAdminRole.id));
    if (existingAdmin) {
      return;
    }
  }

  const role =
    existingSuperAdminRole ??
    (
      await db
        .insert(roles)
        .values({
          name: SUPER_ADMIN_ROLE_NAME,
          permissions: [SUPER_ADMIN_WILDCARD_PERMISSION],
          isSystem: true,
        })
        .returning()
    )[0];

  const passwordHash = await hashPassword(env.INITIAL_ADMIN_PASSWORD);

  try {
    await db.insert(admins).values({
      email: env.INITIAL_ADMIN_EMAIL,
      name: env.INITIAL_ADMIN_NAME,
      passwordHash,
      roleId: role.id,
      status: 'active',
    });
    console.log('Initial super-admin created.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('admins_email_unique')) {
      console.log('Initial super-admin already exists (race on first boot), skipping.');
      return;
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/services/bootstrapAdmin.test.ts`
Expected: PASS — 2 tests passing, against the real dev DB.

- [ ] **Step 5: Wire into `server/index.ts`**

```ts
import { createApp } from './app';
import { loadEnv } from './env';
import { bootstrapAdmin } from './services/bootstrapAdmin';

const env = loadEnv();

async function main() {
  await bootstrapAdmin(env);

  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`API server listening on http://localhost:${env.PORT}`);
  });
}

main().catch((error: unknown) => {
  console.error('Failed to start server:', error);
  process.exitCode = 1;
});
```

- [ ] **Step 6: Verify the real admin gets bootstrapped**

Run: `npm run dev:server` in the background, wait ~2 seconds, then check the log output shows either "Initial super-admin created." (first time) or nothing/no error (if already bootstrapped from a prior run). Then stop the server and verify via `netstat -ano | grep :8787` that nothing is left listening.

- [ ] **Step 7: Commit**

```bash
git add server/services/bootstrapAdmin.ts server/services/bootstrapAdmin.test.ts server/index.ts
git commit -m "feat: bootstrap the initial super-admin on server start"
```

---

## Task 4: Login, session middleware, logout, /api/auth/me

**Files:**
- Create: `server/services/session.ts` + test, `server/middleware/auth.ts` + test, `server/utils/rateLimit.ts` + test, `server/routes/auth.ts` + test
- Modify: `server/app.ts`, `client/src/lib/apiClient.ts` + test

**Interfaces:**
- Consumes: `db`, `admins`, `roles`, `authSessions` (Task 1); `hashPassword`/`verifyPassword`, `generateToken`/`hashToken`, cookie helpers, `parseBody` (Task 2).
- Produces: `createSession(adminId, secret): Promise<{ token, expiresAt }>`, `revokeSession(tokenHash): Promise<void>`, `revokeAllSessionsForAdmin(adminId): Promise<void>`, `getAdminBySessionToken(rawToken, secret): Promise<AdminSessionContext | null>` from `server/services/session.ts` — used by Task 5 (revoke on password change) and Task 6 (revoke on deactivate). `createRequireAuth(secret): RequestHandler` from `server/middleware/auth.ts`, attaching `req.admin: AdminSessionContext` — used by Task 6's routes and Task 7's client auth checks (indirectly, via `/api/auth/me`). `createRateLimiter({limit, windowMs}): (key, now?) => boolean` from `server/utils/rateLimit.ts` — reused by Task 5's forgot-password endpoint. `createAuthRouter(deps: { sessionSecret: string }): Router` from `server/routes/auth.ts`, mounted at `/api/auth` — Task 5 extends this same router/file. `apiPost<T>(path, body): Promise<T>` from `client/src/lib/apiClient.ts` — used by Task 7.

- [ ] **Step 1: Write the failing test `server/services/session.test.ts`**

```ts
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { admins, authSessions, roles } from '@shared/schema';
import { hashPassword } from '../utils/password';
import {
  createSession,
  getAdminBySessionToken,
  revokeAllSessionsForAdmin,
  revokeSession,
} from './session';

const SECRET = 'test-session-secret-value';
const TEST_EMAIL = 'test-session-admin@example.com';

async function makeTestAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-session-role', permissions: ['x:y'] })
    .returning();
  const [admin] = await db
    .insert(admins)
    .values({
      email: TEST_EMAIL,
      name: '세션테스트',
      passwordHash: await hashPassword('irrelevant'),
      roleId: role.id,
      status: 'active',
    })
    .returning();
  return { role, admin };
}

describe('session service', () => {
  // A single robust afterEach (rather than an inline cleanup() call at the end of each test)
  // so a failed assertion mid-test still leaves the DB clean for the next test — an assertion
  // throw would otherwise skip an inline cleanup call and leave a session row that blocks the
  // next test's admin deletion via the auth_sessions -> admins foreign key.
  afterEach(async () => {
    const [admin] = await db.select().from(admins).where(eq(admins.email, TEST_EMAIL));
    if (admin) {
      await db.delete(authSessions).where(eq(authSessions.adminId, admin.id));
      await db.delete(admins).where(eq(admins.id, admin.id));
    }
    await db.delete(roles).where(eq(roles.name, 'test-session-role'));
  });

  it('creates a session and resolves it back to the admin via the raw token', async () => {
    const { role, admin } = await makeTestAdmin();

    const { token } = await createSession(admin.id, SECRET);
    const resolved = await getAdminBySessionToken(token, SECRET);

    expect(resolved?.id).toBe(admin.id);
    expect(resolved?.email).toBe(TEST_EMAIL);
    expect(resolved?.roleName).toBe(role.name);
    expect(resolved?.permissions).toEqual(['x:y']);
  });

  it('returns null for an unknown token', async () => {
    await expect(getAdminBySessionToken('not-a-real-token', SECRET)).resolves.toBeNull();
  });

  it('returns null after the session is revoked', async () => {
    const { admin } = await makeTestAdmin();
    const { token } = await createSession(admin.id, SECRET);

    const { hashToken } = await import('../utils/sessionToken');
    await revokeSession(hashToken(token, SECRET));

    await expect(getAdminBySessionToken(token, SECRET)).resolves.toBeNull();
  });

  it('revokeAllSessionsForAdmin invalidates every session for that admin', async () => {
    const { admin } = await makeTestAdmin();
    const first = await createSession(admin.id, SECRET);
    const second = await createSession(admin.id, SECRET);

    await revokeAllSessionsForAdmin(admin.id);

    await expect(getAdminBySessionToken(first.token, SECRET)).resolves.toBeNull();
    await expect(getAdminBySessionToken(second.token, SECRET)).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/services/session.test.ts`
Expected: FAIL — `Cannot find module './session'`.

- [ ] **Step 3: Write `server/services/session.ts`**

```ts
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db';
import { admins, authSessions, roles } from '@shared/schema';
import { generateToken, hashToken } from '../utils/sessionToken';
import { SESSION_MAX_AGE_SECONDS } from '../utils/cookies';

export interface AdminSessionContext {
  id: string;
  email: string;
  name: string;
  roleId: string;
  roleName: string;
  permissions: string[];
}

export async function createSession(
  adminId: string,
  secret: string
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await db.insert(authSessions).values({
    adminId,
    tokenHash: hashToken(token, secret),
    expiresAt,
  });

  return { token, expiresAt };
}

export async function revokeSession(tokenHash: string): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt)));
}

export async function revokeAllSessionsForAdmin(adminId: string): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.adminId, adminId), isNull(authSessions.revokedAt)));
}

export async function getAdminBySessionToken(
  rawToken: string,
  secret: string
): Promise<AdminSessionContext | null> {
  const tokenHash = hashToken(rawToken, secret);
  const now = new Date();

  const rows = await db
    .select({
      adminId: admins.id,
      email: admins.email,
      name: admins.name,
      status: admins.status,
      roleId: roles.id,
      roleName: roles.name,
      permissions: roles.permissions,
    })
    .from(authSessions)
    .innerJoin(admins, eq(authSessions.adminId, admins.id))
    .innerJoin(roles, eq(admins.roleId, roles.id))
    .where(
      and(
        eq(authSessions.tokenHash, tokenHash),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, now),
        isNull(admins.deletedAt)
      )
    );

  const row = rows[0];
  if (!row || row.status !== 'active') return null;

  return {
    id: row.adminId,
    email: row.email,
    name: row.name,
    roleId: row.roleId,
    roleName: row.roleName,
    permissions: row.permissions,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/services/session.test.ts`
Expected: PASS — 4 tests passing, against the real dev DB.

- [ ] **Step 5: Write the failing test `server/utils/rateLimit.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rateLimit';

describe('createRateLimiter', () => {
  it('allows requests up to the limit within the window', () => {
    const isAllowed = createRateLimiter({ limit: 3, windowMs: 1000 });
    expect(isAllowed('key-a', 0)).toBe(true);
    expect(isAllowed('key-a', 10)).toBe(true);
    expect(isAllowed('key-a', 20)).toBe(true);
    expect(isAllowed('key-a', 30)).toBe(false);
  });

  it('tracks separate keys independently', () => {
    const isAllowed = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(isAllowed('key-a', 0)).toBe(true);
    expect(isAllowed('key-b', 0)).toBe(true);
  });

  it('allows requests again once old ones fall outside the window', () => {
    const isAllowed = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(isAllowed('key-a', 0)).toBe(true);
    expect(isAllowed('key-a', 500)).toBe(false);
    expect(isAllowed('key-a', 1500)).toBe(true);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run server/utils/rateLimit.test.ts`
Expected: FAIL — `Cannot find module './rateLimit'`.

- [ ] **Step 7: Write `server/utils/rateLimit.ts`**

```ts
interface RateLimiterOptions {
  limit: number;
  windowMs: number;
}

export function createRateLimiter({ limit, windowMs }: RateLimiterOptions) {
  const hits = new Map<string, number[]>();

  return function isAllowed(key: string, now: number = Date.now()): boolean {
    const timestamps = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

    if (timestamps.length >= limit) {
      hits.set(key, timestamps);
      return false;
    }

    timestamps.push(now);
    hits.set(key, timestamps);
    return true;
  };
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run server/utils/rateLimit.test.ts`
Expected: PASS — 3 tests passing.

- [ ] **Step 9: Write `server/middleware/auth.ts`**

No test file for this one — it's a thin adapter over `session.ts` (already tested) and Express request/response, exercised end-to-end by `server/routes/auth.test.ts` in Step 12 below.

```ts
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { readSessionCookie } from '../utils/cookies';
import { getAdminBySessionToken, type AdminSessionContext } from '../services/session';

declare module 'express-serve-static-core' {
  interface Request {
    admin?: AdminSessionContext;
  }
}

export function createRequireAuth(secret: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = readSessionCookie(req.headers.cookie);

    if (!token) {
      res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: '로그인이 필요합니다.', requestId: req.requestId },
      });
      return;
    }

    const admin = await getAdminBySessionToken(token, secret);
    if (!admin) {
      res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: '로그인이 필요합니다.', requestId: req.requestId },
      });
      return;
    }

    req.admin = admin;
    next();
  };
}
```

- [ ] **Step 10: Write `server/routes/auth.ts`** (login, logout, me — forgot/reset-password added in Task 5)

```ts
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { admins } from '@shared/schema';
import { verifyPassword } from '../utils/password';
import { buildExpiredSessionCookie, buildSessionCookie } from '../utils/cookies';
import { parseBody } from '../utils/validate';
import { createRateLimiter } from '../utils/rateLimit';
import { createRequireAuth } from '../middleware/auth';
import { createSession, revokeSession } from '../services/session';
import { hashToken } from '../utils/sessionToken';
import { readSessionCookie } from '../utils/cookies';
import { getNowKSTISOString } from '@shared/kst';

const GENERIC_LOGIN_FAILURE = { code: 'UNAUTHENTICATED', message: '이메일 또는 비밀번호가 올바르지 않습니다.' };
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export interface AuthRouterDeps {
  sessionSecret: string;
  isProduction: boolean;
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const loginLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });

  router.post('/login', async (req, res) => {
    if (!loginLimiter(req.ip ?? 'unknown')) {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: '잠시 후 다시 시도해 주세요.', requestId: req.requestId },
      });
      return;
    }

    const parsed = parseBody(loginSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [admin] = await db.select().from(admins).where(eq(admins.email, parsed.email));

    if (!admin || admin.status !== 'active' || (admin.lockedUntil && admin.lockedUntil > new Date())) {
      res.status(401).json({ error: { ...GENERIC_LOGIN_FAILURE, requestId: req.requestId } });
      return;
    }

    const passwordOk = await verifyPassword(parsed.password, admin.passwordHash);
    if (!passwordOk) {
      const failedCount = admin.failedLoginCount + 1;
      const shouldLock = failedCount >= MAX_FAILED_LOGINS;
      await db
        .update(admins)
        .set({
          failedLoginCount: shouldLock ? 0 : failedCount,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MS) : admin.lockedUntil,
          updatedAt: new Date(),
        })
        .where(eq(admins.id, admin.id));
      res.status(401).json({ error: { ...GENERIC_LOGIN_FAILURE, requestId: req.requestId } });
      return;
    }

    await db
      .update(admins)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(admins.id, admin.id));

    const { token } = await createSession(admin.id, deps.sessionSecret);
    res.setHeader('Set-Cookie', buildSessionCookie(token, deps.isProduction));
    res.json({
      data: { id: admin.id, email: admin.email, name: admin.name },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.post('/logout', requireAuth, async (req, res) => {
    const token = readSessionCookie(req.headers.cookie);
    if (token) {
      await revokeSession(hashToken(token, deps.sessionSecret));
    }
    res.setHeader('Set-Cookie', buildExpiredSessionCookie(deps.isProduction));
    res.json({
      data: { success: true },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({
      data: {
        id: req.admin!.id,
        email: req.admin!.email,
        name: req.admin!.name,
        role: { id: req.admin!.roleId, name: req.admin!.roleName, permissions: req.admin!.permissions },
      },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  return router;
}
```

- [ ] **Step 11: Wire the auth router into `server/app.ts`**

```ts
import express, { type Express } from 'express';
import { requestId } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import { healthRouter } from './routes/health';
import { createAuthRouter } from './routes/auth';
import { loadEnv } from './env';

export function createApp(): Express {
  const env = loadEnv();
  const app = express();

  app.use(requestId);
  app.use(express.json());
  app.use(
    '/api/auth',
    createAuthRouter({ sessionSecret: env.AUTH_SESSION_SECRET, isProduction: env.NODE_ENV === 'production' })
  );
  app.use('/api', healthRouter);
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: '요청한 API를 찾을 수 없습니다.',
        requestId: req.requestId,
      },
    });
  });
  app.use(errorHandler);

  return app;
}
```

- [ ] **Step 12: Write `server/routes/auth.test.ts`** (integration, real DB)

```ts
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, authSessions, roles } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { createApp } from '../app';

const TEST_EMAIL = 'test-auth-route-admin@example.com';
const TEST_PASSWORD = 'correct-password-123';

async function seedAdmin() {
  const [role] = await db.insert(roles).values({ name: 'test-auth-role', permissions: ['x:y'] }).returning();
  const [admin] = await db
    .insert(admins)
    .values({
      email: TEST_EMAIL,
      name: '인증테스트',
      passwordHash: await hashPassword(TEST_PASSWORD),
      roleId: role.id,
      status: 'active',
    })
    .returning();
  return { role, admin };
}

// Several tests below log in for real, which inserts an auth_sessions row — that row must be
// deleted before the admin it references, or the admin delete fails on the foreign key.
async function cleanup() {
  const [admin] = await db.select().from(admins).where(eq(admins.email, TEST_EMAIL));
  if (admin) {
    await db.delete(authSessions).where(eq(authSessions.adminId, admin.id));
  }
  await db.delete(admins).where(eq(admins.email, TEST_EMAIL));
  await db.delete(roles).where(eq(roles.name, 'test-auth-role'));
}

describe('auth routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('logs in with correct credentials and sets a session cookie', async () => {
    await seedAdmin();
    const app = createApp();

    const response = await request(app).post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.data.email).toBe(TEST_EMAIL);
    expect(response.headers['set-cookie']?.[0]).toContain('academy_session=');
  });

  it('rejects an incorrect password with a generic message', async () => {
    await seedAdmin();
    const app = createApp();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'wrong-password' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a login for an email that does not exist with the same generic message', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'no-such-admin@example.com', password: 'whatever123' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('GET /me returns 401 without a session cookie', async () => {
    const app = createApp();
    const response = await request(app).get('/api/auth/me');
    expect(response.status).toBe(401);
  });

  it('logs in, then GET /me returns the admin, then logout invalidates the session', async () => {
    await seedAdmin();
    const app = createApp();

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const cookie = loginResponse.headers['set-cookie'][0];

    const meResponse = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.data.email).toBe(TEST_EMAIL);

    const logoutResponse = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(logoutResponse.status).toBe(200);

    const meAfterLogout = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(meAfterLogout.status).toBe(401);
  });
});
```

- [ ] **Step 13: Run to verify it passes**

Run: `npx vitest run server/routes/auth.test.ts`
Expected: PASS — 5 tests passing, against the real dev DB.

- [ ] **Step 14: Add `apiPost` to the browser API client**

Add to `client/src/lib/apiClient.ts` (keep the existing `apiGet`/`ApiRequestError`/`throwInvalidResponse` unchanged):

```ts
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
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
```

Add matching tests to `client/src/lib/apiClient.test.ts` (alongside the existing `apiGet` describe block — do not remove or alter the existing tests):

```ts
describe('apiPost', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a JSON body and returns the data payload on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { id: '1' },
        meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:30:00+09:00' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiPost('/api/auth/login', { email: 'a@b.com', password: 'x' })).resolves.toEqual({
      id: '1',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'a@b.com', password: 'x' }) })
    );
  });

  it('throws ApiRequestError with the server-provided code and message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { code: 'UNAUTHENTICATED', message: '이메일 또는 비밀번호가 올바르지 않습니다.', requestId: 'req-2' },
        }),
      })
    );

    await expect(apiPost('/api/auth/login', {})).rejects.toBeInstanceOf(ApiRequestError);
  });
});
```

Add the required imports at the top of the test file if not already present: `apiPost` alongside `apiGet, ApiRequestError`.

- [ ] **Step 15: Run the full apiClient test file**

Run: `npx vitest run client/src/lib/apiClient.test.ts`
Expected: PASS — all tests (existing `apiGet` tests + new `apiPost` tests) passing.

- [ ] **Step 16: Run check and the full suite**

Run:
```bash
npm run check
npx vitest run
```
Expected: both clean.

- [ ] **Step 17: Commit**

```bash
git add server/services/session.ts server/services/session.test.ts server/middleware/auth.ts server/utils/rateLimit.ts server/utils/rateLimit.test.ts server/routes/auth.ts server/routes/auth.test.ts server/app.ts client/src/lib/apiClient.ts client/src/lib/apiClient.test.ts
git commit -m "feat: add login, session middleware, logout, and /api/auth/me"
```

---

## Task 5: Password reset via Resend

**Files:**
- Create: `server/services/email.ts`, `server/services/passwordReset.ts` + test
- Modify: `server/routes/auth.ts` + test, `server/app.ts`

**Interfaces:**
- Consumes: `db`, `admins`, `passwordResetTokens` (Task 1); `hashPassword`, `generateToken`/`hashToken`, `parseBody` (Task 2); `revokeAllSessionsForAdmin` (Task 4).
- Produces: `EmailAdapter` interface + `createResendEmailAdapter(apiKey, fromEmail): EmailAdapter` + `createFakeEmailAdapter(): EmailAdapter & { sentEmails: Array<{to,resetUrl}> }` from `server/services/email.ts` — the fake is used by `auth.test.ts` and by Task 6's admin `send-reset` tests. `requestPasswordReset(email, appUrl, emailAdapter): Promise<void>`, `resetPassword(rawToken, newPassword): Promise<{ success: true } | { success: false; code: string }>` from `server/services/passwordReset.ts` — used by `auth.ts` and by Task 6's `POST /api/admins/:id/send-reset`. `AppOverrides.emailAdapter?: EmailAdapter` on `createApp()` — used by every test file that exercises password reset.

- [ ] **Step 1: Install dependency**

```bash
npm install resend
```

- [ ] **Step 2: Write `server/services/email.ts`** (no dedicated test file — it's a thin wrapper; the fake adapter is exercised by consumers' tests)

```ts
import { Resend } from 'resend';

export interface EmailAdapter {
  sendPasswordResetEmail(to: string, resetUrl: string): Promise<void>;
}

export function createResendEmailAdapter(apiKey: string, fromEmail: string): EmailAdapter {
  const resend = new Resend(apiKey);

  return {
    async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
      await resend.emails.send({
        from: fromEmail,
        to,
        subject: '비밀번호 재설정 안내',
        html: `<p>아래 링크를 눌러 비밀번호를 재설정하세요. 이 링크는 30분간 유효합니다.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
      });
    },
  };
}

export function createFakeEmailAdapter(): EmailAdapter & { sentEmails: Array<{ to: string; resetUrl: string }> } {
  const sentEmails: Array<{ to: string; resetUrl: string }> = [];
  return {
    sentEmails,
    async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
      sentEmails.push({ to, resetUrl });
    },
  };
}
```

- [ ] **Step 3: Write the failing test `server/services/passwordReset.test.ts`**

```ts
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { admins, passwordResetTokens, roles } from '@shared/schema';
import { hashPassword, verifyPassword } from '../utils/password';
import { createFakeEmailAdapter } from './email';
import { requestPasswordReset, resetPassword } from './passwordReset';

const TEST_EMAIL = 'test-password-reset-admin@example.com';

async function seedAdmin() {
  const [role] = await db.insert(roles).values({ name: 'test-reset-role', permissions: [] }).returning();
  const [admin] = await db
    .insert(admins)
    .values({
      email: TEST_EMAIL,
      name: '재설정테스트',
      passwordHash: await hashPassword('original-password-123'),
      roleId: role.id,
      status: 'active',
    })
    .returning();
  return { role, admin };
}

async function cleanup() {
  const [admin] = await db.select().from(admins).where(eq(admins.email, TEST_EMAIL));
  if (admin) {
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.adminId, admin.id));
  }
  await db.delete(admins).where(eq(admins.email, TEST_EMAIL));
  await db.delete(roles).where(eq(roles.name, 'test-reset-role'));
}

describe('password reset service', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('sends a reset email with a working token when the admin exists', async () => {
    await seedAdmin();
    const emailAdapter = createFakeEmailAdapter();

    await requestPasswordReset(TEST_EMAIL, 'http://localhost:5173', emailAdapter);

    expect(emailAdapter.sentEmails).toHaveLength(1);
    expect(emailAdapter.sentEmails[0].to).toBe(TEST_EMAIL);
    expect(emailAdapter.sentEmails[0].resetUrl).toMatch(/^http:\/\/localhost:5173\/reset-password\?token=/);
  });

  it('does nothing (no throw, no email) when the email does not exist', async () => {
    const emailAdapter = createFakeEmailAdapter();
    await requestPasswordReset('no-such-admin@example.com', 'http://localhost:5173', emailAdapter);
    expect(emailAdapter.sentEmails).toHaveLength(0);
  });

  it('resets the password with a valid token and invalidates the token afterward', async () => {
    await seedAdmin();
    const emailAdapter = createFakeEmailAdapter();
    await requestPasswordReset(TEST_EMAIL, 'http://localhost:5173', emailAdapter);
    const rawToken = new URL(emailAdapter.sentEmails[0].resetUrl).searchParams.get('token')!;

    const result = await resetPassword(rawToken, 'brand-new-password-456');
    expect(result.success).toBe(true);

    const [admin] = await db.select().from(admins).where(eq(admins.email, TEST_EMAIL));
    await expect(verifyPassword('brand-new-password-456', admin.passwordHash)).resolves.toBe(true);

    const second = await resetPassword(rawToken, 'another-password-789');
    expect(second.success).toBe(false);
  });

  it('rejects an unknown token', async () => {
    const result = await resetPassword('not-a-real-token', 'whatever-password-123');
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run server/services/passwordReset.test.ts`
Expected: FAIL — `Cannot find module './passwordReset'`.

- [ ] **Step 5: Write `server/services/passwordReset.ts`**

```ts
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { admins, passwordResetTokens } from '@shared/schema';
import { generateToken, hashToken } from '../utils/sessionToken';
import { hashPassword } from '../utils/password';
import { revokeAllSessionsForAdmin } from './session';
import type { EmailAdapter } from './email';

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
// This module does not receive AUTH_SESSION_SECRET directly to keep its signature small;
// reset tokens are hashed with a fixed, distinct label so they can never collide with a
// session-token hash even if the same secret value were reused.
const RESET_TOKEN_HASH_SECRET_SUFFIX = ':password-reset';

function hashResetToken(rawToken: string, secret: string): string {
  return hashToken(rawToken, secret + RESET_TOKEN_HASH_SECRET_SUFFIX);
}

export async function requestPasswordReset(
  email: string,
  appUrl: string,
  emailAdapter: EmailAdapter,
  secret: string = process.env.AUTH_SESSION_SECRET ?? ''
): Promise<void> {
  const [admin] = await db.select().from(admins).where(eq(admins.email, email));
  if (!admin || admin.status !== 'active') {
    return;
  }

  const rawToken = generateToken();
  await db.insert(passwordResetTokens).values({
    adminId: admin.id,
    tokenHash: hashResetToken(rawToken, secret),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });

  const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;
  await emailAdapter.sendPasswordResetEmail(admin.email, resetUrl);
}

export async function resetPassword(
  rawToken: string,
  newPassword: string,
  secret: string = process.env.AUTH_SESSION_SECRET ?? ''
): Promise<{ success: true } | { success: false; code: string }> {
  const tokenHash = hashResetToken(rawToken, secret);
  const now = new Date();

  const [tokenRow] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt)
      )
    );

  if (!tokenRow || tokenRow.expiresAt < now) {
    return { success: false, code: 'INVALID_RESET_TOKEN' };
  }

  const passwordHash = await hashPassword(newPassword);

  await db.update(admins).set({ passwordHash, updatedAt: now }).where(eq(admins.id, tokenRow.adminId));
  await db.update(passwordResetTokens).set({ usedAt: now }).where(eq(passwordResetTokens.id, tokenRow.id));
  await revokeAllSessionsForAdmin(tokenRow.adminId);

  return { success: true };
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run server/services/passwordReset.test.ts`
Expected: PASS — 4 tests passing, against the real dev DB.

- [ ] **Step 7: Extend `server/routes/auth.ts`** — add forgot-password and reset-password endpoints, and change `AuthRouterDeps`/`createAuthRouter` to accept an `emailAdapter`

Add to the imports:
```ts
import { requestPasswordReset, resetPassword } from '../services/passwordReset';
import type { EmailAdapter } from '../services/email';
```

Change the `AuthRouterDeps` interface to add `emailAdapter: EmailAdapter; appUrl: string;`, then add these two routes inside `createAuthRouter` (reuse a second `createRateLimiter` instance scoped to forgot-password, separate from the login limiter):

```ts
const forgotPasswordLimiter = createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000 });
const forgotPasswordSchema = z.object({ email: z.string().email() });
const resetPasswordSchema = z.object({ token: z.string().min(1), newPassword: z.string().min(8) });

router.post('/forgot-password', async (req, res) => {
  if (!forgotPasswordLimiter(req.ip ?? 'unknown')) {
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: '잠시 후 다시 시도해 주세요.', requestId: req.requestId },
    });
    return;
  }

  const parsed = parseBody(forgotPasswordSchema, req.body, res, req.requestId);
  if (!parsed) return;

  await requestPasswordReset(parsed.email, deps.appUrl, deps.emailAdapter, deps.sessionSecret);

  res.json({
    data: { message: '입력하신 이메일이 등록되어 있다면 재설정 안내를 보냈습니다.' },
    meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
  });
});

router.post('/reset-password', async (req, res) => {
  const parsed = parseBody(resetPasswordSchema, req.body, res, req.requestId);
  if (!parsed) return;

  const result = await resetPassword(parsed.token, parsed.newPassword, deps.sessionSecret);
  if (!result.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_RESET_TOKEN',
        message: '재설정 링크가 유효하지 않거나 만료되었습니다.',
        requestId: req.requestId,
      },
    });
    return;
  }

  res.json({
    data: { success: true },
    meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
  });
});
```

- [ ] **Step 8: Update `server/app.ts`** to build the real deps and pass them to `createAuthRouter`

```ts
import { createResendEmailAdapter } from './services/email';

export interface AppOverrides {
  emailAdapter?: import('./services/email').EmailAdapter;
}

export function createApp(overrides: AppOverrides = {}): Express {
  const env = loadEnv();
  const app = express();

  const emailAdapter = overrides.emailAdapter ?? createResendEmailAdapter(env.RESEND_API_KEY, env.RESEND_FROM_EMAIL);

  app.use(requestId);
  app.use(express.json());
  app.use(
    '/api/auth',
    createAuthRouter({
      sessionSecret: env.AUTH_SESSION_SECRET,
      isProduction: env.NODE_ENV === 'production',
      emailAdapter,
      appUrl: env.APP_URL ?? 'http://localhost:5173',
    })
  );
  app.use('/api', healthRouter);
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: '요청한 API를 찾을 수 없습니다.', requestId: req.requestId },
    });
  });
  app.use(errorHandler);

  return app;
}
```

(Merge this carefully with the existing `server/app.ts` from Task 4 rather than overwriting unrelated parts — only the `AppOverrides` type, the `emailAdapter` construction line, and the `createAuthRouter(...)` call site change.)

- [ ] **Step 9: Extend `server/routes/auth.test.ts`** — add forgot/reset-password tests, and pass a fake email adapter into `createApp`

Add near the top, replace every `createApp()` call in this file with `createApp({ emailAdapter: fakeEmailAdapter })` where `fakeEmailAdapter` is created fresh per test via `createFakeEmailAdapter()` from `../services/email` (add the import). Then add:

```ts
describe('forgot-password / reset-password', () => {
  it('always returns the same success message whether or not the email exists', async () => {
    const fakeEmailAdapter = createFakeEmailAdapter();
    const app = createApp({ emailAdapter: fakeEmailAdapter });

    const knownResponse = await request(app).post('/api/auth/forgot-password').send({ email: 'no-such-admin@example.com' });
    expect(knownResponse.status).toBe(200);
    expect(fakeEmailAdapter.sentEmails).toHaveLength(0);
  });

  it('sends a reset email for an existing admin and the token successfully resets the password', async () => {
    await seedAdmin();
    const fakeEmailAdapter = createFakeEmailAdapter();
    const app = createApp({ emailAdapter: fakeEmailAdapter });

    await request(app).post('/api/auth/forgot-password').send({ email: TEST_EMAIL });
    expect(fakeEmailAdapter.sentEmails).toHaveLength(1);
    const token = new URL(fakeEmailAdapter.sentEmails[0].resetUrl).searchParams.get('token');

    const resetResponse = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'a-brand-new-password-999' });
    expect(resetResponse.status).toBe(200);

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'a-brand-new-password-999' });
    expect(loginResponse.status).toBe(200);
  });

  it('rejects an invalid reset token', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'not-a-real-token', newPassword: 'whatever-password-123' });
    expect(response.status).toBe(400);
  });
});
```

Add `import { createFakeEmailAdapter } from '../services/email';` to the file's imports.

- [ ] **Step 10: Run the full auth route test file**

Run: `npx vitest run server/routes/auth.test.ts`
Expected: PASS — all tests (existing + new), against the real dev DB, with zero real emails sent (fake adapter records instead of calling Resend).

- [ ] **Step 11: Run check and the full suite**

Run:
```bash
npm run check
npx vitest run
```
Expected: both clean.

- [ ] **Step 12: Commit**

```bash
git add server/services/email.ts server/services/passwordReset.ts server/services/passwordReset.test.ts server/routes/auth.ts server/routes/auth.test.ts server/app.ts package.json package-lock.json
git commit -m "feat: add Resend-based password reset flow"
```

---

## Task 6: Permission middleware, roles & admins CRUD, audit log

**Files:**
- Create: `server/services/audit.ts` + test, `server/middleware/permissions.ts` + test, `server/routes/roles.ts` + test, `server/routes/admins.ts` + test
- Modify: `server/app.ts`

**Interfaces:**
- Consumes: `db`, `roles`, `admins`, `auditLogs` (Task 1); `PERMISSIONS`, `SUPER_ADMIN_WILDCARD_PERMISSION` (Task 2); `hashPassword` (Task 2); `createRequireAuth`, `req.admin` (Task 4); `revokeAllSessionsForAdmin` (Task 4); `requestPasswordReset` (Task 5).
- Produces: `writeAuditLog(entry): Promise<void>` from `server/services/audit.ts` — used by `roles.ts` and `admins.ts`. `createRequirePermission(permission): RequestHandler` from `server/middleware/permissions.ts` — used by both new routers.

- [ ] **Step 1: Write the failing test `server/services/audit.test.ts`**

```ts
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { auditLogs } from '@shared/schema';
import { writeAuditLog } from './audit';

describe('writeAuditLog', () => {
  afterEach(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.requestId, 'test-audit-request-id'));
  });

  it('writes a row with the given fields', async () => {
    await writeAuditLog({
      adminId: null,
      roleSnapshot: '최고관리자',
      action: 'admin.create',
      targetType: 'admin',
      targetId: 'some-admin-id',
      beforeDataSafe: null,
      afterDataSafe: { email: 'a@b.com' },
      result: 'success',
      requestId: 'test-audit-request-id',
    });

    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.requestId, 'test-audit-request-id'));
    expect(row).toBeDefined();
    expect(row.action).toBe('admin.create');
    expect(row.targetType).toBe('admin');
    expect(row.result).toBe('success');
    expect(row.afterDataSafe).toEqual({ email: 'a@b.com' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/services/audit.test.ts`
Expected: FAIL — `Cannot find module './audit'`.

- [ ] **Step 3: Write `server/services/audit.ts`**

```ts
import { db } from '../db';
import { auditLogs } from '@shared/schema';

export interface AuditLogEntry {
  adminId: string | null;
  roleSnapshot: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  beforeDataSafe: unknown;
  afterDataSafe: unknown;
  result: 'success' | 'failure';
  requestId: string;
}

export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  await db.insert(auditLogs).values(entry);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/services/audit.test.ts`
Expected: PASS — 1 test passing, against the real dev DB.

- [ ] **Step 5: Write `server/middleware/permissions.ts`** (no dedicated test file — exercised end-to-end by `roles.test.ts`/`admins.test.ts` below, since it's a thin check over `req.admin` which is only meaningfully populated inside a full request)

```ts
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { SUPER_ADMIN_WILDCARD_PERMISSION, type Permission } from '@shared/permissions';

export function createRequirePermission(permission: Permission): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const admin = req.admin;
    if (!admin) {
      res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: '로그인이 필요합니다.', requestId: req.requestId },
      });
      return;
    }

    const hasPermission =
      admin.permissions.includes(SUPER_ADMIN_WILDCARD_PERMISSION) || admin.permissions.includes(permission);

    if (!hasPermission) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: '이 작업을 수행할 권한이 없습니다.', requestId: req.requestId },
      });
      return;
    }

    next();
  };
}
```

- [ ] **Step 6: Write the failing test `server/routes/roles.test.ts`**

```ts
import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, authSessions, roles } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { PERMISSIONS, SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-roles-super@example.com';
const PLAIN_EMAIL = 'test-roles-plain@example.com';
const PASSWORD = 'test-roles-password-123';

async function seedAdmins() {
  const [superRole] = await db
    .insert(roles)
    .values({ name: 'test-roles-super-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION] })
    .returning();
  const [plainRole] = await db
    .insert(roles)
    .values({ name: 'test-roles-plain-role', permissions: [] })
    .returning();
  const passwordHash = await hashPassword(PASSWORD);
  await db.insert(admins).values([
    { email: SUPER_EMAIL, name: '수퍼', passwordHash, roleId: superRole.id, status: 'active' },
    { email: PLAIN_EMAIL, name: '일반', passwordHash, roleId: plainRole.id, status: 'active' },
  ]);
  return { superRole, plainRole };
}

async function loginAs(app: ReturnType<typeof createApp>, email: string) {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return response.headers['set-cookie'][0];
}

// Deletes auth_sessions for both test admins first — several tests below log in for real,
// and a leftover session row would block deleting the admin it references via the foreign key.
async function cleanup(extraRoleNames: string[] = []) {
  const testAdmins = await db.select().from(admins).where(inArray(admins.email, [SUPER_EMAIL, PLAIN_EMAIL]));
  for (const admin of testAdmins) {
    await db.delete(authSessions).where(eq(authSessions.adminId, admin.id));
  }
  await db.delete(admins).where(eq(admins.email, SUPER_EMAIL));
  await db.delete(admins).where(eq(admins.email, PLAIN_EMAIL));
  await db.delete(roles).where(eq(roles.name, 'test-roles-super-role'));
  await db.delete(roles).where(eq(roles.name, 'test-roles-plain-role'));
  for (const name of extraRoleNames) {
    await db.delete(roles).where(eq(roles.name, name));
  }
}

describe('roles routes', () => {
  afterEach(async () => {
    await cleanup(['test-roles-new-role']);
  });

  it('allows a super-admin to create a role', async () => {
    await seedAdmins();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app)
      .post('/api/roles')
      .set('Cookie', cookie)
      .send({ name: 'test-roles-new-role', permissions: [PERMISSIONS.ADMINS_MANAGE] });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('test-roles-new-role');
  });

  it('rejects a non-super-admin without roles:manage permission', async () => {
    await seedAdmins();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, PLAIN_EMAIL);

    const response = await request(app)
      .post('/api/roles')
      .set('Cookie', cookie)
      .send({ name: 'test-roles-new-role', permissions: [] });

    expect(response.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const response = await request(app).get('/api/roles');
    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npx vitest run server/routes/roles.test.ts`
Expected: FAIL — `Cannot find module '../routes/roles'` (via `createApp` not yet mounting it — actually fails because `POST /api/roles` 404s, not because of a missing module; verify by running and confirming the first two tests fail with status 404 instead of 200/403).

- [ ] **Step 8: Write `server/routes/roles.ts`**

```ts
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS } from '@shared/permissions';
import { db } from '../db';
import { roles } from '@shared/schema';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';

const createRoleSchema = z.object({
  name: z.string().min(1),
  permissions: z.array(z.string()),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).optional(),
  permissions: z.array(z.string()).optional(),
});

export interface RolesRouterDeps {
  sessionSecret: string;
}

export function createRolesRouter(deps: RolesRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireRolesManage = createRequirePermission(PERMISSIONS.ROLES_MANAGE);

  router.get('/', requireAuth, requireRolesManage, async (req, res) => {
    const rows = await db.select().from(roles);
    res.json({ data: rows, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/', requireAuth, requireRolesManage, async (req, res) => {
    const parsed = parseBody(createRoleSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [created] = await db
      .insert(roles)
      .values({ name: parsed.name, permissions: parsed.permissions })
      .returning();

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'role.create',
      targetType: 'role',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { name: created.name, permissions: created.permissions },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: created, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/:id', requireAuth, requireRolesManage, async (req, res) => {
    const parsed = parseBody(updateRoleSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(roles).where(eq(roles.id, req.params.id));
    if (!before) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '역할을 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    const [updated] = await db
      .update(roles)
      .set({ ...parsed, updatedAt: new Date() })
      .where(eq(roles.id, req.params.id))
      .returning();

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'role.update',
      targetType: 'role',
      targetId: updated.id,
      beforeDataSafe: { name: before.name, permissions: before.permissions },
      afterDataSafe: { name: updated.name, permissions: updated.permissions },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: updated, meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  return router;
}
```

- [ ] **Step 9: Mount the roles router in `server/app.ts`**

Add the import and mount line (alongside the existing `/api/auth` mount, before the `/api` health/404 mounts):
```ts
import { createRolesRouter } from './routes/roles';
// ...
app.use('/api/roles', createRolesRouter({ sessionSecret: env.AUTH_SESSION_SECRET }));
```

- [ ] **Step 10: Run to verify the roles tests pass**

Run: `npx vitest run server/routes/roles.test.ts`
Expected: PASS — 3 tests passing.

- [ ] **Step 11: Write the failing test `server/routes/admins.test.ts`**

```ts
import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../db';
import { admins, authSessions, roles } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { createFakeEmailAdapter } from '../services/email';
import { createApp } from '../app';

const SUPER_EMAIL = 'test-admins-super@example.com';
const PASSWORD = 'test-admins-password-123';
const NEW_ADMIN_EMAIL = 'test-admins-new@example.com';

async function seedSuperAdmin() {
  const [role] = await db
    .insert(roles)
    .values({ name: 'test-admins-super-role', permissions: [SUPER_ADMIN_WILDCARD_PERMISSION] })
    .returning();
  const [admin] = await db
    .insert(admins)
    .values({
      email: SUPER_EMAIL,
      name: '수퍼',
      passwordHash: await hashPassword(PASSWORD),
      roleId: role.id,
      status: 'active',
    })
    .returning();
  return { role, admin };
}

async function loginAs(app: ReturnType<typeof createApp>, email: string) {
  const response = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return response.headers['set-cookie'][0];
}

// Deletes auth_sessions for both test admins first — several tests below log in for real,
// and a leftover session row would block deleting the admin it references via the foreign key.
async function cleanup() {
  const testAdmins = await db
    .select()
    .from(admins)
    .where(inArray(admins.email, [SUPER_EMAIL, NEW_ADMIN_EMAIL]));
  for (const admin of testAdmins) {
    await db.delete(authSessions).where(eq(authSessions.adminId, admin.id));
  }
  await db.delete(admins).where(eq(admins.email, SUPER_EMAIL));
  await db.delete(admins).where(eq(admins.email, NEW_ADMIN_EMAIL));
  await db.delete(roles).where(eq(roles.name, 'test-admins-super-role'));
}

describe('admins routes', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('creates a new admin under the same role', async () => {
    const { role } = await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app)
      .post('/api/admins')
      .set('Cookie', cookie)
      .send({ email: NEW_ADMIN_EMAIL, name: '새관리자', password: 'a-new-password-123', roleId: role.id });

    expect(response.status).toBe(200);
    expect(response.body.data.email).toBe(NEW_ADMIN_EMAIL);
    expect(response.body.data.passwordHash).toBeUndefined();
  });

  it('lists admins', async () => {
    await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app).get('/api/admins').set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('refuses to deactivate the last active super-admin', async () => {
    const { admin } = await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const response = await request(app).post(`/api/admins/${admin.id}/deactivate`).set('Cookie', cookie).send();

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('LAST_SUPER_ADMIN');
  });

  it('edits an admin with optimistic locking via updatedAt', async () => {
    const { role } = await seedSuperAdmin();
    const app = createApp({ emailAdapter: createFakeEmailAdapter() });
    const cookie = await loginAs(app, SUPER_EMAIL);

    const created = await request(app)
      .post('/api/admins')
      .set('Cookie', cookie)
      .send({ email: NEW_ADMIN_EMAIL, name: '새관리자', password: 'a-new-password-123', roleId: role.id });

    const editResponse = await request(app)
      .patch(`/api/admins/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ name: '수정된이름', expectedUpdatedAt: created.body.data.updatedAt });
    expect(editResponse.status).toBe(200);
    expect(editResponse.body.data.name).toBe('수정된이름');

    const staleEditResponse = await request(app)
      .patch(`/api/admins/${created.body.data.id}`)
      .set('Cookie', cookie)
      .send({ name: '또수정', expectedUpdatedAt: created.body.data.updatedAt });
    expect(staleEditResponse.status).toBe(409);
    expect(staleEditResponse.body.error.code).toBe('VERSION_CONFLICT');
  });
});
```

- [ ] **Step 12: Run to verify it fails**

Run: `npx vitest run server/routes/admins.test.ts`
Expected: FAIL — 404s (router not mounted yet).

- [ ] **Step 13: Write `server/routes/admins.ts`**

```ts
import { and, eq, isNull, ne } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getNowKSTISOString } from '@shared/kst';
import { PERMISSIONS, SUPER_ADMIN_WILDCARD_PERMISSION } from '@shared/permissions';
import { db } from '../db';
import { admins, roles } from '@shared/schema';
import { hashPassword } from '../utils/password';
import { parseBody } from '../utils/validate';
import { createRequireAuth } from '../middleware/auth';
import { createRequirePermission } from '../middleware/permissions';
import { writeAuditLog } from '../services/audit';
import { revokeAllSessionsForAdmin } from '../services/session';
import { requestPasswordReset } from '../services/passwordReset';
import type { EmailAdapter } from '../services/email';

const createAdminSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  roleId: z.string().uuid(),
});

const updateAdminSchema = z.object({
  name: z.string().min(1).optional(),
  roleId: z.string().uuid().optional(),
  status: z.enum(['active', 'inactive', 'locked']).optional(),
  expectedUpdatedAt: z.string(),
});

function toSafeAdmin(admin: typeof admins.$inferSelect) {
  const { passwordHash: _passwordHash, ...safe } = admin;
  return safe;
}

async function isLastActiveSuperAdmin(adminId: string, roleId: string): Promise<boolean> {
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId));
  if (!role || !role.permissions.includes(SUPER_ADMIN_WILDCARD_PERMISSION)) {
    return false;
  }

  const otherActiveSuperAdmins = await db
    .select({ id: admins.id })
    .from(admins)
    .where(and(eq(admins.roleId, roleId), eq(admins.status, 'active'), ne(admins.id, adminId), isNull(admins.deletedAt)));

  return otherActiveSuperAdmins.length === 0;
}

export interface AdminsRouterDeps {
  sessionSecret: string;
  appUrl: string;
  emailAdapter: EmailAdapter;
}

export function createAdminsRouter(deps: AdminsRouterDeps): Router {
  const router = Router();
  const requireAuth = createRequireAuth(deps.sessionSecret);
  const requireAdminsManage = createRequirePermission(PERMISSIONS.ADMINS_MANAGE);

  router.get('/', requireAuth, requireAdminsManage, async (req, res) => {
    const rows = await db.select().from(admins).where(isNull(admins.deletedAt));
    res.json({
      data: rows.map(toSafeAdmin),
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  router.post('/', requireAuth, requireAdminsManage, async (req, res) => {
    const parsed = parseBody(createAdminSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const passwordHash = await hashPassword(parsed.password);
    const [created] = await db
      .insert(admins)
      .values({ email: parsed.email, name: parsed.name, passwordHash, roleId: parsed.roleId, status: 'active' })
      .returning();

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'admin.create',
      targetType: 'admin',
      targetId: created.id,
      beforeDataSafe: null,
      afterDataSafe: { email: created.email, name: created.name, roleId: created.roleId },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: toSafeAdmin(created), meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.get('/:id', requireAuth, requireAdminsManage, async (req, res) => {
    const [admin] = await db.select().from(admins).where(eq(admins.id, req.params.id));
    if (!admin || admin.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '관리자를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    res.json({ data: toSafeAdmin(admin), meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.patch('/:id', requireAuth, requireAdminsManage, async (req, res) => {
    const parsed = parseBody(updateAdminSchema, req.body, res, req.requestId);
    if (!parsed) return;

    const [before] = await db.select().from(admins).where(eq(admins.id, req.params.id));
    if (!before || before.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '관리자를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }
    if (before.updatedAt.toISOString() !== parsed.expectedUpdatedAt) {
      res.status(409).json({
        error: { code: 'VERSION_CONFLICT', message: '다른 곳에서 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.', requestId: req.requestId },
      });
      return;
    }

    const { expectedUpdatedAt: _expected, ...changes } = parsed;
    const [updated] = await db
      .update(admins)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(admins.id, req.params.id))
      .returning();

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'admin.update',
      targetType: 'admin',
      targetId: updated.id,
      beforeDataSafe: { name: before.name, roleId: before.roleId, status: before.status },
      afterDataSafe: { name: updated.name, roleId: updated.roleId, status: updated.status },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: toSafeAdmin(updated), meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/deactivate', requireAuth, requireAdminsManage, async (req, res) => {
    const [admin] = await db.select().from(admins).where(eq(admins.id, req.params.id));
    if (!admin || admin.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '관리자를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    if (await isLastActiveSuperAdmin(admin.id, admin.roleId)) {
      res.status(409).json({
        error: { code: 'LAST_SUPER_ADMIN', message: '마지막 최고관리자는 비활성화할 수 없습니다.', requestId: req.requestId },
      });
      return;
    }

    const [updated] = await db
      .update(admins)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(eq(admins.id, admin.id))
      .returning();
    await revokeAllSessionsForAdmin(admin.id);

    await writeAuditLog({
      adminId: req.admin!.id,
      roleSnapshot: req.admin!.roleName,
      action: 'admin.deactivate',
      targetType: 'admin',
      targetId: admin.id,
      beforeDataSafe: { status: admin.status },
      afterDataSafe: { status: 'inactive' },
      result: 'success',
      requestId: req.requestId,
    });

    res.json({ data: toSafeAdmin(updated), meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() } });
  });

  router.post('/:id/send-reset', requireAuth, requireAdminsManage, async (req, res) => {
    const [admin] = await db.select().from(admins).where(eq(admins.id, req.params.id));
    if (!admin || admin.deletedAt) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '관리자를 찾을 수 없습니다.', requestId: req.requestId } });
      return;
    }

    await requestPasswordReset(admin.email, deps.appUrl, deps.emailAdapter);

    res.json({
      data: { message: '재설정 안내 메일을 보냈습니다.' },
      meta: { requestId: req.requestId, kstTimestamp: getNowKSTISOString() },
    });
  });

  return router;
}
```

- [ ] **Step 14: Mount the admins router in `server/app.ts`**

```ts
import { createAdminsRouter } from './routes/admins';
// ...
app.use(
  '/api/admins',
  createAdminsRouter({
    sessionSecret: env.AUTH_SESSION_SECRET,
    appUrl: env.APP_URL ?? 'http://localhost:5173',
    emailAdapter,
  })
);
```

- [ ] **Step 15: Run to verify the admins tests pass**

Run: `npx vitest run server/routes/admins.test.ts`
Expected: PASS — 4 tests passing.

- [ ] **Step 16: Run check and the full suite**

Run:
```bash
npm run check
npx vitest run
```
Expected: both clean.

- [ ] **Step 17: Commit**

```bash
git add server/services/audit.ts server/services/audit.test.ts server/middleware/permissions.ts server/routes/roles.ts server/routes/roles.test.ts server/routes/admins.ts server/routes/admins.test.ts server/app.ts
git commit -m "feat: add permission middleware, roles/admins CRUD, and audit logging"
```

---

## Task 7: Client login UI, protected routes, profile & admin home pages

**Files:**
- Create: `client/src/hooks/useAuth.ts` + test, `client/src/components/layout/ProtectedRoute.tsx` + test, `client/src/features/auth/LoginPage.tsx` + test, `client/src/features/settings/ProfilePage.tsx` + test, `client/src/features/dashboard/AdminHomePage.tsx` + test
- Modify: `client/src/routes.tsx`

**Interfaces:**
- Consumes: `apiGet`, `apiPost`, `ApiRequestError` from `client/src/lib/apiClient.ts` (Tasks 4/existing).
- Produces: `useAuth(): { admin, loading, error, refetch }` — used by `ProtectedRoute`, `ProfilePage`, `AdminHomePage`. `ProtectedRoute` (props `{ children: ReactNode }`) — used by `routes.tsx` to gate `/admin` and `/admin/profile`.

- [ ] **Step 1: Write the failing test `client/src/hooks/useAuth.test.ts`**

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from './useAuth';

describe('useAuth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the current admin from /api/auth/me', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { id: '1', email: 'a@b.com', name: '관리자', role: { id: 'r1', name: '최고관리자', permissions: ['*'] } },
          meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:30:00+09:00' },
        }),
      })
    );

    const { result } = renderHook(() => useAuth());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.admin?.email).toBe('a@b.com');
    expect(result.current.error).toBeNull();
  });

  it('sets error and null admin when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { code: 'UNAUTHENTICATED', message: '로그인이 필요합니다.', requestId: 'req-2' } }),
      })
    );

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.admin).toBeNull();
    expect(result.current.error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/src/hooks/useAuth.test.ts`
Expected: FAIL — `Cannot find module './useAuth'`.

- [ ] **Step 3: Write `client/src/hooks/useAuth.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, apiGet } from '../lib/apiClient';

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  name: string;
  role: { id: string; name: string; permissions: string[] };
}

export function useAuth() {
  const [admin, setAdmin] = useState<AuthenticatedAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    apiGet<AuthenticatedAdmin>('/api/auth/me')
      .then((result) => setAdmin(result))
      .catch((err: unknown) => {
        setAdmin(null);
        setError(err instanceof ApiRequestError ? err : new ApiRequestError('알 수 없는 오류', 'UNKNOWN', ''));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { admin, loading, error, refetch };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/src/hooks/useAuth.test.ts`
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Write the failing test `client/src/components/layout/ProtectedRoute.test.tsx`**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { ProtectedRoute } from './ProtectedRoute';

function renderAt(path: string) {
  const { hook } = memoryLocation({ path, static: true });
  return render(
    <Router hook={hook}>
      <ProtectedRoute>
        <p>보호된 내용</p>
      </ProtectedRoute>
    </Router>
  );
}

describe('ProtectedRoute', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders children when authenticated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { id: '1', email: 'a@b.com', name: '관리자', role: { id: 'r1', name: '최고관리자', permissions: ['*'] } },
          meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:30:00+09:00' },
        }),
      })
    );

    renderAt('/admin');

    await waitFor(() => expect(screen.getByText('보호된 내용')).toBeInTheDocument());
  });

  it('does not render children when unauthenticated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { code: 'UNAUTHENTICATED', message: '로그인이 필요합니다.', requestId: 'req-2' } }),
      })
    );

    renderAt('/admin');

    await waitFor(() => expect(screen.queryByText('보호된 내용')).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run client/src/components/layout/ProtectedRoute.test.tsx`
Expected: FAIL — `Cannot find module './ProtectedRoute'`.

- [ ] **Step 7: Write `client/src/components/layout/ProtectedRoute.tsx`**

```tsx
import type { ReactNode } from 'react';
import { Redirect } from 'wouter';
import { useAuth } from '../../hooks/useAuth';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { admin, loading } = useAuth();

  if (loading) {
    return <p className="p-4 text-gray-500">확인 중...</p>;
  }

  if (!admin) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run client/src/components/layout/ProtectedRoute.test.tsx`
Expected: PASS — 2 tests passing. (If `wouter/memory-location` isn't available in the installed `wouter` version, check the installed version's docs for the equivalent in-memory router test helper and adjust the test import accordingly — note any such adjustment in your report.)

- [ ] **Step 9: Write the failing test `client/src/features/auth/LoginPage.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { LoginPage } from './LoginPage';

function renderLoginPage() {
  const { hook, navigate } = memoryLocation({ path: '/login', static: true });
  render(
    <Router hook={hook}>
      <LoginPage />
    </Router>
  );
  return { navigate };
}

describe('LoginPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submits email and password and shows an error message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { code: 'UNAUTHENTICATED', message: '이메일 또는 비밀번호가 올바르지 않습니다.', requestId: 'req-1' },
        }),
      })
    );

    renderLoginPage();

    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    await waitFor(() =>
      expect(screen.getByText('이메일 또는 비밀번호가 올바르지 않습니다.')).toBeInTheDocument()
    );
  });
});
```

- [ ] **Step 10: Run to verify it fails**

Run: `npx vitest run client/src/features/auth/LoginPage.test.tsx`
Expected: FAIL — `Cannot find module './LoginPage'`.

- [ ] **Step 11: Write `client/src/features/auth/LoginPage.tsx`**

```tsx
import { type FormEvent, useState } from 'react';
import { useLocation } from 'wouter';
import { ApiRequestError, apiPost } from '../../lib/apiClient';

export function LoginPage() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost('/api/auth/login', { email, password });
      navigate('/admin');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '로그인에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto mt-16 flex max-w-sm flex-col gap-4">
      <h1 className="text-xl font-semibold">관리자 로그인</h1>
      <label className="flex flex-col gap-1">
        <span>이메일</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          className="rounded border border-gray-300 px-3 py-2 text-base"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>비밀번호</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          className="rounded border border-gray-300 px-3 py-2 text-base"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        로그인
      </button>
    </form>
  );
}
```

- [ ] **Step 12: Run to verify it passes**

Run: `npx vitest run client/src/features/auth/LoginPage.test.tsx`
Expected: PASS — 1 test passing.

- [ ] **Step 13: Write `client/src/features/settings/ProfilePage.tsx`** and its test `client/src/features/settings/ProfilePage.test.tsx`

Test:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfilePage } from './ProfilePage';

describe('ProfilePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the logged-in admin name, email, and role', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { id: '1', email: 'admin@example.com', name: '홍길동', role: { id: 'r1', name: '최고관리자', permissions: ['*'] } },
          meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:30:00+09:00' },
        }),
      })
    );

    render(<ProfilePage />);

    await waitFor(() => expect(screen.getByText('홍길동')).toBeInTheDocument());
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    expect(screen.getByText('최고관리자')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument();
  });
});
```

Implementation:
```tsx
import { useLocation } from 'wouter';
import { apiPost } from '../../lib/apiClient';
import { useAuth } from '../../hooks/useAuth';

export function ProfilePage() {
  const { admin, loading } = useAuth();
  const [, navigate] = useLocation();

  async function handleLogout() {
    await apiPost('/api/auth/logout', {});
    navigate('/login');
  }

  if (loading) return <p className="p-4 text-gray-500">불러오는 중...</p>;
  if (!admin) return null;

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">내 계정</h1>
      <dl className="mt-4 space-y-2">
        <div>
          <dt className="text-sm text-gray-500">이름</dt>
          <dd>{admin.name}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">이메일</dt>
          <dd>{admin.email}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">역할</dt>
          <dd>{admin.role.name}</dd>
        </div>
      </dl>
      <button onClick={handleLogout} className="mt-6 rounded bg-gray-200 px-4 py-2">
        로그아웃
      </button>
    </section>
  );
}
```

- [ ] **Step 14: Run to verify it passes**

Run: `npx vitest run client/src/features/settings/ProfilePage.test.tsx`
Expected: PASS — 1 test passing.

- [ ] **Step 15: Write `client/src/features/dashboard/AdminHomePage.tsx`** and its test `client/src/features/dashboard/AdminHomePage.test.tsx`

Test:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminHomePage } from './AdminHomePage';

describe('AdminHomePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('greets the logged-in admin by name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { id: '1', email: 'a@b.com', name: '홍길동', role: { id: 'r1', name: '최고관리자', permissions: ['*'] } },
          meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:30:00+09:00' },
        }),
      })
    );

    render(<AdminHomePage />);

    await waitFor(() => expect(screen.getByText(/홍길동/)).toBeInTheDocument());
  });
});
```

Implementation:
```tsx
import { useAuth } from '../../hooks/useAuth';

export function AdminHomePage() {
  const { admin, loading } = useAuth();

  if (loading) return <p className="p-4 text-gray-500">불러오는 중...</p>;
  if (!admin) return null;

  return (
    <section className="p-4">
      <h1 className="text-xl font-semibold">{admin.name}님, 안녕하세요</h1>
      <p className="mt-2 text-gray-600">학원 업무자동화 관리자 화면입니다.</p>
    </section>
  );
}
```

- [ ] **Step 16: Run to verify it passes**

Run: `npx vitest run client/src/features/dashboard/AdminHomePage.test.tsx`
Expected: PASS — 1 test passing.

- [ ] **Step 17: Update `client/src/routes.tsx`**

```tsx
import { Route, Switch } from 'wouter';
import { DevHomePage } from './features/dashboard/DevHomePage';
import { AdminHomePage } from './features/dashboard/AdminHomePage';
import { LoginPage } from './features/auth/LoginPage';
import { ProfilePage } from './features/settings/ProfilePage';
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
    </Switch>
  );
}
```

- [ ] **Step 18: Run the full client test suite and check**

Run:
```bash
npm run check
npx vitest run
```
Expected: both clean.

- [ ] **Step 19: Commit**

```bash
git add client/src/hooks client/src/components/layout/ProtectedRoute.tsx client/src/components/layout/ProtectedRoute.test.tsx client/src/features/auth client/src/features/settings client/src/features/dashboard/AdminHomePage.tsx client/src/features/dashboard/AdminHomePage.test.tsx client/src/routes.tsx
git commit -m "feat: add login page, protected routes, profile and admin home pages"
```

---

## Task 8: End-to-end verification and full check

**Files:**
- Create: `tests/e2e/login.spec.ts`

**Interfaces:**
- Consumes: the running app from `npm run dev`, and `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD` from `.env` (now loaded into the Playwright process via the `test:e2e` script's `dotenv -e .env --` prefix, changed in Task 1).

- [ ] **Step 1: Write `tests/e2e/login.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('an unauthenticated visitor to /admin is redirected to /login', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login$/);
});

test('logging in with the bootstrapped admin reaches /admin and logging out returns to /login', async ({ page }) => {
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
  await expect(page.getByText(/님, 안녕하세요/)).toBeVisible();

  await page.goto('/admin/profile');
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole('button', { name: '로그아웃' }).click();

  await expect(page).toHaveURL(/\/login$/);
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `npm run test:e2e`
Expected: PASS — 3 tests passing (the existing `dev-home.spec.ts` plus these 2 new ones), against the real dev DB via the real dev server that `npm run dev` starts (which bootstraps the initial admin on boot if not already present).

- [ ] **Step 3: Run the full unit/integration suite, check, and build**

Run:
```bash
npx vitest run
npm run check
npm run build
```
Expected: all clean.

- [ ] **Step 4: Manual verification and cleanup**

Run `npm run dev`, open `http://localhost:5173/admin` in a browser, confirm redirect to `/login`, log in with the values from `.env`, confirm you land on `/admin` and see your name, visit `/admin/profile`, click 로그아웃, confirm you're back on `/login`. Stop the dev server afterward and verify via `netstat -ano | grep -E ":5173|:8787"` and a process listing that nothing is left running — show the actual re-check output in your report, not just a claim (a prior task in the previous plan falsely reported cleanup once; don't repeat that).

- [ ] **Step 5: Commit and push**

```bash
git add tests/e2e/login.spec.ts
git commit -m "test: add end-to-end login/logout coverage"
git push
git status
```
Expected: `git status` reports a clean working tree, up to date with `origin/main`.
