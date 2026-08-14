# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

This repository currently contains **no source code** — only the master specification document
[`academy_automation_final_development_prompt.md`](academy_automation_final_development_prompt.md).
That file is the single source of truth for product scope, architecture, folder layout, DB schema,
API contract, and rollout plan. Read the relevant section of it before implementing anything; do not
guess at structure that isn't built yet.

The spec was originally written for a ChatGPT-in-Replit workflow where the assistant has no direct
shell/DB/deploy access and must hand the user copy-pasteable Replit Shell commands (see its §1–§2,
§22). **That part is now overridden: development happens on the user's local Windows machine, not
Replit.** Claude Code runs directly on this computer with real filesystem/shell/git access, so the
copy-paste/`.cjs`-patch mechanics in §2.4 and §22, and every "Replit Shell" instruction in §2.1–§2.2,
§4.1, §18, §19.6, no longer apply — Claude Code edits files and runs commands directly instead of
handing the user commands to paste into a Replit Shell.

Everything else in the spec — DB choice, deployment target, file storage, tech stack, schema, API
contract, feature scope — still applies exactly as written. See "Local environment" below for what
replaces Replit. The underlying safety intent of §2 still holds regardless of tooling: never touch the
Production DB or secrets without explicit user approval, never assume a command "worked" without seeing
its actual result, preserve existing data/functionality, and confirm before destructive or
externally-visible actions (this mirrors the harness's own action-category rules).

## Local environment (replaces Replit)

- **Where code is written and run**: this local computer (`C:\Homepage\academy`), directly through
  Claude Code — not a Replit workspace. Node.js, npm, and git are already installed here.
- **Where code is stored long-term**: still GitHub, exactly as the spec says (§1, §4.1). GitHub repo:
  https://github.com/sohocenterkr/academy_gangnam — a local `git` repo here pushes to that remote; there
  is no separate Replit copy to keep in sync. This folder is not yet a git repo (no `.git` here yet).
- **Dev database**: the spec assumed Replit auto-provisions a free dev Postgres. Since we're not using
  Replit, the dev DB is instead **a second, separate Neon project** used only for local development —
  same Postgres engine and schema as Production, just a different `DATABASE_URL`, so nothing else in
  the spec's DB guidance (§4.1, §9) changes. It still must never share data or connection string with
  the Production Neon project.
- **Production DB, deploy target, file storage**: unchanged from the spec — Neon PostgreSQL (separate
  Production project), Vercel Production (Singapore region), Cloudinary (Singapore region).
- **Running the app locally**: `server/index.ts` (the local dev entry point described in §5) is started
  directly from a terminal on this machine (e.g. `npm run dev`) instead of via Replit's Run button, once
  that script exists.
- **Secrets locally**: kept in a local `.env` file (git-ignored), not Replit Secrets. Any place the spec
  says "change the Replit Secret then Stop/Run," the local equivalent is: update `.env`, then restart the
  local dev server.

## What this project is

A mobile-first business-automation website for a single Korean private academy (학원). Core workflow:

`학생·보호자 → 강좌 → 기간별 수강등록 → 등원 기록 → 문자 안내 → 카드뉴스 홍보`
(students/guardians → courses → period-based enrollment → check-in → SMS/MMS outreach → AI card-news promo)

Roles: 최고관리자 (super admin), 일반 관리자 (admin), 강사 (instructor), 문자 담당자 (messaging
operator), 콘텐츠 담당자 (content operator), and 학생 (student — no login, checks in via last 4
digits of phone on a public kiosk screen). Students/guardians never get their own login accounts.

**Explicitly out of scope — do not build these even if they seem natural:** 하원 기록 (check-out),
per-course attendance/lateness/absence grading, student/guardian login pages, online enrollment or
self-signup, online payment/tuition tracking, grades/exams/homework/live class, instructor payroll,
Kakao 알림톡, direct SNS posting, multi-branch/multi-academy support, auto real-time UI polling (refresh
is user-triggered only), and any path where file bytes are proxied through Vercel. Full list: spec §3.4.

## Confirmed infrastructure & stack

- Local machine = dev/maintenance environment; GitHub = source of truth; **Vercel Production**
  (Singapore region) = deployment target, entry point `api/index.ts`.
- **Two separate Neon PostgreSQL projects**: one for local dev, one for Production. Different
  `DATABASE_URL` per environment; never point the dev environment at the Production connection string.
- **Cloudinary** (Singapore region) holds every file (image/audio/video/PDF/doc). Files are uploaded
  **directly from the browser to Cloudinary** using short-lived signed uploads — never through
  `multer`/`formidable`/`busboy` or any server-side file relay. Vercel body size (~4.5MB, verify current
  limit at implementation time) is one reason, but the direct-upload rule applies regardless of size.
- Recommended stack (confirm against actual `package.json` before installing anything, don't
  swap out an existing working choice): React + TypeScript + Vite, Wouter routing, Node.js + TypeScript
  + Express, Drizzle ORM, Zod validation, TanStack Query, Tailwind, Vitest + Testing Library +
  Supertest + Playwright for E2E.
- Env vars (exact names to confirm against the project once one exists): `DATABASE_URL`,
  `AUTH_SESSION_SECRET`, `INITIAL_ADMIN_EMAIL/PASSWORD/NAME`, `APP_URL`, `RESEND_API_KEY`,
  `RESEND_FROM_EMAIL`, `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET/UPLOAD_ROOT`,
  `PUSHBULLET_TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`, `OPENAI_API_KEY` (or chosen AI provider key).

## Target folder layout

Do not wrap the project in an extra subfolder — `client/`, `server/`, `shared/` etc. live directly
under the workspace root. Full tree with per-feature subfolders is in spec §5; skeleton:

```
api/index.ts            # Vercel serverless entry
client/src/{components,features,hooks,lib,types}
server/{app.ts,index.ts,db.ts,middleware,routes,services,repositories,jobs,utils}
shared/{schema.ts,validators,constants,permissions.ts,types.ts}
migrations/  tests/{unit,integration,e2e}  scripts/
```

`server/app.ts` builds the Express app shared by both the local dev server (`server/index.ts`) and the
Vercel entry (`api/index.ts`).

## Non-negotiable technical constraints

- **Time**: business dates/timestamps are always KST (`Asia/Seoul`). Store `timestamp with time zone`;
  never derive a business date via UTC truncation (`toISOString().slice(0,10)` is banned) — use the
  shared KST helpers (`getNowKST`, `getTodayKST`, etc., spec §8.8).
- **Soft delete / history preservation**: records with enrollment/check-in/messaging history are never
  hard-deleted — use `status` + `deleted_at`. Only genuinely mistaken entries with zero history may be
  physically deleted. Course/enrollment changes create new history rows rather than overwriting old ones.
- **Idempotency & concurrency**: check-in creation, message-campaign approval, queue processing, retry,
  file finalize, and cleanup jobs must all be safe to re-invoke (idempotency keys, DB lease, optimistic
  locking on `updated_at`/version). See spec §14.3.
- **PII masking**: list/summary endpoints return masked names/phones (rules in spec §10.5); the public
  check-in search endpoint never returns full name/phone or guardian info, and is rate-limited.
- **No client-side-only validation**: every Zod rule enforced client-side must be re-enforced server-side.
- **Messaging**: N attached photos → N separate MMS send-items per recipient, each with the same
  personalized text; estimated volume = unique recipient phones × attachment bundles. Campaign/send-item
  status names in spec §13.5 — Pushbullet request success ≠ carrier delivery success, keep them distinct.
- **AI card-news**: provider access goes through a common adapter interface (server-side only, keys
  never reach the client); sending photos to AI requires explicit per-project consent captured in
  `card_news_projects`; generated content is a draft the admin edits before render; assets expire 7 days
  after creation with a visible expiry notice and an audit-logged cleanup job.
- **Secrets**: never logged, never in error responses, never sent to the client. After editing the local
  `.env` file, the local dev server must be restarted before the new value takes effect.

## Database & API

Full schema is spec §9 (tables: `roles`, `admins`, `auth_sessions`, `password_reset_tokens`,
`academy_settings`, `schools`, `grade_levels`, `students`, `guardians`, `student_guardians`,
`student_checkin_phones`, `consent_history`, `opt_outs`, `instructors`, `courses`, `course_schedules`,
`course_exceptions`, `enrollments`, `check_ins`, `check_in_change_logs`, `integration_settings`,
`messaging_devices`, `upload_sessions`, `media_assets`, `message_templates`, `message_campaigns`,
`message_campaign_media`, `message_recipients`, `message_send_items`, `message_attempts`,
`platform_presets`, `card_news_projects`, `card_news_cards`, `card_news_media`, `ai_generation_logs`,
`audit_logs`, `job_locks`). Common columns: `created_at`/`updated_at`/`created_by`/`updated_by` on
important tables, UUID PKs preferred, normalized-digits-only phone storage separate from display value.

Full REST surface is spec §12, grouped by domain (auth/admins, academy/reference data, students/
guardians/consent, instructors/courses/enrollments, check-in, Pushbullet/devices/templates, message
send/campaigns, Cloudinary media, platform presets/card-news, dashboard/reports/audit, cron jobs).
Response envelope and error-code conventions (`VALIDATION_ERROR`, `DUPLICATE_CHECKIN`,
`CAMPAIGN_CHANGED`, `OPT_OUT_RECIPIENTS`, etc.) are in spec §11 and §14.2 — reuse them rather than
inventing new shapes.

## Testing (once the project is scaffolded)

Confirm actual `package.json` scripts first; if none exist yet, spec §19.1 recommends:

```bash
npm run check      # lint + TypeScript
npm run test        # unit + integration
npm run build
npm run test:e2e
```

External services (Pushbullet, AI provider, Resend, Cloudinary) default to mock/sandbox adapters in
tests and in local dev; real sends/calls require explicit user-approved test accounts/numbers. Never
point automated tests at Production DB or send real SMS/MMS to real students. Key scenarios to cover are
listed in spec §19.2–§19.5 (KST boundaries, phone normalization/masking, `{{이름}}` templating,
duplicate/opt-out exclusion, MMS-per-photo counting, concurrent check-in race, idempotent
campaign/retry, forged Cloudinary finalize rejection, 7-day cleanup not touching active/recent files).

## Before implementing: unresolved policy decisions

Spec §21 lists ~23 product/policy questions (exact repo name, permission matrix, retention periods,
duplicate-guardian messaging rules, SMS/LMS/MMS length rules, AI provider/cost limits, etc.) that must
not be decided unilaterally. Ask the user only the ones relevant to the step at hand rather than all at
once, per spec §22.
