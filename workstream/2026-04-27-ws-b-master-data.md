# Session: master-data-and-user-management

**Date:** 2026-04-27 (IST)
**Workstream:** WS-B — Master data, user management, settings, audit log
**Estimated duration:** 4–6 hours

---

## Read this first (mandatory)

Before doing anything in this session:

1. **Credential hygiene check.** Run these commands and verify all are clean. **DO NOT proceed if any fail.**

   ```bash
   echo "=== No tokens in remote URL ==="
   cd ~/Desktop/jay-paras
   git remote -v
   # Expected: clean https://github.com/jayparaswebapp/jayparas.git, NO ghp_ or pat_ in URL.

   echo "=== No GITHUB_TOKEN in env ==="
   env | grep -c GITHUB_TOKEN
   # Expected: 0

   echo "=== No tokens in .git/config ==="
   grep -E "ghp_|github_pat_" ~/Desktop/jay-paras/.git/config 2>/dev/null && echo "FAIL" || echo "OK"
   # Expected: OK
   ```

   If any check fails, **STOP** and tell Jay before doing anything else. Last session leaked two GitHub tokens — we will not repeat that. Use `gh` CLI for all GitHub auth; it's already set up via Jay's keychain. Never embed tokens in URLs, never `export GITHUB_TOKEN=...`, never write tokens to any file.

2. **Read `/sessions/` directory in chronological order.** The previous session note (`2026-04-26-foundation-setup.md`) explains where we are. Read it fully.

3. **Read `/docs/business-context.md` and `/docs/data-model.md` fully.** The data model has been updated with the entity definitions for this workstream — follow it.

4. **Verify the foundation is healthy:**

   ```bash
   cd ~/Desktop/jay-paras
   git status                        # should be clean
   git log --oneline -5              # latest commit should be the WS-A foundation
   npm run build                     # should pass
   ```

   If `git status` shows an untracked `OS` file, delete it: `rm OS`. It's the leftover empty file from the GitHub web UI — never committed locally, can go.

5. **At the end of this session:**
   - Create `/sessions/2026-04-27-master-data-and-user-management.md` summarising what was done.
   - If you can't finish in one session, create the wrap-up note at a clean stopping point and explicitly mark which acceptance criteria are unmet for the next session.

---

## What this workstream delivers

A working master-data layer and user-management UI on top of the foundation. After this session:

- Super-admin can create/edit lead ladies, designs, internal users (other roles), and edit settings.
- Supervisor can also create lead ladies and designs.
- Centre managers are assigned to locations via super-admin.
- Every business-table mutation is captured in `audit_log` with a reason (when super-admin) or a system attribution (when by trigger).
- PINs can be reset by super-admin via the UI (Edge Function does the work).
- Design reference images upload to Supabase Storage with proper RLS.

**What this workstream does NOT deliver:**

- Jobs, receipts, payments — that's WS-C.
- Audit log viewer UI — deferred.
- Dashboards or reports — that's WS-D.

---

## Decisions made before this session (do not re-litigate)

These are settled. Build accordingly.

| #   | Decision                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A   | Lead lady location reassignment: open jobs keep their snapshotted `location_id`; new jobs use the new assignment. Schema-wise, this just means `jobs.location_id` is locked at issue (handled in WS-C — but the principle is established). |
| B   | Design reference images stored in Supabase Storage, not external URLs.                                                                                                                                                                     |
| C   | Design image is **optional**.                                                                                                                                                                                                              |
| D   | Locations: super-admin can edit existing names (English + Gujarati) but **cannot add new locations** in v1.                                                                                                                                |
| E   | Settings: single page, all editable values together, save-all with required audit reason.                                                                                                                                                  |
| F   | `season_start_month` setting: editable only via direct SQL, **not** via UI. UI shows it read-only with a tooltip explaining why.                                                                                                           |
| G   | Centre manager → location assignment lives on the user-management screen (not the locations screen).                                                                                                                                       |
| H   | PIN reset is in scope for this workstream.                                                                                                                                                                                                 |
| —   | Lead lady mobile is **uniquely constrained** at the DB level.                                                                                                                                                                              |
| —   | Soft delete: deleted rows hidden by default; super-admin has a "Show deleted" toggle to view + restore.                                                                                                                                    |
| —   | Audit data captured for every mutation from day one. UI deferred.                                                                                                                                                                          |
| —   | Bulk operations (CSV import, batch deactivate): out of scope.                                                                                                                                                                              |
| —   | Search/filter on list screens: out of scope (plain lists for v1).                                                                                                                                                                          |

