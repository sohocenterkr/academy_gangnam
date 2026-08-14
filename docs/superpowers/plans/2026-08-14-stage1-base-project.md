# Stage 1: Base Project & Common UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a working, testable full-stack TypeScript scaffold (React/Vite client + Express server, shared types, KST time handling) that runs locally with a single command, is connected to GitHub, and proves the whole stack is wired correctly via a `/api/health` endpoint rendered on a dev home page.

**Architecture:** A single npm project at the workspace root with three source trees — `client/` (Vite + React, port 5173), `server/` (Express, port 8787), `shared/` (types + KST helpers used by both). The Vite dev server proxies `/api/*` to the Express server so the browser only ever talks to one origin. Production bundling to Vercel (`api/index.ts`, `vercel.json`) and the database/auth layer are explicitly **out of scope** for this plan — they are separate stages (Stage 2 = DB/auth, Stage 10 = deploy) per the spec's own staging in §18.

**Tech Stack:** TypeScript, React 18, Vite, Tailwind CSS v4, Wouter, Express, Zod, Vitest + Testing Library + Supertest, Playwright.

**Spec:** [`../../../academy_automation_final_development_prompt.md`](../../../academy_automation_final_development_prompt.md) — this plan implements §5 (folder layout) and §18 Stage 1 ("기반 프로젝트와 공통 UI"). Executors should read both this plan and the spec sections referenced in each task.

## Global Constraints

