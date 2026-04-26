# Architectural Decision Records

Lightweight ADRs. One entry per decision. Newest at top.

---

## ADR-004 — Storage timezone is UTC; display is IST
**Date:** 2026-04-26
**Status:** Accepted

**Decision.** Every `timestamptz` is stored in UTC. Every UI render uses `Asia/Kolkata` and `dd/MM/yyyy`. Numbers are formatted with `Intl.NumberFormat('en-IN')`.

**Why.** Standard practice; future cloud regions or BI tools shouldn't care about the timezone the rows were written from. Display happens at the edge.

**How.** `date-fns-tz` for conversions; a single `formatIST(date)` helper (added in WS-B) wraps formatting so we never spread `Asia/Kolkata` strings through the codebase.

---

## ADR-003 — Folder structure: App Router with route groups
**Date:** 2026-04-26
**Status:** Accepted

**Decision.** Use Next.js App Router. Two route groups:
- `src/app/(auth)/...` — public, unauthenticated screens (`/login`).
- `src/app/(app)/...` — authenticated screens (`/dashboard`, future `/jobs`, etc.).

`src/middleware.ts` enforces the auth gate based on path (any path outside `/login`, `/_next`, `/api/health` requires a session).

**Why.** Route groups keep the URL flat (no `/auth/login`) while letting layouts diverge. Middleware enforces protection in one place rather than per-route checks.

**Trade-off.** App Router server actions are still maturing; `useFormState` + `useFormStatus` are the supported pattern in Next 14. We accept that and will revisit when we upgrade Next.

---

## ADR-002 — i18n library: next-intl
**Date:** 2026-04-26
**Status:** Accepted

**Decision.** Use `next-intl` v3 for bilingual UI (Gujarati default, English secondary). Locale is stored in a cookie (`jp_locale`); URL paths stay locale-free (`/login`, not `/gu/login`).

**Why.**
- App Router-native (server components + client components both supported).
- Type-safe message keys with TS plugins.
- Cookie-based locale matches the brief's "Locale switcher persists across reloads" without inflating URL length on mobile.
- `next-i18next` is now deprecated in favour of `next-intl` for App Router.

**Trade-off.** Cookie-based routing means URLs aren't shareable across locales. Acceptable: this is an internal staff tool, not public content.

---

## ADR-001 — Auth: Supabase email/password with synthetic email
**Date:** 2026-04-26
**Status:** Accepted

**Decision.** Authentication uses Supabase Auth's email/password flow. The user-facing identifier is the 10-digit Indian mobile number; the user-facing secret is a 6-digit PIN. Internally, we store the mobile in `app_users.mobile` and synthesise the auth email as `<mobile>@jayparas.internal` (configurable via `AUTH_EMAIL_DOMAIN`). The PIN is sent to Supabase as the password and is hashed by Supabase.

**Why.**
- Supabase Auth's phone provider sends OTPs by default; we don't want OTPs.
- Email/password is battle-tested and supports the SSR cookie session model out of the box via `@supabase/ssr`.
- Synthetic email lets us re-use Supabase's password hashing, session refresh, and JWT issuance without rolling our own.

**Trade-off.** Users could in theory log in via the synthetic email if they ever discovered it — mitigated by:
1. The synthetic domain is non-routable (`.internal`).
2. The login UI never exposes the email — it accepts mobile + PIN only.
3. A future hardening pass can move to a custom auth flow (Option B in the brief) without changing the user-facing UX.

**Rate limit.** 5 failed attempts per 15 minutes per mobile, hard-coded for v1. Tracked in `public.login_attempts` (service-role only, no anon RLS access).

---
