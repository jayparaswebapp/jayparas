-- Fix: the generic audit trigger crashes on tables without a deleted_at column
-- (e.g. invoice_lines) because PL/pgSQL column access on OLD/NEW raises
-- "record has no field" when the column doesn't exist.
--
-- Switch to jsonb extraction so missing columns silently degrade to NULL.

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
  v_old_deleted text;
  v_new_deleted text;
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
    v_old_deleted := to_jsonb(OLD)->>'deleted_at';
    v_new_deleted := to_jsonb(NEW)->>'deleted_at';
    IF v_old_deleted IS NULL AND v_new_deleted IS NOT NULL THEN
      v_op := 'soft_delete';
    ELSIF v_old_deleted IS NOT NULL AND v_new_deleted IS NULL THEN
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