- All business timestamps are KST (`Asia/Seoul`). Never derive a date via `toISOString().slice(0, 10)` or any other UTC truncation — spec §8.8, §9.1.
- API responses use the standard envelope: success = `{ data, meta: { requestId, kstTimestamp } }`, error = `{ error: { code, message, fieldErrors?, requestId } }` — spec §11.1.
- The health endpoint must never expose secrets — only app/DB connection status — spec §17. (DB status is added in Stage 2; this stage's health check covers app status only.)
- No file bytes are ever proxied through the Express/Vercel API layer — Cloudinary direct upload only. Not exercised in this stage, but no code added here may violate it.
- Every request gets a request ID — spec §10.2.
- Local dev, not Replit: code is written and run directly on this machine (see [`../../../CLAUDE.md`](../../../CLAUDE.md) "Local environment" section). GitHub repo: `https://github.com/sohocenterkr/academy_gangnam`.
- Secrets live in a local, git-ignored `.env` file, never committed, never logged.
- This repo does not yet have a `.git` directory — Task 1 creates it.

---

## File Structure

```
.gitignore
.env.example
README.md
package.json
tsconfig.base.json
client/tsconfig.json
server/tsconfig.json
eslint.config.js
vite.config.ts
vitest.config.ts
vitest.setup.ts
playwright.config.ts

shared/
  types.ts
  kst.ts
  kst.test.ts

server/
  env.ts
  env.test.ts
  app.ts
  index.ts
  middleware/
    requestId.ts
    errorHandler.ts
  routes/
    health.ts
    health.test.ts

client/
  index.html
  src/
    main.tsx
    App.tsx
    routes.tsx
    styles/
      globals.css
      mobile.css
    lib/
      apiClient.ts
      apiClient.test.ts
      kst.ts
    components/
      layout/
        AppShell.tsx
        AppShell.test.tsx
      feedback/
        ErrorBoundary.tsx
        ErrorBoundary.test.tsx
    features/
      dashboard/
        DevHomePage.tsx
        DevHomePage.test.tsx

tests/
  e2e/
    dev-home.spec.ts
```

- `shared/` holds anything both client and server need (API envelope types, KST helpers) — reused rather than duplicated, per spec §9.1's "one place" rule for phone/date handling logic.
- `client/src/lib/kst.ts` re-exports `shared/kst.ts` so client code can import from the path the spec's folder layout (§5) lists, without duplicating the implementation.

---

## Task 1: Git repository & GitHub connection

**Files:**
- Create: `.gitignore`
- Create: `README.md`

**Interfaces:**
- Produces: an initialized local git repo on branch `main`, tracking `origin` = `https://github.com/sohocenterkr/academy_gangnam.git`.

- [ ] **Step 1: Create `.gitignore`**

```gitignore
node_modules/
dist/
.env
.env.local
coverage/
playwright-report/
test-results/
*.log
```

- [ ] **Step 2: Create a starter `README.md`**

```markdown
# 학원 업무자동화 (academy_gangnam)

강남 학원 업무자동화 웹사이트. 전체 요구사항은
[`academy_automation_final_development_prompt.md`](./academy_automation_final_development_prompt.md)를 참고하세요.
개발 방식(로컬 환경, DB, 배포)은 [`CLAUDE.md`](./CLAUDE.md)에 정리되어 있습니다.

## 로컬 개발 시작하기

\`\`\`bash
npm install
cp .env.example .env
npm run dev
\`\`\`

`npm run dev`를 실행하면 브라우저 화면(5173번 포트)과 서버(8787번 포트)가 동시에 켜집니다.
브라우저에서 http://localhost:5173 을 열면 서버 연결 상태가 화면에 표시됩니다.

## 자주 쓰는 명령어

| 명령어 | 하는 일 |
|---|---|
| `npm run dev` | 로컬 개발 서버 실행 |
| `npm run check` | 코드 스타일 검사 + 타입 검사 |
| `npm run test` | 단위·통합 테스트 실행 |
| `npm run test:e2e` | 브라우저 자동화 테스트 실행 |
| `npm run build` | 배포용 정적 파일 생성 |

## 환경변수

`.env.example` 파일에 필요한 환경변수 목록이 있습니다. 이 단계(Stage 1)에서는 서버 포트와
접속 주소만 있으면 되고, DB·이메일·파일저장·문자발송·AI 관련 값은 해당 기능을 만드는 단계에서
채웁니다.
```

- [ ] **Step 3: Initialize git and make the first commit**

Run:
```bash
git init -b main
git add .gitignore README.md
git commit -m "chore: initialize repository"
```

- [ ] **Step 4: Verify the commit exists**

Run: `git log --oneline`
Expected: one commit, message `chore: initialize repository`.

- [ ] **Step 5: Connect the GitHub remote and push**

Run:
```bash
git remote add origin https://github.com/sohocenterkr/academy_gangnam.git
git push -u origin main
```

- [ ] **Step 6: Verify the remote is tracked and clean**

Run: `git status` and `git remote -v`
Expected: `git status` shows "nothing to commit, working tree clean" and "Your branch is up to date with 'origin/main'"; `git remote -v` shows `origin` pointing at `https://github.com/sohocenterkr/academy_gangnam.git` for both fetch and push.

---

## Task 2: Project tooling & configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`, `client/tsconfig.json`, `server/tsconfig.json`
- Create: `eslint.config.js`
- Create: `vite.config.ts`, `vitest.config.ts`, `vitest.setup.ts`, `playwright.config.ts`
- Create: `.env.example`

**Interfaces:**
- Consumes: nothing (first code task).
- Produces: `npm run dev|check|lint|typecheck|test|test:e2e|build` scripts that later tasks' verification steps rely on; a `vitest` config with `environmentMatchGlobs` routing `client/**` to `jsdom` and `server/**`/`shared/**` to `node`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "academy-gangnam",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "concurrently -n client,server -c blue,green \"npm:dev:client\" \"npm:dev:server\"",
    "dev:client": "vite",
    "dev:server": "tsx watch server/index.ts",
    "build": "vite build",
    "check": "npm run lint && npm run typecheck",
    "lint": "eslint .",
    "typecheck": "tsc -p client/tsconfig.json --noEmit && tsc -p server/tsconfig.json --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install react react-dom wouter express zod
npm install -D typescript vite @vitejs/plugin-react tailwindcss @tailwindcss/vite tsx concurrently eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh vitest @testing-library/react @testing-library/jest-dom jsdom supertest @playwright/test @types/node @types/express @types/react @types/react-dom @types/supertest
```

- [ ] **Step 3: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true
  }
}
```

- [ ] **Step 4: Write `client/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"]
  },
  "include": ["src", "../shared"]
}
```

- [ ] **Step 5: Write `server/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["**/*.ts", "../shared/**/*.ts"]
}
```

- [ ] **Step 6: Write `eslint.config.js`**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['client/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  }
);
```

- [ ] **Step 7: Write `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
});
```

- [ ] **Step 8: Write `vitest.config.ts` and `vitest.setup.ts`**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environmentMatchGlobs: [
      ['client/**', 'jsdom'],
      ['server/**', 'node'],
      ['shared/**', 'node'],
    ],
    setupFiles: ['./vitest.setup.ts'],
  },
});
```