---

## Database scope

### New enums

```sql
CREATE TYPE audit_operation AS ENUM (
  'insert',
  'update',
  'soft_delete',
  'restore',
  'hard_delete'
);
```

(Note: `update` covers both regular updates and `delete_at` toggles. `soft_delete` and `restore` are separate signals for clarity in the log.)

### Tables to create

In this exact migration order:

#### `20260427000001_master_data_locations.sql`

```sql
CREATE TABLE public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en text NOT NULL,
  name_gu text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT locations_name_en_unique UNIQUE (name_en),
  CONSTRAINT locations_name_gu_unique UNIQUE (name_gu)
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed
INSERT INTO public.locations (name_en, name_gu) VALUES
  ('Atgam',      'આટગામ'),
  ('Khergam',    'ખેરગામ'),
  ('Arnala',     'અરનાળા'),
  ('Ambheti',    'આંબેટી'),
  ('Jashoda',    'જશોદા'),
  ('Vaghchhipa', 'વાઘછીપા');

-- RLS
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read; only super_admin can update.
-- (No INSERT or DELETE policies — locations are seeded only.)
CREATE POLICY "authenticated read locations" ON public.locations
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "super_admin update locations" ON public.locations
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.app_users a
            WHERE a.auth_user_id = auth.uid() AND a.role = 'super_admin' AND a.deleted_at IS NULL)
  );
```

#### `20260427000002_master_data_lead_ladies.sql`

```sql
CREATE TABLE public.lead_ladies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  mobile text NOT NULL,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES public.app_users(id)
);

-- Mobile is unique among non-deleted rows. Deleted rows can keep their mobile
-- so we can audit historical assignments; new rows can't reuse a live mobile.
CREATE UNIQUE INDEX idx_lead_ladies_mobile_active
  ON public.lead_ladies(mobile)
  WHERE deleted_at IS NULL;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.lead_ladies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.lead_lady_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_lady_id uuid NOT NULL REFERENCES public.lead_ladies(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_lady_location_unique UNIQUE (lead_lady_id, location_id)
);

ALTER TABLE public.lead_ladies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_lady_locations ENABLE ROW LEVEL SECURITY;

-- Read: authenticated.
-- Write: super_admin OR supervisor.
CREATE POLICY "authenticated read lead_ladies" ON public.lead_ladies
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "super_admin or supervisor write lead_ladies" ON public.lead_ladies
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.app_users a
            WHERE a.auth_user_id = auth.uid() AND a.role IN ('super_admin','supervisor') AND a.deleted_at IS NULL)
  );

CREATE POLICY "authenticated read lead_lady_locations" ON public.lead_lady_locations
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "super_admin or supervisor write lead_lady_locations" ON public.lead_lady_locations
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.app_users a
            WHERE a.auth_user_id = auth.uid() AND a.role IN ('super_admin','supervisor') AND a.deleted_at IS NULL)
  );
```

#### `20260427000003_master_data_centre_manager_locations.sql`

```sql
CREATE TABLE public.centre_manager_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT centre_manager_location_unique UNIQUE (app_user_id, location_id)
);

-- Constraint: app_user_id must belong to a centre_manager.
-- Enforced via a trigger because CHECK can't reference other tables.
CREATE OR REPLACE FUNCTION public.enforce_centre_manager_role()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE id = NEW.app_user_id AND role = 'centre_manager' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'app_user_id must reference an active centre_manager';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_centre_manager_role_trg
  BEFORE INSERT OR UPDATE ON public.centre_manager_locations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_centre_manager_role();

ALTER TABLE public.centre_manager_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read centre_manager_locations" ON public.centre_manager_locations
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "super_admin write centre_manager_locations" ON public.centre_manager_locations
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.app_users a
            WHERE a.auth_user_id = auth.uid() AND a.role = 'super_admin' AND a.deleted_at IS NULL)
  );
```

#### `20260427000004_master_data_designs.sql`

```sql
CREATE TABLE public.designs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_number text NOT NULL,
  name_en text,
  name_gu text,
  current_rate_per_guss numeric(10,2) NOT NULL CHECK (current_rate_per_guss > 0),
  image_path text,                            -- relative path in 'design-images' storage bucket; nullable
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES public.app_users(id)
);

CREATE UNIQUE INDEX idx_designs_design_number_active
  ON public.designs(design_number)
  WHERE deleted_at IS NULL;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.designs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.designs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read designs" ON public.designs
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "super_admin or supervisor write designs" ON public.designs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.app_users a
            WHERE a.auth_user_id = auth.uid() AND a.role IN ('super_admin','supervisor') AND a.deleted_at IS NULL)
  );
```

