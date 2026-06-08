-- Drop the reason-required check from create_sku.
--
-- The original RPC called public._validate_reason(role, reason, false), which
-- always raises 'reason_required' for super_admins regardless of the
-- destructive flag. That made every super_admin SKU create fail once the
-- audit-reason field was removed from the UI: the client passed
-- p_reason = '' and the DB rejected it.
--
-- Creating a fresh row has no prior state worth justifying, so the audit
-- reason was misplaced here. Update and deactivate flows still validate
-- their reasons. _bind_audit_context is kept so the audit row records the
-- empty reason consistently with the rest of the system.

CREATE OR REPLACE FUNCTION public.create_sku(
  p_sku_code text,
  p_pack_type text,
  p_design_no text,
  p_mix_code text,
  p_design_name text,
  p_pack_size integer,
  p_price numeric,
  p_photo_path text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.skus;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  IF p_pack_type NOT IN ('single','mix') THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_pack_size IS NULL OR p_pack_size <= 0 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_design_name IS NULL OR length(btrim(p_design_name)) = 0 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_pack_type = 'single' AND (p_design_no IS NULL OR length(btrim(p_design_no)) = 0) THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_pack_type = 'mix'    AND (p_mix_code  IS NULL OR length(btrim(p_mix_code))  = 0) THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_price IS NULL OR p_price < 0 THEN RAISE EXCEPTION 'invalid_input'; END IF;

  BEGIN
    INSERT INTO public.skus (
      sku_code, pack_type, design_no, mix_code, design_name,
      pack_size, price, photo_path, created_by
    )
    VALUES (
      btrim(p_sku_code),
      p_pack_type,
      CASE WHEN p_pack_type = 'single' THEN btrim(p_design_no) ELSE NULL END,
      CASE WHEN p_pack_type = 'mix'    THEN btrim(p_mix_code)  ELSE NULL END,
      btrim(p_design_name),
      p_pack_size,
      p_price,
      nullif(p_photo_path, ''),
      v_caller.id
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'sku_duplicate';
  END;

  RETURN to_jsonb(v_row);
END;
$$;