`vitest.setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 9: Write `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  use: {
    baseURL: 'http://localhost:5173',
  },
});
```

- [ ] **Step 10: Write `.env.example`**

```dotenv
# 서버 (Stage 1부터 사용)
NODE_ENV=development
PORT=8787
APP_URL=http://localhost:5173

# DB (Stage 2부터 사용)
DATABASE_URL=

# 인증 (Stage 2부터 사용)
AUTH_SESSION_SECRET=
INITIAL_ADMIN_EMAIL=
INITIAL_ADMIN_PASSWORD=
INITIAL_ADMIN_NAME=

# 이메일 발송 Resend (비밀번호 재설정 등, 이후 단계부터 사용)
RESEND_API_KEY=
RESEND_FROM_EMAIL=

# 파일 저장 Cloudinary (이후 단계부터 사용)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_UPLOAD_ROOT=

# 문자 발송 Pushbullet (이후 단계부터 사용)
PUSHBULLET_TOKEN_ENCRYPTION_KEY=

# 예약작업 인증 (이후 단계부터 사용)
CRON_SECRET=

# 카드뉴스 AI (이후 단계부터 사용)
OPENAI_API_KEY=
```

- [ ] **Step 11: Verify the toolchain installed correctly**

Run:
```bash
npx tsc --version
npx eslint --version
npx vitest --version
npx playwright --version
```
Expected: all four print a version number with no errors.

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json client/tsconfig.json server/tsconfig.json eslint.config.js vite.config.ts vitest.config.ts vitest.setup.ts playwright.config.ts .env.example
git commit -m "chore: add project tooling and configuration"
```

---

## Task 3: Shared API envelope types & server env validation

**Files:**
- Create: `shared/types.ts`
- Create: `server/env.ts`
- Test: `server/env.test.ts`

