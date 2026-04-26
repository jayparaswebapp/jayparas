# Session: foundation-setup

**Date:** 2026-04-26 (IST)
**Workstream:** WS-A — Foundation
**Duration (rough):** ~2h

## Goals (from /workstream/2026-04-26-foundation-setup.md)
- Bootstrap Next.js 14 App Router + TypeScript strict + Tailwind.
- Wire Supabase project (already linked to GitHub).
- Wire Vercel deploy (account already linked to GitHub).
- Commit `docs/business-context.md` + `docs/data-model.md`.
- Set up `/sessions/` convention.
- Mobile + 6-digit PIN auth scaffolding via Supabase Auth.
- `app_users` table + `user_role` enum (no other business tables).
- Bilingual i18n (Gujarati primary, English secondary).
- Login screen + protected dashboard placeholder.
- Seed super-admin from env.
- Vercel deploy with login working in production.

## What was built

### Project skeleton
- `package.json`, `tsconfig.json` (strict, `noUncheckedIndexedAccess`), `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `.eslintrc.json`, `.prettierrc`, `.prettierignore`, `.gitignore`, `.env.example`, `.husky/pre-commit`, `README.md`.
- `src/app/globals.css` with Tailwind layers + reusable `btn-primary`, `input-base`, `label-base`, `error-text`, all enforcing 44px tap targets.
- `src/app/layout.tsx` mounts `Inter` (`--font-sans`) + `Noto_Sans_Gujarati` (`--font-gujarati`) and wraps children in `NextIntlClientProvider`.

### Supabase
- Migration `supabase/migrations/20260426000001_initial_users.sql` applied (verified via `mcp__supabase__list_tables`):
  - `pgcrypto` extension (already installed, idempotent).
  - `public.set_updated_at()` trigger function.
  - `user_role` enum: `super_admin | supervisor | centre_manager | accountant`.
  - `public.app_users` with FK to `auth.users` (cascade delete), `mobile` unique, soft-delete via `deleted_at`, `updated_at` trigger.
  - Partial unique index `idx_app_users_mobile WHERE deleted_at IS NULL`.
  - RLS policies: `users can read own row`, `super_admin full access`.
  - `public.login_attempts` (rate-limit ledger) — RLS enabled, no policies, service-role only.
- Migration `20260426000002_harden_advisors.sql` applied to address Supabase advisor warnings:
  - Pinned `set_updated_at` `search_path = ''`.
  - Revoked `anon` SELECT on `app_users` and `login_attempts` so they're not visible via the public `/graphql/v1` introspection endpoint.
  - Revoked `authenticated` access on `login_attempts` (only the service role reads/writes it).
- Supabase clients in `src/lib/supabase/`:
  - `client.ts` — browser, publishable key.
  - `server.ts` — `cookies()`-bound SSR client.
  - `admin.ts` — service-role, server-only (`import 'server-only'`), `persistSession: false`.

### Auth
- `src/lib/auth/synthetic-email.ts` — `mobileToSyntheticEmail(mobile)` → `<mobile>@${AUTH_EMAIL_DOMAIN}` (default `jayparas.internal`).
- `src/lib/auth/login.ts` — `loginAction` server action:
  1. Zod-validates mobile + 6-digit PIN.
  2. Counts failed attempts in `login_attempts` over the last 15 min; rejects if ≥ 5.
  3. Looks up `app_users` by mobile (active, non-deleted) — friendlier error than raw auth failure.
  4. Calls `supabase.auth.signInWithPassword({ email: synthetic, password: pin })`.
  5. Records the attempt; redirects to `next` (or `/dashboard`).
  Also exports `signOutAction`.
- `src/middleware.ts` refreshes the SSR session cookie on every request and redirects unauthenticated users to `/login?next=...` (allow-list: `/login`, `/_next`, `/favicon.ico`, `/api/health`). Authenticated users hitting `/login` bounce to `/dashboard`.

### UI
- `src/app/(auth)/login/page.tsx` + `login-form.tsx` — mobile-first form with `inputMode="numeric"`, `autoComplete="tel-national"`/`one-time-code`, RHF + zod client validation, server-action submit, bilingual errors via `next-intl`. Uses `useFormState` + `useFormStatus` for Next 14 server-action UX.
- `src/app/(app)/dashboard/page.tsx` — server component, reads `supabase.auth.getUser()`, joins `app_users` for `full_name + role`, renders `Hello, {name}` + role badge in the active locale, with sign-out button. Self-heals (signs out) if an auth user has no `app_users` row.
- `src/components/header.tsx` + `locale-switcher.tsx` — header with brand + locale toggle. Switcher uses a server action to set the `jp_locale` cookie (1-year, `SameSite=Lax`) and revalidates the layout.

### i18n
- `next-intl` v3 with cookie-based locale (no `/gu/` `/en/` URL prefix — internal staff tool, shorter URLs win).
- `src/lib/i18n/config.ts` — `locales = ['gu', 'en']`, `defaultLocale = 'gu'`, `LOCALE_COOKIE = 'jp_locale'`.
- `src/lib/i18n/request.ts` — server config, reads cookie, falls back to default, sets `timeZone: 'Asia/Kolkata'`.
- `src/messages/{gu,en}.json` — full key coverage for app, login, dashboard, locale, roles.

### Seed
- `scripts/seed-super-admin.ts` — idempotent. Reads `SEED_SUPER_ADMIN_{MOBILE,PIN,NAME}` from `.env.local`. Looks up by mobile; if found, calls `auth.admin.updateUserById` (rotates PIN/email) and patches the `app_users` row; if not, creates the auth user + inserts `app_users`. Rolls back the auth user on `app_users` insert failure.
- Seeded the real super-admin: `Jay Shah / 9429780009 / super_admin / active`. Verified via SQL and end-to-end auth.

### Docs + sessions
- `docs/business-context.md` — committed verbatim from Appendix A of the workstream brief.
- `docs/data-model.md` — already present, untouched.
- `docs/decisions.md` — 4 ADRs (auth synthetic email, next-intl, App Router route groups, UTC storage / IST display).
- `sessions/README.md` — moved/renamed from `sessions-README.md` to match the brief's structure.

## Decisions made
- **ADR-001 — Synthetic email + PIN as password.** Sidesteps Supabase phone OTP, reuses Supabase's hashing/session/JWT plumbing, no third-party SMS dependency. Synthetic domain `.internal` is non-routable.
- **ADR-002 — `next-intl` (not `next-i18next`).** App Router-native, supported, type-safe message keys; `next-i18next` is being deprecated for App Router.
- **ADR-003 — Cookie-based locale (no URL prefix).** Internal tool; URL brevity > shareability across locales.
- **ADR-004 — UTC storage, IST display.** Standard practice; one `formatIST` helper (to be added in WS-B) wraps formatting.
- **Rate limit lives in `login_attempts` table, service-role only.** No anon access; cleanly re-usable when we add the future PIN-reset Edge Function.

## Tested & verified
- `npm run typecheck`: clean.
- `npm run build`: clean — 6 routes compile, middleware 79.4 kB.
- `npm run seed:super-admin`: created the seed user; DB row confirmed.
- HTTP smoke (dev server):
  - `GET /api/health` → `{ok:true}`.
  - `GET /` unauth → 307 → `/login?next=/`.
  - `GET /dashboard` unauth → 307 → `/login?next=/dashboard`.
  - `GET /login` (no cookie, default `gu`) → renders `<h1>લોગિન કરો</h1>`.
  - `GET /login` with `Cookie: jp_locale=en` → renders `<h1>Sign in</h1>`.
- Auth round-trip via `@supabase/supabase-js`:
  - Wrong PIN → `Invalid login credentials`.
  - Right PIN → session issued.
  - Non-existent mobile → caught upstream by `app_users` lookup → bilingual `userNotFound`.
- Vercel: **not deployed yet** — see Open questions.

## Open questions / blockers
- **Vercel project not yet created.** Plan: Jay creates a Vercel project pointed at `github.com/jayparaswebapp/jayparas` from the dashboard, sets these env vars (Production + Preview):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `AUTH_EMAIL_DOMAIN`
  - (`SEED_SUPER_ADMIN_*` are not needed at runtime — only by the local seed script.)
  Acceptance criterion "Vercel deploy is green; same login works in production" stays unchecked until that's done. Easy follow-up: 5 min in the dashboard.
- **Vercel CLI is 50.42.0 → 52.0.0.** Recommend `npm i -g vercel@latest` before next session if Jay plans to use `vercel deploy` from CLI.
- **`prepare` (husky) failed during `npm install`** because `.git` did not exist yet. Now that `git init` has run, `npm run prepare` will install hooks. (No manual action needed; husky auto-installs on next `npm install`.)
- **Common-PIN check skipped** per brief. Future hardening: reject `123456`, `000000`, all-same, sequential.
- **PIN-reset Edge Function** deferred — it's a super-admin-only path, only useful once we have user-management screens in WS-B.

## Next session (WS-B kickoff — master data)
Per the workstream brief's "Notes for next session":
1. Create business master tables: `locations`, `lead_ladies`, `lead_lady_locations`, `centre_manager_locations`, `designs`.
2. Seed the six locations: Atgam, Khergam, Arnala, Ambheti, Jashoda, Vaghchhipa (both `name_en` and `name_gu`).
3. Build super-admin master-data CRUD screens (mobile-first, bilingual).
4. Implement `audit_log` table + triggers on every business table.
5. Implement `settings` table + seed (`weight_loss_tolerance_pct=5`, `dozen_multiplier=1.5`, `sla_days=20`, `incentive_pct=15`, `season_start_month=8`) + edit screen.
6. Do **not** touch jobs/receipts/payments — that's WS-C.

### Prep Jay should do before next session
- Create the Vercel project linked to the GitHub repo and set env vars (per Open questions above).
- Confirm Gujarati names for the six locations (the seed will be checked in alongside the migration).
- Optionally upgrade the Vercel CLI: `npm i -g vercel@latest`.
- Decide: season year = Aug-to-Jul or calendar year? Affects `incentive_accruals` view in WS-B.
