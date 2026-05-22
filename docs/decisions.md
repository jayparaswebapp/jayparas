# Architectural Decision Records

Lightweight ADRs. One entry per decision. Newest at top.

---

## ADR-007 — Storage path convention for design images

**Date:** 2026-04-27
**Status:** Accepted

**Decision.** Design reference images in the `design-images` Supabase Storage bucket follow the path convention `<design_id>/<random>.<ext>`, where `<random>` is a 16-byte hex string and `<ext>` ∈ {`jpg`, `jpeg`, `png`, `webp`}. The bucket is private; clients render images via short-lived signed URLs (default TTL 3600s).

**Why.** Prefixing the object key with the design's UUID gives us a natural per-design folder for future bulk operations (e.g. cascade-delete on hard delete) and makes it obvious in the dashboard which images belong to which design. Random suffix avoids collisions and lets us replace an image without overwriting the prior one (we can keep the prior path in audit history if needed).

**Trade-off.** Path is not human-readable; we accept that because users never see paths — only signed URLs render images.

---

## ADR-006 — Settings audit log uses `md5(key)::uuid` as record_id

**Date:** 2026-04-27
**Status:** Accepted

**Decision.** The `audit_log.record_id` column is `uuid NOT NULL`, but the `settings` table's primary key is `key text`, not a uuid. The settings audit trigger derives `record_id` deterministically as `md5(key)::uuid`. The original `key` text is also embedded in `old_values` / `new_values` jsonb so it's human-readable in the log.

**Why.** Two alternatives were rejected:

1. Generate a fresh uuid per audit row — breaks "all audit rows for one setting share a record_id", which is the basis of the `idx_audit_log_table_record` index and any future per-setting history queries.
2. Make `audit_log.record_id` nullable — weakens the contract for every other (id-keyed) table and forces every consumer to handle a null case.

`md5(key)::uuid` is stable per key, fits the uuid type without changing the schema, and lets `WHERE table_name='settings' AND record_id=md5('sla_days')::uuid` retrieve a single setting's full history.

**Trade-off.** A consumer cannot recover the key from the record_id without the original key string; that's why `old_values`/`new_values` always carry the key text. md5 collision risk is irrelevant at five settings.

**Implementation.** `public.write_audit_log_settings()` (migration 6) is the dedicated trigger function; the generic `public.write_audit_log()` is used for all id-keyed tables.

---

## ADR-005 — Audit context propagation via SECURITY DEFINER RPCs

**Date:** 2026-04-27
**Status:** Accepted

**Decision.** Every mutation on a business table is performed via a `SECURITY DEFINER` Postgres function (the WS-B "RPC layer" in migration 8). Each function:

1. Resolves the caller's `app_users` row from `auth.uid()` via `public._current_app_user()` — never trusts a client-supplied caller id.
2. Validates the role/reason rules via `public._validate_reason()` (super_admin: reason always required; supervisor: required only for destructive ops).
3. Sets the audit context within the same transaction via `public._bind_audit_context(app_user_id, reason)`, which calls `set_config('app.changed_by', ..., true)` and `set_config('app.audit_reason', ..., true)`.
4. Performs the mutation. The audit trigger reads the two config values and writes the audit row in the same transaction.

The previously planned `src/lib/audit/with-audit-context.ts` JS helper is **intentionally not implemented**. The RPC layer subsumes it: clients call `supabase.rpc('create_design', {...})` and never set audit context from JS. Having two paths to set context (one in JS, one in SQL) was the kind of duplication that drifts into bugs — single-source-of-truth wins.

**Why this over alternatives.**

- _RPC-per-mutation_ (chosen): atomic, race-free, server-controls who gets to set what, errors map cleanly to a typed contract that the UI translates via next-intl.
- _Single `app_set_audit_context(uuid, text)` RPC + separate mutation call_: two round-trips, two transactions, leaves a window where context is set but mutation fails. Rejected.
- _Pure JS `withAuditContext`_: requires explicit transactions, which Supabase JS doesn't expose cleanly; race conditions across pooled connections. Rejected.

**RPC error contract.** Functions raise English-keyed exceptions; the client maps to bilingual UI strings via `common.errors.<key>` (see `src/lib/rpc/errors.ts`). Known keys (this is the contract — UI must handle every one):

- `session_invalid` — caller's auth session or `app_users` row is missing/deleted/inactive.
- `permission_denied` — caller's role isn't allowed for this op.
- `reason_required` — super_admin omitted reason, or supervisor omitted on destructive op.
- `mobile_taken` — uniqueness violation on mobile (lead_ladies / app_users).
- `design_number_taken` — uniqueness violation on design_number.
- `not_found` — target row doesn't exist or is in the wrong state for the op.
- `self_modification_forbidden` — caller tried to demote / deactivate / soft-delete / PIN-reset themselves.
- `centre_manager_locations_exist` — tried to change role away from centre_manager while assignments exist.
- `setting_locked` — tried to update a setting whose `is_locked = true`.
- `invalid_input` — generic input-shape failure (e.g. centre_manager with empty location array, unknown settings key).

**Trade-off.** Every new business table will need a small RPC layer. Worth it: the alternative is sprinkling audit-context setup across server actions and trusting future contributors not to forget it.

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
