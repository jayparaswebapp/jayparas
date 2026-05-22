# Session: master-data-and-user-management

**Date:** 2026-04-27 (IST)
**Workstream:** WS-B — Master data, user management, settings, audit log
**Duration (rough):** unknown (wrap-up reconstructed retroactively at start of 2026-04-28 session — see "Reconstruction note" below).

## Reconstruction note

This wrap-up was written at the start of the 2026-04-28 brand-correction session by inspecting the uncommitted working tree. The WS-B session itself ended without writing a wrap-up note and without committing. Everything below is derived from reading the actual files and the WS-B brief — not from real-time observation. Manual/browser smoke testing and Supabase production verification are **unverified** and listed under "Unmet acceptance criteria" rather than under "Tested & verified".

## Goals (from `/workstream/2026-04-27-ws-b-master-data.md`)

- Master-data tables: `locations`, `lead_ladies`, `lead_lady_locations`, `centre_manager_locations`, `designs`, plus `settings` and `audit_log`.
- Seed six locations.
- Bilingual master-data CRUD UI (mobile-first) for locations (edit-only), designs (full), lead ladies (full + multi-location).
- User-management UI (`/admin/users`) with role-aware create/edit, centre-manager location assignment, soft-delete, PIN reset.
- Settings page (`/admin/settings`) — single-form, all-five settings, save-all with required audit reason.
- Audit log + triggers on every business mutation; audit context propagated through a single, race-free path.
- ADR-005/006/007.

## What was built

### Migrations (`supabase/migrations/20260427000001…000008`)

