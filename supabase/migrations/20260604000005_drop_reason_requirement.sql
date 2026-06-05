-- Neutralise the audit-reason requirement everywhere.
--
-- We keep the audit_log.reason column and the p_reason parameters on every
-- RPC (and the `app.audit_reason` GUC binding) so historical data and the
-- function signatures stay intact. What changes:
--
--   1) _validate_reason() becomes a no-op — empty / null reason is always OK.
--   2) log_pin_reset() drops its own reason-required check.
--
-- After this migration the UI can stop collecting the reason and pass an
-- empty string; new audit rows will simply have reason='' or NULL.

CREATE OR REPLACE FUNCTION public._validate_reason(p_role user_role, p_reason text, p_destructive boolean)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Reason is no longer required; this function only verifies the caller's
  -- role is one of the allowed mutators (otherwise their RPC wrapper would
  -- have already raised permission_denied long before we get here).
  IF p_role NOT IN ('super_admin','supervisor') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_pin_reset(
  p_caller_id uuid,
  p_target_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users;
BEGIN
  SELECT * INTO v_caller FROM public.app_users WHERE id = p_caller_id AND deleted_at IS NULL AND is_active = true;
  IF v_caller.id IS NULL OR v_caller.role <> 'super_admin' THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  IF p_caller_id = p_target_id THEN
    RAISE EXCEPTION 'self_modification_forbidden';
  END IF;

  INSERT INTO public.audit_log (table_name, record_id, operation, changed_by, reason, new_values)
  VALUES ('app_users', p_target_id, 'update', p_caller_id, coalesce(p_reason, ''), jsonb_build_object('password_reset', true));
END;
$$;
