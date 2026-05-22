-- WS-B migration 8/8: SECURITY DEFINER RPC functions per ADR-005.
--
-- Every mutation on a business table goes through one of these functions.
-- They derive the caller from auth.uid() (never trusting client-supplied IDs),
-- enforce role + reason rules, set the audit context via set_config(..., true)
-- so the audit trigger captures both changed_by and reason in the SAME txn,
-- perform the mutation, and return jsonb.
--
-- Error contract: exceptions are raised with a stable English message that the
-- client treats as an error key and translates via next-intl. Known keys:
--   session_invalid                -> auth missing or app_users row missing/deleted
--   permission_denied              -> caller's role isn't allowed for this op
--   reason_required                -> super_admin omitted reason, or supervisor omitted on destructive op
--   mobile_taken                   -> uniqueness violation on mobile (lead_ladies / app_users)
--   design_number_taken            -> uniqueness violation on design_number
--   not_found                      -> target row doesn't exist or is wrong state
--   self_modification_forbidden    -> caller tried to demote / deactivate / soft-delete themselves
--   centre_manager_locations_exist -> tried to change role away from centre_manager while assignments exist
--   setting_locked                 -> tried to update a setting whose is_locked = true
--   invalid_input                  -> generic input-shape failure (e.g. empty array where required)

-- =========================================================================
-- Helper: resolve calling user
-- =========================================================================
CREATE OR REPLACE FUNCTION public._current_app_user()
RETURNS public.app_users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.app_users;
BEGIN
  SELECT * INTO v_row
  FROM public.app_users
  WHERE auth_user_id = auth.uid()
    AND deleted_at IS NULL
    AND is_active = true
  LIMIT 1;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'session_invalid';
  END IF;

  RETURN v_row;
END;
$$;

