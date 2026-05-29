-- WS-E1 migration 3/3: SECURITY DEFINER RPCs for SKU mutations.
-- Follows the per-ADR-005 pattern established in migration 8 (master data).
--
-- Functions raise English-keyed exceptions translated by the client via
-- src/lib/rpc/errors.ts. New keys introduced here:
--   sku_duplicate  — partial unique index rejected the insert (same design+pack
--                    already exists live). Server action re-queries by sku_code
--                    to find the existing row's id and offers a deep link to it.
--   invalid_input  — already exists (generic input-shape failure).
--
-- v1 does NOT expose soft_delete_sku via UI — per the workstream brief,
-- deleted_at is reserved for super_admin SQL-level mistakes only. Deactivation
-- (is_active = false) is the user-facing "remove from rotation" action and is
-- gated to super_admin via set_sku_active.

-- =========================================================================
-- create_sku — super_admin + supervisor.
-- sku_code is generated client-side (deterministic from design/mix + pack_size)
-- and passed through so the create can present the duplicate link without
-- another round-trip.
-- =========================================================================
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
  PERFORM public._validate_reason(v_caller.role, p_reason, false);
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

-- =========================================================================
-- update_sku — super_admin + supervisor.
-- Editable fields only: design_name, price, photo_path.
-- Locked fields (pack_type / design_no / mix_code / pack_size / sku_code)
-- are deliberately not parameters; updating them would invalidate already-
-- printed barcode labels on physical stock.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.update_sku(
  p_id uuid,
  p_design_name text,
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
  PERFORM public._validate_reason(v_caller.role, p_reason, false);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  IF p_design_name IS NULL OR length(btrim(p_design_name)) = 0 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_price IS NULL OR p_price < 0 THEN RAISE EXCEPTION 'invalid_input'; END IF;

  UPDATE public.skus
  SET design_name = btrim(p_design_name),
      price = p_price,
      photo_path = nullif(p_photo_path, '')
  WHERE id = p_id AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

-- =========================================================================
-- set_sku_active — super_admin only.
-- Deactivation is the user-facing "remove from rotation" action. Per the role
-- matrix in data-model-inventory.md §5, only super_admin can flip is_active.
-- Supervisor can edit name/price/photo but cannot toggle the flag.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.set_sku_active(
  p_id uuid,
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
  v_row public.skus;
BEGIN
  IF v_caller.role <> 'super_admin' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, true);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  IF p_is_active IS NULL THEN RAISE EXCEPTION 'invalid_input'; END IF;

  UPDATE public.skus
  SET is_active = p_is_active
  WHERE id = p_id AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_sku
  (text, text, text, text, text, integer, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_sku
  (uuid, text, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_sku_active
  (uuid, boolean, text) TO authenticated;
