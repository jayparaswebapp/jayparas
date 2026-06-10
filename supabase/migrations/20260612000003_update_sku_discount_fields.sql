-- Extend update_sku to also accept discount_pct + is_discountable so the
-- SKU edit form can flip those after-the-fact. New params default to NULL;
-- when NULL, the UPDATE keeps the column's current value (so existing
-- callers that omit them continue to work without flipping the flag back
-- to false on every save). When non-NULL, the new value wins.

CREATE OR REPLACE FUNCTION public.update_sku(
  p_id uuid,
  p_design_name text,
  p_price numeric,
  p_photo_path text,
  p_reason text,
  p_discount_pct numeric DEFAULT NULL,
  p_is_discountable boolean DEFAULT NULL
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

  IF p_design_name IS NULL OR length(btrim(p_design_name)) = 0 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_price IS NULL OR p_price < 0 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_discount_pct IS NOT NULL AND (p_discount_pct < 0 OR p_discount_pct > 100) THEN RAISE EXCEPTION 'invalid_input'; END IF;

  UPDATE public.skus
  SET design_name    = btrim(p_design_name),
      price          = p_price,
      photo_path     = nullif(p_photo_path, ''),
      discount_pct   = coalesce(p_discount_pct, discount_pct),
      is_discountable = coalesce(p_is_discountable, is_discountable)
  WHERE id = p_id AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;
