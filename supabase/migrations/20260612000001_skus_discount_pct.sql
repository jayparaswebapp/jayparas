-- Add discount_pct to skus (0-100, default 0) so each SKU carries its own
-- default invoice discount. Bulk-create on /skus/multiple sets this; the
-- single-create form on /skus/new also gets a Discount field. Existing
-- callers of create_sku that don't pass p_discount_pct still work because
-- the new parameter defaults to 0.

ALTER TABLE public.skus
  ADD COLUMN IF NOT EXISTS discount_pct numeric(5, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.skus
  ADD CONSTRAINT skus_discount_pct_range
  CHECK (discount_pct >= 0 AND discount_pct <= 100);

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
  p_discount_pct numeric DEFAULT 0
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
      pack_size, price, photo_path, discount_pct, created_by
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
      v_caller.id
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'sku_duplicate';
  END;

  RETURN to_jsonb(v_row);
END;
$$;
