-- Per-SKU "discountable" flag. Default OFF (=non-discountable) so existing rows
-- behave as kids items unless explicitly marked. The invoice print page groups
-- discountable items on top with a subtotal, then a spacer, then
-- non-discountable items with their own subtotal, then the grand total.
--
-- The flag is also captured into invoice_lines.sku_snapshot when a line is
-- created, so changing a SKU's flag later doesn't re-group historical
-- invoices — each invoice is frozen at the snapshot taken when the line
-- was first picked.

ALTER TABLE public.skus
  ADD COLUMN IF NOT EXISTS is_discountable boolean NOT NULL DEFAULT false;

-- Replace create_sku to thread the new param through. New optional param
-- defaults to false, so any existing caller that doesn't pass it still works.
CREATE OR REPLACE FUNCTION public.create_sku(
  p_sku_code text,
  p_pack_type text,
  p_design_no text,
  p_mix_code text,
  p_design_name text,
  p_pack_size integer,
  p_price numeric,
  p_photo_path text,
  p_reason text,
  p_discount_pct numeric DEFAULT 0,
  p_is_discountable boolean DEFAULT false
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
  IF p_discount_pct IS NULL OR p_discount_pct < 0 OR p_discount_pct > 100 THEN RAISE EXCEPTION 'invalid_input'; END IF;

  BEGIN
    INSERT INTO public.skus (
      sku_code, pack_type, design_no, mix_code, design_name,
      pack_size, price, photo_path, discount_pct, is_discountable, created_by
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
      p_discount_pct,
      coalesce(p_is_discountable, false),
      v_caller.id
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'sku_duplicate';
  END;

  RETURN to_jsonb(v_row);
END;
$$;