-- =========================================================================
-- Helper: validate audit reason for role/operation per Q7
--   super_admin                         -> reason required for every mutation
--   supervisor                          -> required only for destructive ops
--   anything else                       -> permission_denied (caller shouldn't reach here)
-- p_destructive: true when op is soft_delete, restore, or deactivation.
-- =========================================================================
CREATE OR REPLACE FUNCTION public._validate_reason(p_role user_role, p_reason text, p_destructive boolean)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_role = 'super_admin' THEN
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
      RAISE EXCEPTION 'reason_required';
    END IF;
  ELSIF p_role = 'supervisor' THEN
    IF p_destructive AND (p_reason IS NULL OR length(btrim(p_reason)) = 0) THEN
      RAISE EXCEPTION 'reason_required';
    END IF;
  ELSE
    RAISE EXCEPTION 'permission_denied';
  END IF;
END;
$$;

-- =========================================================================
-- Helper: bind audit context for the current transaction.
-- =========================================================================
CREATE OR REPLACE FUNCTION public._bind_audit_context(p_app_user_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM set_config('app.changed_by', p_app_user_id::text, true);
  PERFORM set_config('app.audit_reason', coalesce(p_reason, ''), true);
END;
$$;

-- =========================================================================
-- LOCATIONS (super_admin only — read for everyone)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.update_location(
  p_id uuid,
  p_name_en text,
  p_name_gu text,
  p_is_active boolean,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.locations;
BEGIN
  IF v_caller.role <> 'super_admin' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, false);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  UPDATE public.locations
  SET name_en = p_name_en,
      name_gu = p_name_gu,
      is_active = p_is_active
  WHERE id = p_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

-- =========================================================================
-- DESIGNS (super_admin + supervisor write; restore = super_admin only)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_design(
  p_design_number text,
  p_name_en text,
  p_name_gu text,
  p_rate numeric,
  p_image_path text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.designs;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, false);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  BEGIN
    INSERT INTO public.designs (design_number, name_en, name_gu, current_rate_per_guss, image_path, created_by)
    VALUES (btrim(p_design_number), nullif(btrim(p_name_en),''), nullif(btrim(p_name_gu),''), p_rate, nullif(p_image_path,''), v_caller.id)
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'design_number_taken';
  END;

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_design(
  p_id uuid,
  p_design_number text,
  p_name_en text,
  p_name_gu text,
  p_rate numeric,
  p_image_path text,
  p_is_active boolean,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.designs;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, false);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  BEGIN
    UPDATE public.designs
    SET design_number = btrim(p_design_number),
        name_en = nullif(btrim(p_name_en),''),
        name_gu = nullif(btrim(p_name_gu),''),
        current_rate_per_guss = p_rate,
        image_path = nullif(p_image_path,''),
        is_active = p_is_active
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'design_number_taken';
  END;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_design(p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.designs;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, true);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  UPDATE public.designs
  SET deleted_at = now(), is_active = false
  WHERE id = p_id AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_design(p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.designs;
BEGIN
  IF v_caller.role <> 'super_admin' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, true);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  BEGIN
    UPDATE public.designs
    SET deleted_at = NULL, is_active = true
    WHERE id = p_id AND deleted_at IS NOT NULL
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    -- design_number partial unique on non-deleted rows; collision means a live design now uses this number.
    RAISE EXCEPTION 'design_number_taken';
  END;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

-- =========================================================================
-- LEAD LADIES (super_admin + supervisor write)
-- Multi-set helper: replace all location assignments in one statement.
-- =========================================================================
CREATE OR REPLACE FUNCTION public._set_lead_lady_locations(p_lead_lady_id uuid, p_location_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.lead_lady_locations WHERE lead_lady_id = p_lead_lady_id;
  IF p_location_ids IS NOT NULL AND array_length(p_location_ids, 1) > 0 THEN
    INSERT INTO public.lead_lady_locations (lead_lady_id, location_id)
    SELECT p_lead_lady_id, loc_id FROM unnest(p_location_ids) AS loc_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_lead_lady(
  p_full_name text,
  p_mobile text,
  p_notes text,
  p_location_ids uuid[],
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.lead_ladies;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, false);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  BEGIN
    INSERT INTO public.lead_ladies (full_name, mobile, notes, created_by)
    VALUES (btrim(p_full_name), btrim(p_mobile), nullif(btrim(p_notes),''), v_caller.id)
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'mobile_taken';
  END;

  PERFORM public._set_lead_lady_locations(v_row.id, p_location_ids);
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_lead_lady(
  p_id uuid,
  p_full_name text,
  p_mobile text,
  p_notes text,
  p_location_ids uuid[],
  p_is_active boolean,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.lead_ladies;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, false);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  BEGIN
    UPDATE public.lead_ladies
    SET full_name = btrim(p_full_name),
        mobile = btrim(p_mobile),
        notes = nullif(btrim(p_notes),''),
        is_active = p_is_active
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'mobile_taken';
  END;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  PERFORM public._set_lead_lady_locations(v_row.id, p_location_ids);
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_lead_lady(p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.lead_ladies;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, true);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  -- Drop active location assignments. They are not history-bearing; restore
  -- requires re-assignment by super_admin.
  DELETE FROM public.lead_lady_locations WHERE lead_lady_id = p_id;

  UPDATE public.lead_ladies
  SET deleted_at = now(), is_active = false
  WHERE id = p_id AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_lead_lady(p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.lead_ladies;
BEGIN
  IF v_caller.role <> 'super_admin' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, true);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  BEGIN
    UPDATE public.lead_ladies
    SET deleted_at = NULL, is_active = true
    WHERE id = p_id AND deleted_at IS NOT NULL
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    -- Mobile partial-unique among non-deleted rows; collision means a live lead lady has the same mobile.
    RAISE EXCEPTION 'mobile_taken';
  END;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

-- =========================================================================
-- APP USERS (super_admin only).
-- Two-step create: server caller first creates auth.users via admin API and
-- passes the resulting auth_user_id here. We insert app_users + optional
-- centre_manager_locations atomically. Server is responsible for rolling
-- back the auth user on RPC failure (mirrors seed-super-admin pattern).
-- =========================================================================
CREATE OR REPLACE FUNCTION public._set_centre_manager_locations(p_app_user_id uuid, p_location_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.centre_manager_locations WHERE app_user_id = p_app_user_id;
  IF p_location_ids IS NOT NULL AND array_length(p_location_ids, 1) > 0 THEN
    INSERT INTO public.centre_manager_locations (app_user_id, location_id)
    SELECT p_app_user_id, loc_id FROM unnest(p_location_ids) AS loc_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_app_user(
  p_auth_user_id uuid,
  p_full_name text,
  p_mobile text,
  p_role user_role,
  p_location_ids uuid[],
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.app_users;
BEGIN
  IF v_caller.role <> 'super_admin' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, false);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  IF p_role = 'centre_manager' AND (p_location_ids IS NULL OR array_length(p_location_ids, 1) IS NULL) THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  BEGIN
    INSERT INTO public.app_users (auth_user_id, full_name, mobile, role)
    VALUES (p_auth_user_id, btrim(p_full_name), btrim(p_mobile), p_role)
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'mobile_taken';
  END;

  IF p_role = 'centre_manager' THEN
    PERFORM public._set_centre_manager_locations(v_row.id, p_location_ids);
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_app_user(
  p_id uuid,
  p_full_name text,
  p_role user_role,
  p_is_active boolean,
  p_location_ids uuid[],
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_target public.app_users;
  v_row public.app_users;
  v_old_role public.user_role;
  v_assignments_count int;
BEGIN
  IF v_caller.role <> 'super_admin' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, false);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  SELECT * INTO v_target FROM public.app_users WHERE id = p_id AND deleted_at IS NULL;
  IF v_target.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  -- Self-protection (Q11): caller cannot demote/deactivate themselves.
  IF v_target.id = v_caller.id THEN
    IF p_role <> v_caller.role OR p_is_active = false THEN
      RAISE EXCEPTION 'self_modification_forbidden';
    END IF;
  END IF;

  v_old_role := v_target.role;

  -- Q4: changing role away from centre_manager is blocked while assignments exist.
  IF v_old_role = 'centre_manager' AND p_role <> 'centre_manager' THEN
    SELECT count(*) INTO v_assignments_count
    FROM public.centre_manager_locations
    WHERE app_user_id = p_id;
    IF v_assignments_count > 0 THEN
      RAISE EXCEPTION 'centre_manager_locations_exist';
    END IF;
  END IF;

  -- Centre managers must have at least one location.
  IF p_role = 'centre_manager' AND (p_location_ids IS NULL OR array_length(p_location_ids, 1) IS NULL) THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  UPDATE public.app_users
  SET full_name = btrim(p_full_name),
      role = p_role,
      is_active = p_is_active
  WHERE id = p_id
  RETURNING * INTO v_row;

  IF p_role = 'centre_manager' THEN
    PERFORM public._set_centre_manager_locations(v_row.id, p_location_ids);
  ELSE
    -- Role changed away from centre_manager (assignments already verified empty above).
    DELETE FROM public.centre_manager_locations WHERE app_user_id = v_row.id;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_app_user(p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.app_users;
BEGIN
  IF v_caller.role <> 'super_admin' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, true);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  IF p_id = v_caller.id THEN RAISE EXCEPTION 'self_modification_forbidden'; END IF;

  -- Drop centre_manager assignments (re-assigned on restore by super_admin).
  DELETE FROM public.centre_manager_locations WHERE app_user_id = p_id;

  UPDATE public.app_users
  SET deleted_at = now(), is_active = false
  WHERE id = p_id AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_app_user(p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.app_users;
BEGIN
  IF v_caller.role <> 'super_admin' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, true);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  BEGIN
    UPDATE public.app_users
    SET deleted_at = NULL, is_active = true
    WHERE id = p_id AND deleted_at IS NOT NULL
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'mobile_taken';
  END;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

-- =========================================================================
-- SETTINGS — single batch update under one audit reason.
-- p_changes is a jsonb object: { "<key>": <numeric>, ... }.
-- Locked keys are rejected up front to avoid partial saves.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.update_settings_batch(p_changes jsonb, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_locked_count int;
  v_unknown_count int;
  v_change record;
  v_updated_keys text[] := ARRAY[]::text[];
BEGIN
  IF v_caller.role <> 'super_admin' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, false);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  -- Reject if any submitted key is locked.
  SELECT count(*) INTO v_locked_count
  FROM jsonb_object_keys(p_changes) k
  JOIN public.settings s ON s.key = k
  WHERE s.is_locked = true;
  IF v_locked_count > 0 THEN RAISE EXCEPTION 'setting_locked'; END IF;

  -- Reject if any submitted key doesn't exist.
  SELECT count(*) INTO v_unknown_count
  FROM jsonb_object_keys(p_changes) k
  LEFT JOIN public.settings s ON s.key = k
  WHERE s.key IS NULL;
  IF v_unknown_count > 0 THEN RAISE EXCEPTION 'invalid_input'; END IF;

  FOR v_change IN
    SELECT key, value FROM jsonb_each(p_changes)
  LOOP
    UPDATE public.settings
    SET value_numeric = (v_change.value)::text::numeric,
        updated_by = v_caller.id
    WHERE key = v_change.key
      AND value_numeric IS DISTINCT FROM (v_change.value)::text::numeric;

    IF FOUND THEN
      v_updated_keys := array_append(v_updated_keys, v_change.key);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('updated_keys', v_updated_keys);
END;
$$;

-- =========================================================================
-- AUDIT FROM EDGE FUNCTIONS (PIN reset).
-- Called by service-role client inside the reset-user-pin Edge Function.
-- Caller identity passed explicitly because Edge Functions don't bind auth.uid()
-- to public.app_users implicitly. The function still validates that the caller
-- is super_admin and that target != caller, mirroring the function's own checks
-- as a defence-in-depth layer in case the Edge Function is bypassed.
-- =========================================================================
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
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  INSERT INTO public.audit_log (table_name, record_id, operation, changed_by, reason, new_values)
  VALUES ('app_users', p_target_id, 'update', p_caller_id, p_reason, jsonb_build_object('password_reset', true));
END;
$$;

-- =========================================================================
-- Grants — these RPCs are callable by any authenticated client; the function
-- bodies enforce role + reason rules. anon cannot call them (no grant).
-- =========================================================================
GRANT EXECUTE ON FUNCTION public.update_location              (uuid, text, text, boolean, text)                             TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_design                (text, text, text, numeric, text, text)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_design                (uuid, text, text, text, numeric, text, boolean, text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_design           (uuid, text)                                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_design               (uuid, text)                                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_lead_lady             (text, text, text, uuid[], text)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_lead_lady             (uuid, text, text, text, uuid[], boolean, text)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_lead_lady        (uuid, text)                                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_lead_lady            (uuid, text)                                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_app_user              (uuid, text, text, user_role, uuid[], text)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_app_user              (uuid, text, user_role, boolean, uuid[], text)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_app_user         (uuid, text)                                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_app_user             (uuid, text)                                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_settings_batch        (jsonb, text)                                                 TO authenticated;
-- log_pin_reset is service-role only; do not grant to authenticated.