#### `20260427000005_settings.sql`

```sql
CREATE TABLE public.settings (
  key text PRIMARY KEY,
  value_numeric numeric NOT NULL,
  description text NOT NULL,
  is_locked boolean NOT NULL DEFAULT false,    -- if true, UI must not allow edits
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.app_users(id)
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.settings (key, value_numeric, description, is_locked) VALUES
  ('weight_loss_tolerance_pct', 5.0,  'Soft-flag jobs whose weight loss exceeds this percentage', false),
  ('dozen_multiplier',          1.5,  'Multiplier for dozen quantity in labour calculation',     false),
  ('sla_days',                  20,   'Job-work deadline in days from issue',                    false),
  ('incentive_pct',             15.0, 'Lead lady annual incentive as % of total labour',         false),
  ('season_start_month',        8,    'Calendar month the rakhi season starts (1-12)',           true);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read settings" ON public.settings
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "super_admin update unlocked settings" ON public.settings
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.app_users a
            WHERE a.auth_user_id = auth.uid() AND a.role = 'super_admin' AND a.deleted_at IS NULL)
    AND is_locked = false
  );
```

#### `20260427000006_audit_log.sql`

```sql
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  operation public.audit_operation NOT NULL,
  changed_by uuid REFERENCES public.app_users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text,                          -- required for super_admin edits via UI; null for system/trigger entries
  old_values jsonb,
  new_values jsonb
);

CREATE INDEX idx_audit_log_table_record ON public.audit_log(table_name, record_id);
CREATE INDEX idx_audit_log_changed_at   ON public.audit_log(changed_at DESC);
CREATE INDEX idx_audit_log_changed_by   ON public.audit_log(changed_by);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Super-admin reads all; others read only their own changes.
CREATE POLICY "super_admin reads all audit" ON public.audit_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.app_users a
            WHERE a.auth_user_id = auth.uid() AND a.role = 'super_admin' AND a.deleted_at IS NULL)
  );
CREATE POLICY "user reads own audit" ON public.audit_log
  FOR SELECT USING (
    changed_by IN (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
  );

-- INSERTs only via triggers / SECURITY DEFINER functions; no direct insert policy.

-- Generic audit trigger function. Reads `app.changed_by` and `app.audit_reason`
-- from session-local config (set by the application before each mutation).
CREATE OR REPLACE FUNCTION public.write_audit_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_changed_by uuid;
  v_reason     text;
  v_op         public.audit_operation;
  v_record_id  uuid;
BEGIN
  -- Try to read app.changed_by; null if not set (e.g. seed migration).
  BEGIN
    v_changed_by := nullif(current_setting('app.changed_by', true), '')::uuid;
  EXCEPTION WHEN others THEN v_changed_by := NULL;
  END;

  BEGIN
    v_reason := nullif(current_setting('app.audit_reason', true), '');
  EXCEPTION WHEN others THEN v_reason := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    v_op := 'insert';
    v_record_id := NEW.id;
    INSERT INTO public.audit_log(table_name, record_id, operation, changed_by, reason, new_values)
    VALUES (TG_TABLE_NAME, v_record_id, v_op, v_changed_by, v_reason, to_jsonb(NEW));
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Detect soft-delete and restore as separate operations.
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_op := 'soft_delete';
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      v_op := 'restore';
    ELSE
      v_op := 'update';
    END IF;
    v_record_id := NEW.id;
    INSERT INTO public.audit_log(table_name, record_id, operation, changed_by, reason, old_values, new_values)
    VALUES (TG_TABLE_NAME, v_record_id, v_op, v_changed_by, v_reason, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    v_op := 'hard_delete';
    v_record_id := OLD.id;
    INSERT INTO public.audit_log(table_name, record_id, operation, changed_by, reason, old_values)
    VALUES (TG_TABLE_NAME, v_record_id, v_op, v_changed_by, v_reason, to_jsonb(OLD));
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

-- Attach the trigger to every business table that has an `id` column.
-- For `settings`, the PK is `key`, not `id`, so we handle it with a tweaked trigger
-- (or just attach this same trigger and accept that record_id stays null for settings —
-- check the implementation note at end of file). Decide and document.

CREATE TRIGGER audit_locations              AFTER INSERT OR UPDATE OR DELETE ON public.locations              FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
CREATE TRIGGER audit_lead_ladies            AFTER INSERT OR UPDATE OR DELETE ON public.lead_ladies            FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
CREATE TRIGGER audit_lead_lady_locations    AFTER INSERT OR UPDATE OR DELETE ON public.lead_lady_locations   FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
CREATE TRIGGER audit_centre_manager_locations AFTER INSERT OR UPDATE OR DELETE ON public.centre_manager_locations FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
CREATE TRIGGER audit_designs                AFTER INSERT OR UPDATE OR DELETE ON public.designs                FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
CREATE TRIGGER audit_app_users              AFTER INSERT OR UPDATE OR DELETE ON public.app_users              FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

-- For `settings` (PK = key, not id), use a separate version of the trigger function
-- or rewrite the generic one to accept TG_ARGV with the PK column name. Document the choice.
```