1. `20260427000001_master_data_locations.sql` — `locations` table, six seed rows, RLS (authenticated read; super_admin update; no insert/delete policies).
2. `20260427000002_master_data_lead_ladies.sql` — `lead_ladies` + `lead_lady_locations`, partial unique index on mobile WHERE `deleted_at IS NULL`, RLS (read = authenticated; write = super_admin or supervisor).
3. `20260427000003_master_data_centre_manager_locations.sql` — assignment table with trigger `enforce_centre_manager_role` (CHECK can't reference other tables).
4. `20260427000004_master_data_designs.sql` — `designs` table, partial unique on `design_number` WHERE `deleted_at IS NULL`, nullable `image_path`, RLS.
5. `20260427000005_settings.sql` — `settings` table keyed by `text`, five seed rows; `season_start_month` has `is_locked = true`. RLS update policy gated on `is_locked = false`.
6. `20260427000006_audit_log.sql` — `audit_operation` enum (`insert | update | soft_delete | restore | hard_delete`); `audit_log` table with three indexes; generic `write_audit_log()` trigger function reading `app.changed_by` / `app.audit_reason` from `current_setting(..., true)`; dedicated `write_audit_log_settings()` trigger for the text-keyed `settings` table (uses `md5(key)::uuid` for `record_id` — see ADR-006); triggers attached to all six business tables.
7. `20260427000007_design_images_storage.sql` — `design-images` storage bucket (private), four RLS policies (read by authenticated; insert/update/delete by super_admin or supervisor). Bucket row created with `ON CONFLICT DO NOTHING`.
8. `20260427000008_rpc_mutations.sql` — the entire SECURITY DEFINER RPC layer (ADR-005). Helpers: `_current_app_user`, `_validate_reason`, `_bind_audit_context`, `_set_lead_lady_locations`, `_set_centre_manager_locations`. Per-entity RPCs: `update_location`; `create_design / update_design / soft_delete_design / restore_design`; `create_lead_lady / update_lead_lady / soft_delete_lead_lady / restore_lead_lady`; `create_app_user / update_app_user / soft_delete_app_user / restore_app_user`; `update_settings_batch` (rejects locked keys up front, no partial save); `log_pin_reset` (service-role only, for the Edge Function path — see "Unmet"). Grants are explicit per-function; `log_pin_reset` deliberately not granted to `authenticated`.

### Server-side libraries

- `src/lib/rpc/errors.ts` — `RPC_ERROR_KEYS` (10 keys); `RPC_TO_I18N` map → `common.errors.*`; `rpcErrorKey()` / `rpcErrorMessageKey()` (the latter logs unmapped errors to console in the browser without leaking Postgres text into the UI).
- `src/lib/rpc/client.ts` — `callRpc<T>()` wrapper returning a discriminated `RpcResult<T>` union.
- `src/lib/rpc/action-result.ts` — shared `ActionResult` type for server actions.
- `src/lib/users/current.ts` — `requireAppUser()` and `requireRole()`; redirects to `/login` on missing session, signs out and redirects if `app_users` row is missing/inactive/deleted (mirrors the dashboard self-heal).
- `src/lib/storage/design-images.ts` — bucket constant, MAX 2 MB, allowed types JPEG/PNG/WebP; `buildDesignImagePath()` uses a 2-byte / 12-byte hex pair (decoupled from `design_id` to allow client-side upload before the design row exists, sidestepping the 1 MB server-action body limit — see ADR-007 note); `uploadDesignImage()`, `getDesignImageSignedUrl()`.
- `src/lib/format/locale.ts` — `getServerLocale()`, `pickLocalised()`, `formatRupees()` (Indian numbering via `Intl.NumberFormat`, locale-aware).

### Server actions (route-colocated)

- `src/app/(app)/master-data/locations/[id]/actions.ts` — `update_location` RPC.
- `src/app/(app)/master-data/designs/actions.ts` — save (create/update via discriminator on `id`), soft-delete, restore, `getDesignThumbnailUrl()` signing helper.
- `src/app/(app)/master-data/lead-ladies/actions.ts` — full CRUD + soft-delete/restore.
- `src/app/(app)/admin/users/actions.ts` — full CRUD: creates auth user via admin client first, calls `create_app_user` RPC second, rolls back the auth user if the RPC fails (mirrors `seed-super-admin.ts`). Soft-delete/restore. **`resetUserPinAction` exists but is currently disconnected — see Unmet.**

All server actions follow the pattern: `requireRole(...)` → Zod validate → `supabase.rpc(...)` → on `error`, return `{ ok: false, messageKey: rpcErrorMessageKey(error) }` → on success, `revalidatePath()` + `redirect()`.

### UI

- `src/app/(app)/master-data/{page,layout}.tsx` — landing + sub-nav layout.
- `/master-data/locations` — list + per-row edit (`[id]/edit-form.tsx`, `[id]/page.tsx`).
- `/master-data/designs` — list + new + edit (with `design-form.tsx`) + `[id]/destructive-actions.tsx`.
- `/master-data/lead-ladies` — list + new + edit + destructive actions.
- `/admin/{page,layout}.tsx` — admin landing + layout.
- `/admin/users` — list + new + edit (with `user-form.tsx`, role-conditional location multi-select) + destructive actions.
- Shared components: `audit-reason-field`, `badges`, `form-status`, `page-header`, `sub-nav`.
- All forms use `useFormState` + `useFormStatus`. All strings via `next-intl`. No hard-coded English in JSX (i18n catalogs grew from ~41 lines to 267 lines on both `en.json` and `gu.json`).

### Docs

- `docs/decisions.md` — ADR-005, ADR-006, ADR-007 appended (see "Decisions made" below).

## Decisions made

- **ADR-005 — Audit context propagation via SECURITY DEFINER RPCs.** Single path: every mutation is an RPC. The planned `src/lib/audit/with-audit-context.ts` JS helper was **intentionally not built**; the RPC layer subsumes it. Race-free, transaction-local `set_config(..., true)` for both `app.changed_by` and `app.audit_reason`. Error contract is a fixed set of English keys mapped to `common.errors.*` via `next-intl`.
- **ADR-006 — Settings audit `record_id = md5(key)::uuid`.** Stable per key, fits the `uuid NOT NULL` column without weakening the contract for id-keyed tables, lets us query a single setting's full history with `WHERE table_name='settings' AND record_id = md5('sla_days')::uuid`. The key text is also embedded in `old_values`/`new_values` jsonb for human readability.
- **ADR-007 — Storage path convention for design images.** `<random_hex_4>/<random_hex_12>.<ext>` (note: divergent from the brief which specified `<design_id>/<random>.<ext>` — the implementation decoupled path from `design_id` so a new image can be uploaded client-side before the design row exists, avoiding the 1 MB server-action body limit). Private bucket; rendered via short-lived signed URLs (default TTL 3600s).

## Tested & verified

- `npm run typecheck` — **clean after a one-line fix during the 2026-04-28 reconstruction** (see "Notes on minor fix during commit" below).
- `npm run build` — clean: 15 dynamic routes compile, middleware 79.4 kB.

## Unmet acceptance criteria

The WS-B brief had a long checklist; the following items are **unmet** and need explicit follow-up:

- **PIN reset is partially built:**
  - The `resetUserPinAction` server action exists in `src/app/(app)/admin/users/actions.ts` and invokes `supabase.functions.invoke('reset-user-pin', ...)`.
  - The `log_pin_reset` RPC exists in migration 8 and is correctly granted to service-role only.
  - **Missing:** the Edge Function itself — there is no `supabase/functions/reset-user-pin/` directory on disk. The server action would fail in production.
  - **Missing:** the UI panel — `src/app/(app)/admin/users/[id]/page.tsx` originally imported `./reset-pin-panel`, which was never created. The import was removed during the 2026-04-28 commit so the build is green; the PIN-reset section no longer renders on the edit page.
  - **To close:** write `supabase/functions/reset-user-pin/index.ts` (Deno, service-role client, validates caller is super_admin, calls `auth.admin.updateUserById`, then `rpc('log_pin_reset', ...)`); deploy via `supabase functions deploy`; build `reset-pin-panel.tsx` (`useFormState` over `resetUserPinAction`, two PIN inputs + reason field, confirmation modal); re-wire into `[id]/page.tsx`.
- **Manual browser smoke is unverified.** No record exists of clicking through any of the new screens in the dev server, in either locale. The build passes but nothing in this session confirms `/master-data/locations` edit actually works, that designs image upload + signed-URL render works end-to-end, that lead-lady multi-select submits correctly, or that settings save-all writes audit rows. Future session must do this.
- **Supabase production state is unverified.** Migrations 1–8 exist as files but no record exists of `supabase db push` or equivalent applying them to the production project. `mcp__supabase__list_migrations` was not run. Until verified, the production DB may still be at the WS-A state (only migrations `20260426000001` and `20260426000002` applied).
- **`design-images` bucket existence on production is unverified.** The migration uses `INSERT INTO storage.buckets ... ON CONFLICT DO NOTHING`, but bucket creation via SQL requires service-role; verify the bucket actually exists in the dashboard.
- **Vercel auto-deploy is unverified.** This work has not been pushed yet (the commit is being created now as part of the 2026-04-28 session prep).
- **Self-deactivation block (`self_modification_forbidden`)** is implemented at the RPC layer (`update_app_user`, `soft_delete_app_user`); the UI also passes `isSelf` to `UserForm` and `DestructiveActions`. Defence-in-depth is correct, but no test verifies the backend path via direct API call.

## Notes on minor fix during commit

During the 2026-04-28 reconstruction, `npm run typecheck` failed with `Cannot find module './reset-pin-panel'` from `src/app/(app)/admin/users/[id]/page.tsx`. Two lines were removed from that file to get the build green:

1. The `import { ResetPinPanel } from './reset-pin-panel';` line.
2. The `<ResetPinPanel userId={initial.id!} />` JSX block and its wrapper `<div>` inside the `!isSelf` branch.

The `resetUserPinAction` server action was left in place so the work isn't lost. The PIN-reset feature is now formally tracked as an Unmet criterion above.

## Open questions / blockers

- None blocking the next session, but the PIN-reset gap and the unverified production migration apply state are both real and must be addressed before WS-C builds anything on top of master data.
- `supabase/.temp/` was found untracked. Added to `.gitignore` during commit.
- `package-lock.json` had transitive bumps (`baseline-browser-mapping`, `postcss`) from `npm install` runs; no direct dependency changes in `package.json`. Included in the commit.

## Next session

- **2026-04-28 brand-correction session is immediately next.** It corrects "Jay Paras" → "Jai Paras" across user-visible strings only. Scope is intentionally narrow. See `/workstream/2026-04-28-brand-correction.md` and its forthcoming wrap-up.
- After brand correction, the **gaps from this WS-B session must be closed before WS-C starts**:
  1. Verify migrations 1–8 are applied to production Supabase (`mcp__supabase__list_migrations`); if not, push them.
  2. Verify `design-images` bucket exists on production.
  3. Build and deploy the `reset-user-pin` Edge Function.
  4. Build `reset-pin-panel.tsx` and re-wire it into `[id]/page.tsx`.
  5. Run a manual browser smoke covering every new screen in both locales, exercising one create / edit / soft-delete / restore per entity, and confirming `audit_log` rows for each.
- Only after those are green should WS-C (jobs/receipts/payments) start.

### Prep Jay should do before WS-C

- (Unchanged from the WS-B brief) Provide starter lists: designs (number + name + rate-per-guss + optional image), lead ladies (name + mobile + locations), supervisor/centre-manager users to create.