**Interfaces:**
- Produces: `ApiSuccess<T>`, `ApiError`, `ApiResponse<T>` types from `shared/types.ts` (used by every later API route and by the client's `apiClient`); `loadEnv(source?: NodeJS.ProcessEnv): Env` and `type Env` from `server/env.ts`, where `Env` has `NODE_ENV: 'development' | 'test' | 'production'`, `PORT: number`, `APP_URL?: string`.

- [ ] **Step 1: Write `shared/types.ts`**

```ts
export interface ApiSuccess<T> {
  data: T;
  meta: {
    requestId: string;
    kstTimestamp: string;
  };
}

export interface ApiErrorBody {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  requestId: string;
}

export interface ApiError {
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
```

- [ ] **Step 2: Write the failing test `server/env.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

describe('loadEnv', () => {
  it('applies defaults when optional values are missing', () => {
    const env = loadEnv({});

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(8787);
  });

  it('coerces PORT from a string to a number', () => {
    const env = loadEnv({ PORT: '3000' });

    expect(env.PORT).toBe(3000);
  });

  it('rejects an invalid APP_URL', () => {
    expect(() => loadEnv({ APP_URL: 'not-a-url' })).toThrow(/APP_URL/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run server/env.test.ts`
Expected: FAIL — `Cannot find module './env'` (the module doesn't exist yet).

- [ ] **Step 4: Write `server/env.ts`**

```ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  APP_URL: z.string().url().optional(),
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

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run server/env.test.ts`
Expected: PASS — 3 tests passing.

- [ ] **Step 6: Commit**

```bash
git add shared/types.ts server/env.ts server/env.test.ts
git commit -m "feat: add shared API envelope types and server env validation"
```

---

## Task 4: KST time helpers

**Files:**
- Create: `shared/kst.ts`
- Create: `client/src/lib/kst.ts`
- Test: `shared/kst.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `getTodayKST(date?: Date): string` (returns `'YYYY-MM-DD'` in KST) and `getNowKSTISOString(date?: Date): string` (returns `'YYYY-MM-DDTHH:mm:ss+09:00'`) from `shared/kst.ts`, re-exported by `client/src/lib/kst.ts`. `server/routes/health.ts` (Task 5) and `shared/kst.test.ts` both depend on these exact names.

- [ ] **Step 1: Write the failing test `shared/kst.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { getNowKSTISOString, getTodayKST } from './kst';

describe('KST time helpers', () => {
  it('returns the KST calendar date even when UTC is still on the previous day', () => {
    // 2026-08-14T15:30:00Z is 2026-08-15T00:30:00+09:00 in KST.
    const utcDate = new Date('2026-08-14T15:30:00.000Z');

    expect(getTodayKST(utcDate)).toBe('2026-08-15');
  });

  it('formats the full KST timestamp with a +09:00 offset', () => {
    const utcDate = new Date('2026-08-14T15:30:00.000Z');

    expect(getNowKSTISOString(utcDate)).toBe('2026-08-15T00:30:00+09:00');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run shared/kst.test.ts`
Expected: FAIL — `Cannot find module './kst'`.

- [ ] **Step 3: Write `shared/kst.ts`**

```ts
const KST_TIME_ZONE = 'Asia/Seoul';

export function getTodayKST(date: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the business-date shape we need.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function getNowKSTISOString(date: Date = new Date()): string {
  const datePart = getTodayKST(date);
  const timePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: KST_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);

  return `${datePart}T${timePart}+09:00`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run shared/kst.test.ts`
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Write the client re-export `client/src/lib/kst.ts`**

```ts
export * from '../../../shared/kst';
```

- [ ] **Step 6: Commit**

```bash
git add shared/kst.ts shared/kst.test.ts client/src/lib/kst.ts
git commit -m "feat: add KST time helpers shared by client and server"
```

---

## Task 5: Express app, middleware, and the health endpoint

**Files:**
- Create: `server/middleware/requestId.ts`
- Create: `server/middleware/errorHandler.ts`
- Create: `server/routes/health.ts`
- Create: `server/app.ts`
- Test: `server/routes/health.test.ts`

**Interfaces:**
- Consumes: `getNowKSTISOString` from `shared/kst.ts` (Task 4).
- Produces: `createApp(): Express` from `server/app.ts` — used by `server/index.ts` (Task 6) and by `server/routes/health.test.ts`. Every request on the returned app has `req.requestId: string` set by the `requestId` middleware.

- [ ] **Step 1: Write `server/middleware/requestId.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
```

- [ ] **Step 2: Write `server/middleware/errorHandler.ts`**

```ts
import type { NextFunction, Request, Response } from 'express';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const message = err instanceof Error ? err.message : 'Unexpected server error';
  console.error(`[${req.requestId}]`, message);

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: '요청을 처리하는 중 오류가 발생했습니다.',
      requestId: req.requestId,
    },
  });
}
```

- [ ] **Step 3: Write `server/routes/health.ts`**

```ts
import { Router } from 'express';
import { getNowKSTISOString } from '../../shared/kst';

export const healthRouter = Router();

healthRouter.get('/health', (req, res) => {
  res.json({
    data: {
      status: 'ok',
    },
    meta: {
      requestId: req.requestId,
      kstTimestamp: getNowKSTISOString(),
    },
  });
});
```

- [ ] **Step 4: Write the failing test `server/routes/health.test.ts`**

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';

describe('GET /api/health', () => {
  it('returns an ok status inside the standard success envelope', async () => {
    const app = createApp();

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
    expect(response.body.meta.requestId).toEqual(expect.any(String));
    expect(response.body.meta.kstTimestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/
    );
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run server/routes/health.test.ts`
Expected: FAIL — `Cannot find module '../app'`.

- [ ] **Step 6: Write `server/app.ts`**

```ts
import express, { type Express } from 'express';
import { requestId } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import { healthRouter } from './routes/health';

export function createApp(): Express {
  const app = express();

  app.use(express.json());
  app.use(requestId);
  app.use('/api', healthRouter);
  app.use(errorHandler);

  return app;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run server/routes/health.test.ts`
Expected: PASS — 1 test passing.

- [ ] **Step 8: Commit**

```bash
git add server/middleware server/routes/health.ts server/routes/health.test.ts server/app.ts
git commit -m "feat: add Express app with request-id, error handler, and health endpoint"
```

---

## Task 6: Local dev server entry point

**Files:**
- Create: `server/index.ts`

**Interfaces:**
- Consumes: `createApp` from `server/app.ts` (Task 5), `loadEnv` from `server/env.ts` (Task 3).
- Produces: a running HTTP server on `env.PORT` when executed — no exported symbols consumed by other tasks.

- [ ] **Step 1: Write `server/index.ts`**

```ts
import { createApp } from './app';
import { loadEnv } from './env';

const env = loadEnv();
const app = createApp();

app.listen(env.PORT, () => {
  console.log(`API server listening on http://localhost:${env.PORT}`);
});
```

- [ ] **Step 2: Create a local `.env` from the example**

Run: `cp .env.example .env`

- [ ] **Step 3: Verify the server boots and answers the health check**

Run (in one terminal):
```bash
npm run dev:server
```
Then, in a second terminal:
```bash
curl http://localhost:8787/api/health
```
Expected: JSON body with `"status":"ok"`, a `requestId`, and a `kstTimestamp` ending in `+09:00`. Stop the `dev:server` process (Ctrl+C) after confirming.

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat: add local dev server entry point"
```

---

## Task 7: Browser API client

**Files:**
- Create: `client/src/lib/apiClient.ts`
- Test: `client/src/lib/apiClient.test.ts`

**Interfaces:**
- Consumes: `ApiResponse<T>` from `shared/types.ts` (Task 3).
- Produces: `apiGet<T>(path: string): Promise<T>` and `class ApiRequestError extends Error` (with `code: string`, `requestId: string` fields) from `client/src/lib/apiClient.ts` — used by `DevHomePage` in Task 9.

- [ ] **Step 1: Write the failing test `client/src/lib/apiClient.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiGet, ApiRequestError } from './apiClient';

describe('apiGet', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the data payload on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { status: 'ok' },
          meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:30:00+09:00' },
        }),
      })
    );

    await expect(apiGet('/api/health')).resolves.toEqual({ status: 'ok' });
  });

  it('throws ApiRequestError with the server-provided code and message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { code: 'NOT_FOUND', message: '찾을 수 없습니다', requestId: 'req-2' },
        }),
      })
    );

    await expect(apiGet('/api/missing')).rejects.toBeInstanceOf(ApiRequestError);
    await expect(apiGet('/api/missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: '찾을 수 없습니다',
      requestId: 'req-2',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run client/src/lib/apiClient.test.ts`
Expected: FAIL — `Cannot find module './apiClient'`.

- [ ] **Step 3: Write `client/src/lib/apiClient.ts`**

```ts
import type { ApiResponse } from '../../../shared/types';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly requestId: string
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
  });
  const body = (await response.json()) as ApiResponse<T>;

  if (!response.ok || 'error' in body) {
    const errorBody = body as Extract<ApiResponse<T>, { error: unknown }>;
    throw new ApiRequestError(
      errorBody.error.message,
      errorBody.error.code,
      errorBody.error.requestId
    );
  }

  return body.data;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run client/src/lib/apiClient.test.ts`
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/apiClient.ts client/src/lib/apiClient.test.ts
git commit -m "feat: add typed browser API client"
```

---

## Task 8: ErrorBoundary and AppShell components

**Files:**
- Create: `client/src/components/feedback/ErrorBoundary.tsx`
- Test: `client/src/components/feedback/ErrorBoundary.test.tsx`
- Create: `client/src/components/layout/AppShell.tsx`
- Test: `client/src/components/layout/AppShell.test.tsx`

**Interfaces:**
- Produces: `ErrorBoundary` (props: `{ children: ReactNode }`) and `AppShell` (props: `{ children: ReactNode }`) — both consumed by `App.tsx` in Task 9.

- [ ] **Step 1: Write the failing test `client/src/components/feedback/ErrorBoundary.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Bomb() {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <p>정상 화면</p>
      </ErrorBoundary>
    );

    expect(screen.getByText('정상 화면')).toBeInTheDocument();
  });

  it('renders a fallback message when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toHaveTextContent('문제가 발생했어요');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run client/src/components/feedback/ErrorBoundary.test.tsx`
Expected: FAIL — `Cannot find module './ErrorBoundary'`.

- [ ] **Step 3: Write `client/src/components/feedback/ErrorBoundary.tsx`**

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div role="alert" style={{ padding: 16 }}>
          <p>문제가 발생했어요. 새로고침해 주세요.</p>
        </div>
      );
    }

    return this.props.children;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run client/src/components/feedback/ErrorBoundary.test.tsx`
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Write the failing test `client/src/components/layout/AppShell.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('renders its children inside the shell', () => {
    render(
      <AppShell>
        <p>내용</p>
      </AppShell>
    );

    expect(screen.getByText('내용')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run client/src/components/layout/AppShell.test.tsx`
Expected: FAIL — `Cannot find module './AppShell'`.

- [ ] **Step 7: Write `client/src/components/layout/AppShell.tsx`**

```tsx
import type { ReactNode } from 'react';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <main
        className="mx-auto max-w-screen-md px-4 py-6"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run client/src/components/layout/AppShell.test.tsx`
Expected: PASS — 1 test passing.

- [ ] **Step 9: Commit**

```bash
git add client/src/components
git commit -m "feat: add ErrorBoundary and AppShell layout components"
```

---

## Task 9: Routing and the dev home page

**Files:**
- Create: `client/src/features/dashboard/DevHomePage.tsx`
- Test: `client/src/features/dashboard/DevHomePage.test.tsx`
- Create: `client/src/routes.tsx`
- Create: `client/src/App.tsx`
- Create: `client/src/main.tsx`
- Create: `client/index.html`
- Create: `client/src/styles/globals.css`, `client/src/styles/mobile.css`

**Interfaces:**
- Consumes: `apiGet` from `client/src/lib/apiClient.ts` (Task 7), `AppShell` and `ErrorBoundary` from Task 8.
- Produces: a rendered app at `/` that calls `GET /api/health` and shows the result — no further tasks in this plan depend on this task's exports.

- [ ] **Step 1: Write the failing test `client/src/features/dashboard/DevHomePage.test.tsx`**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevHomePage } from './DevHomePage';

describe('DevHomePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a healthy status once the health check succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { status: 'ok' },
          meta: { requestId: 'req-1', kstTimestamp: '2026-08-15T00:30:00+09:00' },
        }),
      })
    );

    render(<DevHomePage />);

    await waitFor(() =>
      expect(screen.getByTestId('health-status')).toHaveTextContent('서버 연결 정상')
    );
  });

  it('shows an error status when the health check fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    render(<DevHomePage />);

    await waitFor(() =>
      expect(screen.getByTestId('health-status')).toHaveTextContent('서버 연결 실패')
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run client/src/features/dashboard/DevHomePage.test.tsx`
Expected: FAIL — `Cannot find module './DevHomePage'`.

- [ ] **Step 3: Write `client/src/features/dashboard/DevHomePage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { apiGet } from '../../lib/apiClient';

interface HealthStatus {
  status: string;
}

export function DevHomePage() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    apiGet<HealthStatus>('/api/health')
      .then(() => setStatus('ok'))
      .catch(() => setStatus('error'));
  }, []);

  return (
    <section>
      <h1 className="text-xl font-semibold">학원 업무자동화</h1>
      <p data-testid="health-status" className="mt-2 text-gray-600">
        {status === 'loading' && '서버 상태 확인 중...'}
        {status === 'ok' && '서버 연결 정상'}
        {status === 'error' && '서버 연결 실패'}
      </p>
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run client/src/features/dashboard/DevHomePage.test.tsx`
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Write `client/src/routes.tsx`**

```tsx
import { Route, Switch } from 'wouter';
import { DevHomePage } from './features/dashboard/DevHomePage';

export function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={DevHomePage} />
    </Switch>
  );
}
```

- [ ] **Step 6: Write `client/src/App.tsx`**

```tsx
import { AppShell } from './components/layout/AppShell';
import { ErrorBoundary } from './components/feedback/ErrorBoundary';
import { AppRoutes } from './routes';

export function App() {
  return (
    <ErrorBoundary>
      <AppShell>
        <AppRoutes />
      </AppShell>
    </ErrorBoundary>
  );
}
```

- [ ] **Step 7: Write `client/src/styles/globals.css` and `client/src/styles/mobile.css`**

`client/src/styles/globals.css`:
```css
@import "tailwindcss";
```

`client/src/styles/mobile.css`:
```css
@media (max-width: 768px) {
  body {
    -webkit-tap-highlight-color: transparent;
  }
}
```

- [ ] **Step 8: Write `client/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';
import './styles/mobile.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 9: Write `client/index.html`**

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>학원 업무자동화</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 10: Commit**

```bash
git add client/src/features client/src/routes.tsx client/src/App.tsx client/src/main.tsx client/index.html client/src/styles
git commit -m "feat: add routing, dev home page, and app entry point"
```

---

## Task 10: End-to-end smoke test and full verification

**Files:**
- Create: `tests/e2e/dev-home.spec.ts`

**Interfaces:**
- Consumes: the running app from `npm run dev` (Tasks 6 and 9).
- Produces: nothing consumed elsewhere — this is the final verification task.

- [ ] **Step 1: Write `tests/e2e/dev-home.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('dev home page shows healthy server status', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('health-status')).toHaveText('서버 연결 정상');
});
```

- [ ] **Step 2: Install Playwright's browser binaries**

Run: `npx playwright install chromium`
Expected: downloads complete without error.

- [ ] **Step 3: Run the full test suite**

Run: `npm run test`
Expected: all unit/integration tests from Tasks 3–9 pass (env, KST, health, apiClient, ErrorBoundary, AppShell, DevHomePage).

- [ ] **Step 4: Run the e2e test**

Run: `npm run test:e2e`
Expected: PASS — 1 test passing. Playwright starts `npm run dev` automatically per `playwright.config.ts`'s `webServer` block, so no server needs to be running beforehand.

- [ ] **Step 5: Run lint, typecheck, and build**

Run:
```bash
npm run check
npm run build
```
Expected: `check` (lint + typecheck) passes with no errors; `build` produces `dist/client/` with no errors.

- [ ] **Step 6: Manual local verification**

Run: `npm run dev`, then open `http://localhost:5173` in a browser.
Expected: page shows "학원 업무자동화" and, within a second, "서버 연결 정상". Stop the dev server (Ctrl+C) after confirming.

- [ ] **Step 7: Commit and push everything**

```bash
git add tests/e2e/dev-home.spec.ts
git commit -m "test: add end-to-end smoke test for the dev home page"
git push
git status
```
Expected: `git status` reports a clean working tree, up to date with `origin/main`.