**Implementation note for `settings` audit:** Easiest path is a dedicated trigger function that uses `key` instead of `id`, writes to a synthetic record_id (e.g., `gen_random_uuid()` per row, or hash of key), and stores the key in `old_values`/`new_values`. Decide and document in `/docs/decisions.md`.

**Application convention:** Before every mutation, the server code must call `SELECT set_config('app.changed_by', '<app_user_id>', true)` and, for super-admin edits, `SELECT set_config('app.audit_reason', '<reason>', true)`. The `true` flag scopes the setting to the current transaction. Wrap this in a Supabase server helper.

#### `20260427000007_design_images_storage.sql`

```sql
-- Storage bucket created via Supabase MCP, not migration.
-- This file documents the bucket and adds RLS for it.

-- Bucket: 'design-images', private (not publicly readable).
-- Path convention: '<design_id>/<random>.<ext>'. Image served via signed URLs.

-- After bucket creation:
INSERT INTO storage.buckets (id, name, public)
VALUES ('design-images', 'design-images', false)
ON CONFLICT (id) DO NOTHING;

-- Read: any authenticated user.
CREATE POLICY "authenticated read design-images" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'design-images' AND auth.uid() IS NOT NULL
  );

-- Write: super_admin or supervisor.
CREATE POLICY "super_admin or supervisor write design-images" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'design-images'
    AND EXISTS (SELECT 1 FROM public.app_users a
                WHERE a.auth_user_id = auth.uid() AND a.role IN ('super_admin','supervisor') AND a.deleted_at IS NULL)
  );

CREATE POLICY "super_admin or supervisor update design-images" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'design-images'
    AND EXISTS (SELECT 1 FROM public.app_users a
                WHERE a.auth_user_id = auth.uid() AND a.role IN ('super_admin','supervisor') AND a.deleted_at IS NULL)
  );

CREATE POLICY "super_admin or supervisor delete design-images" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'design-images'
    AND EXISTS (SELECT 1 FROM public.app_users a
                WHERE a.auth_user_id = auth.uid() AND a.role IN ('super_admin','supervisor') AND a.deleted_at IS NULL)
  );
```

---

## Application scope

Build CRUD UIs in this order. Each is a working slice; ship one before starting the next.

### 1. Locations (read + edit)

- Route: `/master-data/locations`
- Access: any authenticated user can view; super-admin sees an "Edit" button per row.
- Edit modal: `name_en`, `name_gu`, `is_active`. Audit reason field required.
- No "Add" button. No "Delete" button.

### 2. Designs (full CRUD with image upload)

