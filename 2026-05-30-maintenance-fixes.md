# Session: maintenance-fixes

**Date:** 2026-05-30 → 2026-06-02 (IST)
**Workstream:** maintenance
**Duration (rough):** unknown

> **⚠️ Backfilled note.** Reconstructed on 2026-07-19 from migrations and code
> after the original session notes were lost. "What was built" and "Decisions"
> are read directly from the code; rationale beyond migration comments is
> inferred and marked as such.

## What was built

- `supabase/migrations/20260530000001_fix_app_users_rls_recursion.sql`
  Fixed Postgres "infinite recursion detected in policy" on `app_users`. The
  super_admin RLS policy subqueried `app_users` itself; the role lookup now
  lives in a `SECURITY DEFINER` helper `public.is_super_admin()` that bypasses
  RLS, and the policy calls it.
- `supabase/migrations/20260602000001_create_sku_drop_reason_required.sql`
  Removed the reason-required check from `create_sku`. After the audit-reason
  field was dropped from the UI, every super_admin SKU create failed on
  `reason_required`. Creating a fresh row has no prior state to justify, so
  the reason check was misplaced on create. Update/deactivate flows still
  validate reasons at this point. `_bind_audit_context` retained so audit rows
  stay consistent.

## Decisions made

- Role checks that RLS policies need must live in SECURITY DEFINER helpers,
  not inline subqueries against the same table (recursion hazard).
- Audit reasons are for mutations of existing state, not for creates.

## Open questions / gaps in this reconstruction

- Exact session dates/durations unknown; the two fixes may have been separate
  micro-sessions.
