-- WS-B migration 6/8: audit_log + generic & settings-specific trigger functions.
--
-- Convention: every mutating RPC (see migration 8) does
--   PERFORM set_config('app.changed_by',  <app_user_id>::text, true);
--   PERFORM set_config('app.audit_reason', <reason>,           true);
-- before performing the mutation. The 'true' makes the setting transaction-local,
-- so it cannot leak across pooled connections. Functions are SECURITY DEFINER
-- so the audit insert is privileged regardless of the caller's RLS.
--
-- Per ADR-006: settings has key (text) as PK rather than id (uuid). We use a
-- dedicated trigger function that derives record_id deterministically from
-- md5(key)::uuid so audit history per setting key is queryable via record_id.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_operation') THEN
    CREATE TYPE public.audit_operation AS ENUM (
      'insert',
      'update',
      'soft_delete',
      'restore',
      'hard_delete'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  operation public.audit_operation NOT NULL,
  changed_by uuid REFERENCES public.app_users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  old_values jsonb,
  new_values jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON public.audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at   ON public.audit_log(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_by   ON public.audit_log(changed_by);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin reads all audit" ON public.audit_log;
CREATE POLICY "super_admin reads all audit" ON public.audit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role = 'super_admin'
        AND a.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "user reads own audit" ON public.audit_log;
CREATE POLICY "user reads own audit" ON public.audit_log
  FOR SELECT USING (
    changed_by IN (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
  );

REVOKE SELECT ON public.audit_log FROM anon;

-- Generic trigger function for tables whose PK is column "id" (uuid).
CREATE OR REPLACE FUNCTION public.write_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_changed_by uuid;
  v_reason     text;
  v_op         public.audit_operation;
BEGIN
  BEGIN
    v_changed_by := nullif(current_setting('app.changed_by', true), '')::uuid;
  EXCEPTION WHEN others THEN v_changed_by := NULL;
  END;

  BEGIN
    v_reason := nullif(current_setting('app.audit_reason', true), '');
  EXCEPTION WHEN others THEN v_reason := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(table_name, record_id, operation, changed_by, reason, new_values)
    VALUES (TG_TABLE_NAME, NEW.id, 'insert', v_changed_by, v_reason, to_jsonb(NEW));
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_op := 'soft_delete';
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      v_op := 'restore';
    ELSE
      v_op := 'update';
    END IF;
    INSERT INTO public.audit_log(table_name, record_id, operation, changed_by, reason, old_values, new_values)
    VALUES (TG_TABLE_NAME, NEW.id, v_op, v_changed_by, v_reason, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log(table_name, record_id, operation, changed_by, reason, old_values)
    VALUES (TG_TABLE_NAME, OLD.id, 'hard_delete', v_changed_by, v_reason, to_jsonb(OLD));
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

-- Variant for settings: PK is `key` (text). record_id derived as md5(key)::uuid
-- so each key has a stable record_id across audit entries (per ADR-006).
-- We also include the key inside old/new jsonb for human readability.
CREATE OR REPLACE FUNCTION public.write_audit_log_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_changed_by uuid;
  v_reason     text;
  v_record_id  uuid;
BEGIN
  BEGIN
    v_changed_by := nullif(current_setting('app.changed_by', true), '')::uuid;
  EXCEPTION WHEN others THEN v_changed_by := NULL;
  END;

  BEGIN
    v_reason := nullif(current_setting('app.audit_reason', true), '');
  EXCEPTION WHEN others THEN v_reason := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    v_record_id := md5(NEW.key)::uuid;
    INSERT INTO public.audit_log(table_name, record_id, operation, changed_by, reason, new_values)
    VALUES (TG_TABLE_NAME, v_record_id, 'insert', v_changed_by, v_reason, to_jsonb(NEW));
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    v_record_id := md5(NEW.key)::uuid;
    INSERT INTO public.audit_log(table_name, record_id, operation, changed_by, reason, old_values, new_values)
    VALUES (TG_TABLE_NAME, v_record_id, 'update', v_changed_by, v_reason, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    v_record_id := md5(OLD.key)::uuid;
    INSERT INTO public.audit_log(table_name, record_id, operation, changed_by, reason, old_values)
    VALUES (TG_TABLE_NAME, v_record_id, 'hard_delete', v_changed_by, v_reason, to_jsonb(OLD));
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

-- Attach generic trigger to all id-keyed business tables.
DROP TRIGGER IF EXISTS audit_locations               ON public.locations;
CREATE TRIGGER audit_locations               AFTER INSERT OR UPDATE OR DELETE ON public.locations               FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS audit_lead_ladies             ON public.lead_ladies;
CREATE TRIGGER audit_lead_ladies             AFTER INSERT OR UPDATE OR DELETE ON public.lead_ladies             FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS audit_lead_lady_locations     ON public.lead_lady_locations;
CREATE TRIGGER audit_lead_lady_locations     AFTER INSERT OR UPDATE OR DELETE ON public.lead_lady_locations     FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS audit_centre_manager_locations ON public.centre_manager_locations;
CREATE TRIGGER audit_centre_manager_locations AFTER INSERT OR UPDATE OR DELETE ON public.centre_manager_locations FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS audit_designs                 ON public.designs;
CREATE TRIGGER audit_designs                 AFTER INSERT OR UPDATE OR DELETE ON public.designs                 FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS audit_app_users               ON public.app_users;
CREATE TRIGGER audit_app_users               AFTER INSERT OR UPDATE OR DELETE ON public.app_users               FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

-- Settings uses the dedicated function.
DROP TRIGGER IF EXISTS audit_settings                ON public.settings;
CREATE TRIGGER audit_settings                AFTER INSERT OR UPDATE OR DELETE ON public.settings                FOR EACH ROW EXECUTE FUNCTION public.write_audit_log_settings();