- Route: `/master-data/designs`
- Access: read = any authenticated; write = super-admin or supervisor.
- List shows: design number, name (in active locale), rate per guss (₹), thumbnail, active badge.
- Create form: design number (required, unique), name_en, name_gu, rate per guss, image upload (optional). All bilingual labels.
- Edit form: same fields. Audit reason required for any edit (super-admin must enter; supervisor's edits are auto-attributed without reason).
- Soft-delete via "Delete" button → confirmation modal → set `deleted_at`. Audit reason required.
- "Show deleted" toggle (super-admin only) — shows deleted rows with a "Restore" button.

### 3. Lead ladies (full CRUD + location assignment)

- Route: `/master-data/lead-ladies`
- Access: read = any authenticated; write = super-admin or supervisor.
- List shows: name, mobile, locations (comma-separated), active badge.
- Create form: full name, mobile (required, unique among active rows; bilingual error if duplicate), notes, multi-select locations.
- Edit form: same. Audit reason required for super-admin edits.
- Soft-delete + restore as above.

### 4. Internal users (super-admin only)

- Route: `/admin/users`
- Access: super-admin only.
- List shows: name, mobile, role, active badge.
- Create form: full name, mobile (unique), role (dropdown), 6-digit PIN, multi-select locations (only shown when role = `centre_manager`).
- Backend: creates auth user (synthetic email + PIN), `app_users` row, optionally `centre_manager_locations` rows. Wrapped in transaction-like flow with rollback on failure (you wrote the pattern in `seed-super-admin.ts` — reuse).
- Edit form: name, role, active, locations. **No PIN field on edit screen.** Separate "Reset PIN" button → opens modal.
- "Reset PIN" modal: prompts for new 6-digit PIN twice. Calls Edge Function `reset-user-pin`. Audit reason required.
- Soft-delete via "Deactivate" button — sets `is_active = false` AND `deleted_at`. Cannot self-deactivate (UI hides the button on own row; backend double-checks).

#### Edge Function `reset-user-pin`

- Lives in `supabase/functions/reset-user-pin/`.
- Auth: Supabase Auth JWT in header; reject if caller is not super-admin.
- Input: `{ target_app_user_id: uuid, new_pin: string, reason: string }`.
- Validates: PIN is exactly 6 digits, reason is non-empty, target user exists.
- Action: calls `supabase.auth.admin.updateUserById(target.auth_user_id, { password: new_pin })`.
- Logs to audit_log with `table_name = 'app_users'`, `operation = 'update'`, `reason = <provided>`, `new_values = { password_reset: true }` (do NOT log the new PIN value).
- Returns `{ ok: true }` on success.

### 5. Settings page

- Route: `/admin/settings`
- Access: super-admin only.
- Single form with five fields:
  - Weight loss tolerance % (numeric, 0–100)
  - Dozen multiplier (numeric, > 0)
  - SLA days (integer, > 0)
  - Incentive % (numeric, 0–100)
  - Season start month (read-only display showing "August (locked)" — tooltip explains: "This setting is locked because changing it would invalidate historical incentive calculations. Edit via SQL only if absolutely necessary.")
- One "Save" button. Single audit reason field at bottom (required, applies to all changes in the save).
- Backend: in a single transaction, set `app.changed_by` and `app.audit_reason`, update each changed setting, commit. The audit trigger writes one entry per changed setting.

---

## Server-side helpers to build

### `src/lib/audit/with-audit-context.ts`

A wrapper that, for any DB mutation, sets the audit context first.

```typescript
// Pseudocode signature
export async function withAuditContext<T>(
  supabase: SupabaseClient,
  appUserId: string,
  reason: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  // Set transaction-local config:
  //   SELECT set_config('app.changed_by', appUserId, true);
  //   SELECT set_config('app.audit_reason', reason ?? '', true);
  // Then run fn().
  // Note: 'true' makes it transaction-local; we MUST be inside a tx for this to work safely.
  // Use an RPC function that sets both and runs the mutation, OR wrap via a Postgres function.
}
```

Implementation tip: Supabase JS doesn't expose explicit transactions cleanly. Easiest pattern: write a Postgres function `app_set_audit_context(uuid, text)` callable via RPC, then run the mutation in the same statement. Or — cleaner — write Postgres functions for each mutation that take audit context as parameters, and call those via `.rpc()`. **Pick one approach and document it as ADR-005.**

### `src/lib/storage/design-images.ts`

- `uploadDesignImage(supabase, designId, file)` → returns `image_path`.
- `getSignedUrl(supabase, path, ttlSeconds = 3600)` → for rendering.
- Validation: max 2 MB, JPEG/PNG/WebP only. Reject others with bilingual error.

### `src/lib/i18n/messages.ts`

Add full message keys for: master-data tabs, designs, lead ladies, users, settings, audit reason prompts, validation errors, confirmation modals, success/failure toasts. Both `gu` and `en`. Run `next-intl` typecheck to ensure parity.

---

## UI / UX rules to maintain

- **Mobile-first.** Every screen designed at 360px first.
- **Bilingual everywhere.** No hard-coded strings in JSX. Test each screen with `Cookie: jp_locale=en` and `gu`.
- **Tap targets ≥ 44×44 px.**
- **Forms:** label above input, one field per row on mobile.
- **Confirmations:** any destructive action (soft-delete, deactivate user, reset PIN) needs a modal confirmation with the action highlighted.
- **Audit reason field:** when a super-admin edits, the audit-reason field must be in the form (not a separate modal). Single concept, single form.
- **Toasts:** success and error toasts for every mutation. Bilingual.
- **Currency:** ₹ prefix, two decimals, Indian numbering.

---

## Acceptance criteria

Tick each. **If something can't be ticked, document why in the wrap-up note.**

- [ ] Credential hygiene checks at session start all pass.
- [ ] All seven migrations applied to Supabase (verify via `mcp__supabase__list_migrations`).
- [ ] Six locations seeded and visible.
- [ ] `design-images` Supabase Storage bucket exists and has the four RLS policies.
- [ ] Audit triggers attached to all six business tables.
- [ ] `settings` audit handled (whichever pattern chosen, documented in ADR).
- [ ] `withAuditContext` (or chosen equivalent) implemented and used by every mutation.
- [ ] `/master-data/locations` reads + edit work in both locales.
- [ ] `/master-data/designs` full CRUD works; image upload works; image displays via signed URL.
- [ ] `/master-data/lead-ladies` full CRUD works; multi-location assignment works; mobile uniqueness enforced with bilingual error.
- [ ] `/admin/users` super-admin can create new users of all roles; centre_manager creation requires location selection.
- [ ] PIN reset Edge Function deployed and callable from UI; reason logged to audit; new PIN value never logged.
- [ ] `/admin/settings` shows all five settings; four editable, season_start_month read-only with tooltip.
- [ ] Soft-delete + restore works on lead_ladies, designs, app_users.
- [ ] "Show deleted" toggle works on the three soft-deletable resources for super-admin.
- [ ] Self-deactivation of super-admin is blocked at backend (try via direct API call to verify).
- [ ] `npm run typecheck` and `npm run build` are clean.
- [ ] All changes committed; pushed to GitHub via `gh` (no token tricks).
- [ ] Vercel auto-deploys; production smoke-tested: log in, navigate every new screen, perform one create/edit/delete on each entity, confirm audit_log rows.
- [ ] `/sessions/2026-04-27-master-data-and-user-management.md` written.

---

## ADRs to record

In `/docs/decisions.md`, append:

- **ADR-005:** Audit context propagation strategy (RPC function vs. Postgres-function-per-mutation vs. set_config approach). Document chosen pattern and why.
- **ADR-006:** Settings audit log handling (since `settings` PK is `key`, not `id`).
- **ADR-007:** Storage path convention for design images.

---

## What to defer (explicitly out of scope)

- Audit log viewer UI.
- Search, filter, sort on list screens.
- Bulk import/export.
- Add-new-location capability.
- Editing `season_start_month` from UI.
- Lead lady self-login.

---

## Notes for next session (WS-C kickoff — jobs)

After this session, the next workstream will:

- Build `jobs` table + status enum + auto-generated `job_code`.
- Build `job_receipts` (with multiple-receipts-per-job for partial-redo).
- Build `cancellations`.
- Build `payments`.
- Implement the issue and receive flows in the UI.
- Implement the SLA badges and weight-loss flag.
- Implement quantity comparison (target vs guss×144 + dozen×12 + nang).
- Implement the four receive outcomes (accepted_full, partial_redo, partial_reduced_rate, partial_discarded).

WS-C will lean heavily on master data from this session — so aim for a polished WS-B foundation rather than rushing to WS-C with rough edges.

### Prep Jay should do before WS-C

- Provide a starter list of designs (design number + name + rate-per-guss + optional image) so Claude Code can seed them via the new UI.
- Provide a starter list of lead ladies (name + mobile + locations).
- Confirm initial supervisor and centre-manager users to create (names + mobiles + locations for centre managers).

---

## Final reminders to Claude Code

1. **No tokens in URLs, env vars, or files. Ever.** Use `gh` CLI for GitHub. Use Supabase MCP for Supabase ops.
2. **Don't commit `.env*.local` files.** Verify `.gitignore` before every push.
3. **One workstream per session.** Don't start WS-C in this session, even if WS-B finishes early.
4. **Wrap-up note is mandatory.** Even if the session ends early or hits a blocker, write a partial wrap-up explaining where things stand.
5. **If something feels structurally wrong** (a decision in this brief contradicts the data model, an RLS policy creates a chicken-and-egg, a migration won't apply), **stop and ask Jay**. Don't paper over it.
