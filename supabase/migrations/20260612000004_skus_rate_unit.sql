-- rate_unit on skus: 'pack' (rate is per-pack/dozen, qty defaults to 1 on the
-- invoice) or 'piece' (rate is per-piece, qty defaults to pack_size). New
-- "12 pcs" tile on the SKU form picks 'piece'; existing "1 Doz" tile picks
-- 'pack'. Existing rows default to 'piece' because that matches the current
-- invoice pre-fill behaviour (qty = pack_size, rate = sku.price).

ALTER TABLE public.skus
  ADD COLUMN IF NOT EXISTS rate_unit text NOT NULL DEFAULT 'piece';

ALTER TABLE public.skus
  DROP CONSTRAINT IF EXISTS skus_rate_unit_check;

ALTER TABLE public.skus
  ADD CONSTRAINT skus_rate_unit_check CHECK (rate_unit IN ('pack', 'piece'));

-- Original check required design_no on every single pack. The new SKU form
-- combines design number into the design name, so design_no is now optional
-- for single packs (still required for the legacy mix path, which the UI
-- no longer exposes but the schema keeps).
DO $$
DECLARE
  v_name text;
BEGIN
  SELECT conname INTO v_name
  FROM pg_constraint
  WHERE conrelid = 'public.skus'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%design_no%mix_code%';
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.skus DROP CONSTRAINT %I', v_name);
  END IF;
END $$;

ALTER TABLE public.skus
  ADD CONSTRAINT skus_pack_type_keys CHECK (
    (pack_type = 'single' AND mix_code IS NULL)
    OR
    (pack_type = 'mix'    AND mix_code IS NOT NULL AND design_no IS NULL)
  );

-- create_sku gains p_rate_unit (defaults to 'piece' so older bulk callers
-- that don't pass it stay on the existing behaviour).
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
  p_is_discountable boolean DEFAULT false,
  p_rate_unit text DEFAULT 'piece'
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
  -- design_no is no longer required for single packs (combined into design_name)
  -- but the param is still accepted and stored if passed (for legacy callers).
  IF p_pack_type = 'mix'    AND (p_mix_code  IS NULL OR length(btrim(p_mix_code))  = 0) THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_price IS NULL OR p_price < 0 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_discount_pct IS NULL OR p_discount_pct < 0 OR p_discount_pct > 100 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_rate_unit IS NOT NULL AND p_rate_unit NOT IN ('pack','piece') THEN RAISE EXCEPTION 'invalid_input'; END IF;

  BEGIN
    INSERT INTO public.skus (
      sku_code, pack_type, design_no, mix_code, design_name,
      pack_size, price, photo_path, discount_pct, is_discountable,
      rate_unit, created_by
    )
    VALUES (
      btrim(p_sku_code),
      p_pack_type,
      CASE WHEN p_pack_type = 'single' AND p_design_no IS NOT NULL AND length(btrim(p_design_no)) > 0
        THEN btrim(p_design_no) ELSE NULL END,
      CASE WHEN p_pack_type = 'mix'    THEN btrim(p_mix_code)  ELSE NULL END,
      btrim(p_design_name),
      p_pack_size,
      p_price,
      nullif(p_photo_path, ''),
      p_discount_pct,
      coalesce(p_is_discountable, false),
      coalesce(p_rate_unit, 'piece'),
      v_caller.id
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'sku_duplicate';
  END;

  RETURN to_jsonb(v_row);
END;
$$;
