-- Kite pricing: Companies → Product Groups → SKUs, plus per-party
-- company-wise discount % and an A/B/C party type.
--
-- Rules (agreed 2026-11-11):
--   * Kite only. Rakhi billing is untouched.
--   * Price is the same for everyone. Only the discount % differs.
--   * Each Product Group belongs to exactly one Company.
--   * Each party has its own discount % per Company (missing row = 0%).
--   * Party type A (wholesaler) / B (semi-wholesaler) / C (retailer) is a
--     label only — it does not change any amount. Existing parties = C.
--
-- Existing create_sku / update_sku / create_billing_customer /
-- update_billing_customer are NOT changed. New fields are saved through
-- separate RPCs below so nothing that works today is affected.

-- =========================================================================
-- 1. Companies
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.kite_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES public.app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS kite_companies_name_uq
  ON public.kite_companies (lower(name)) WHERE deleted_at IS NULL;

-- =========================================================================
-- 2. Product groups (each belongs to one company)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.product_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  company_id uuid NOT NULL REFERENCES public.kite_companies(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES public.app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS product_groups_name_uq
  ON public.product_groups (lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS product_groups_company_idx
  ON public.product_groups (company_id) WHERE deleted_at IS NULL;

-- =========================================================================
-- 3. SKUs: kite/rakhi tag + product group
-- =========================================================================
ALTER TABLE public.skus
  ADD COLUMN IF NOT EXISTS business_line public.business_line NOT NULL DEFAULT 'rakhi',
  ADD COLUMN IF NOT EXISTS product_group_id uuid REFERENCES public.product_groups(id);

CREATE INDEX IF NOT EXISTS skus_product_group_idx
  ON public.skus (product_group_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS skus_business_line_idx
  ON public.skus (business_line) WHERE deleted_at IS NULL;

-- =========================================================================
-- 4. Parties: A/B/C type + company-wise discount
-- =========================================================================
ALTER TABLE public.billing_customers
  ADD COLUMN IF NOT EXISTS price_tier text NOT NULL DEFAULT 'C';

DO $$ BEGIN
  ALTER TABLE public.billing_customers
    ADD CONSTRAINT billing_customers_price_tier_chk CHECK (price_tier IN ('A','B','C'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- `id` is required by write_audit_log() (it records NEW.id).
CREATE TABLE IF NOT EXISTS public.customer_company_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.billing_customers(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.kite_companies(id) ON DELETE CASCADE,
  discount_pct numeric(5,2) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ccd_customer_company_uq UNIQUE (customer_id, company_id),
  CONSTRAINT ccd_discount_range CHECK (discount_pct >= 0 AND discount_pct <= 100)
);

-- =========================================================================
-- 5. Triggers, RLS, audit (same pattern as customer_groups)
-- =========================================================================
DROP TRIGGER IF EXISTS trg_kite_companies_updated_at ON public.kite_companies;
CREATE TRIGGER trg_kite_companies_updated_at BEFORE UPDATE ON public.kite_companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_product_groups_updated_at ON public.product_groups;
CREATE TRIGGER trg_product_groups_updated_at BEFORE UPDATE ON public.product_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_ccd_updated_at ON public.customer_company_discounts;
CREATE TRIGGER trg_ccd_updated_at BEFORE UPDATE ON public.customer_company_discounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['kite_companies','product_groups','customer_company_discounts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated read %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "authenticated read %s" ON public.%I FOR SELECT USING (auth.uid() IS NOT NULL)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "super_admin or supervisor write %s" ON public.%I', t, t);
    EXECUTE format($p$CREATE POLICY "super_admin or supervisor write %s" ON public.%I FOR ALL USING (
      EXISTS (SELECT 1 FROM public.app_users a WHERE a.auth_user_id = auth.uid()
              AND a.role IN ('super_admin','supervisor') AND a.deleted_at IS NULL))$p$, t, t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%s ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER audit_%s AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.write_audit_log()', t, t);
  END LOOP;
END $$;

-- =========================================================================
-- 6. RPCs
-- Errors: company_name_taken, group_name_taken, company_in_use,
--         group_in_use, invalid_input, not_found, permission_denied
-- =========================================================================

-- ---- Companies ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_kite_company(
  p_id uuid,            -- NULL = create
  p_name text,
  p_is_active boolean,
  p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.kite_companies;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, false);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);
  BEGIN
    IF p_id IS NULL THEN
      INSERT INTO public.kite_companies (name, created_by)
      VALUES (btrim(p_name), v_caller.id) RETURNING * INTO v_row;
    ELSE
      UPDATE public.kite_companies
        SET name = btrim(p_name), is_active = coalesce(p_is_active, true)
        WHERE id = p_id AND deleted_at IS NULL RETURNING * INTO v_row;
      IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
    END IF;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'company_name_taken';
  END;
  RETURN to_jsonb(v_row);
END; $$;

CREATE OR REPLACE FUNCTION public.soft_delete_kite_company(p_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.kite_companies;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, true);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);
  IF EXISTS (SELECT 1 FROM public.product_groups WHERE company_id = p_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'company_in_use';
  END IF;
  UPDATE public.kite_companies SET deleted_at = now(), is_active = false
    WHERE id = p_id AND deleted_at IS NULL RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END; $$;

-- ---- Product groups -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_product_group(
  p_id uuid,            -- NULL = create
  p_name text,
  p_company_id uuid,
  p_is_active boolean,
  p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.product_groups;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kite_companies WHERE id = p_company_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, false);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);
  BEGIN
    IF p_id IS NULL THEN
      INSERT INTO public.product_groups (name, company_id, created_by)
      VALUES (btrim(p_name), p_company_id, v_caller.id) RETURNING * INTO v_row;
    ELSE
      UPDATE public.product_groups
        SET name = btrim(p_name), company_id = p_company_id,
            is_active = coalesce(p_is_active, true)
        WHERE id = p_id AND deleted_at IS NULL RETURNING * INTO v_row;
      IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
    END IF;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'group_name_taken';
  END;
  RETURN to_jsonb(v_row);
END; $$;

CREATE OR REPLACE FUNCTION public.soft_delete_product_group(p_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.product_groups;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, true);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);
  IF EXISTS (SELECT 1 FROM public.skus WHERE product_group_id = p_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'group_in_use';
  END IF;
  UPDATE public.product_groups SET deleted_at = now(), is_active = false
    WHERE id = p_id AND deleted_at IS NULL RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END; $$;

-- ---- SKU kite fields (one or many SKUs; used by single + Multi Barcode) --
-- Kite SKUs must have a product group; rakhi SKUs have none.
CREATE OR REPLACE FUNCTION public.set_sku_kite_fields(
  p_sku_ids uuid[],
  p_business_line public.business_line,
  p_product_group_id uuid,
  p_reason text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_count integer;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF p_business_line = 'kite' AND NOT EXISTS (
       SELECT 1 FROM public.product_groups WHERE id = p_product_group_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  PERFORM public._bind_audit_context(v_caller.id, p_reason);
  UPDATE public.skus
    SET business_line = p_business_line,
        product_group_id = CASE WHEN p_business_line = 'kite' THEN p_product_group_id ELSE NULL END
    WHERE id = ANY(p_sku_ids) AND deleted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;

-- ---- Party kite pricing (replaces all company % rows for the party) -----
-- p_discounts: [{"company_id": "...", "discount_pct": 12.5}, ...]
-- Rows with 0 or blank are simply not stored (missing = 0%).
CREATE OR REPLACE FUNCTION public.set_customer_kite_pricing(
  p_customer_id uuid,
  p_price_tier text,
  p_discounts jsonb,
  p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF p_price_tier NOT IN ('A','B','C') THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.billing_customers WHERE id = p_customer_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  UPDATE public.billing_customers SET price_tier = p_price_tier WHERE id = p_customer_id;

  DELETE FROM public.customer_company_discounts WHERE customer_id = p_customer_id;

  BEGIN
    INSERT INTO public.customer_company_discounts (customer_id, company_id, discount_pct)
    SELECT p_customer_id, (d->>'company_id')::uuid, (d->>'discount_pct')::numeric
    FROM jsonb_array_elements(coalesce(p_discounts, '[]'::jsonb)) d
    WHERE coalesce(nullif(d->>'discount_pct',''),'0')::numeric > 0;
  EXCEPTION
    WHEN check_violation OR foreign_key_violation OR invalid_text_representation
      OR unique_violation THEN RAISE EXCEPTION 'invalid_input';
  END;

  RETURN jsonb_build_object('customer_id', p_customer_id, 'price_tier', p_price_tier);
END; $$;

REVOKE EXECUTE ON FUNCTION
  public.save_kite_company(uuid, text, boolean, text),
  public.soft_delete_kite_company(uuid, text),
  public.save_product_group(uuid, text, uuid, boolean, text),
  public.soft_delete_product_group(uuid, text),
  public.set_sku_kite_fields(uuid[], public.business_line, uuid, text),
  public.set_customer_kite_pricing(uuid, text, jsonb, text)
FROM anon, public;
GRANT EXECUTE ON FUNCTION
  public.save_kite_company(uuid, text, boolean, text),
  public.soft_delete_kite_company(uuid, text),
  public.save_product_group(uuid, text, uuid, boolean, text),
  public.soft_delete_product_group(uuid, text),
  public.set_sku_kite_fields(uuid[], public.business_line, uuid, text),
  public.set_customer_kite_pricing(uuid, text, jsonb, text)
TO authenticated;
