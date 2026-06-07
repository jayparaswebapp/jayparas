-- Purchase department: suppliers + purchase items.
--
-- suppliers       — mirror of billing_customers (vendor master)
-- purchase_items  — raw material / consumable master, used as line items
--                   on purchase bills. Includes optional default rate and
--                   default GST% so picking an item auto-fills sensible
--                   values on a bill.

CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  business_name text,
  mobile text NOT NULL,
  email text,
  gstin text,
  pan text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  pincode text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES public.app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_mobile_active
  ON public.suppliers(mobile) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_gstin_active
  ON public.suppliers(gstin) WHERE deleted_at IS NULL AND gstin IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_full_name
  ON public.suppliers(full_name);

DROP TRIGGER IF EXISTS trg_suppliers_updated_at ON public.suppliers;
CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read suppliers" ON public.suppliers;
CREATE POLICY "authenticated read suppliers" ON public.suppliers
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "super_admin or supervisor write suppliers" ON public.suppliers;
CREATE POLICY "super_admin or supervisor write suppliers" ON public.suppliers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );

REVOKE SELECT ON public.suppliers FROM anon;

DROP TRIGGER IF EXISTS audit_suppliers ON public.suppliers;
CREATE TRIGGER audit_suppliers
  AFTER INSERT OR UPDATE OR DELETE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

CREATE TABLE IF NOT EXISTS public.purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code text NOT NULL,
  name text NOT NULL,
  name_gu text,
  uom text NOT NULL DEFAULT 'pcs',
  hsn_code text,
  default_rate numeric(14,2) NOT NULL DEFAULT 0,
  default_gst_pct numeric(5,2) NOT NULL DEFAULT 0,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES public.app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_items_code_active
  ON public.purchase_items(item_code) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_items_name
  ON public.purchase_items(name);

DROP TRIGGER IF EXISTS trg_purchase_items_updated_at ON public.purchase_items;
CREATE TRIGGER trg_purchase_items_updated_at
  BEFORE UPDATE ON public.purchase_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read purchase_items" ON public.purchase_items;
CREATE POLICY "authenticated read purchase_items" ON public.purchase_items
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "super_admin or supervisor write purchase_items" ON public.purchase_items;
CREATE POLICY "super_admin or supervisor write purchase_items" ON public.purchase_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );

REVOKE SELECT ON public.purchase_items FROM anon;

DROP TRIGGER IF EXISTS audit_purchase_items ON public.purchase_items;
CREATE TRIGGER audit_purchase_items
  AFTER INSERT OR UPDATE OR DELETE ON public.purchase_items
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

-- =========================================================================
-- RPCs — mirror the billing pattern: caller derived from auth.uid(),
-- role-gated, audit context bound, unique-violation mapped to readable keys.
-- New error keys: supplier_mobile_taken, supplier_gstin_taken,
--                 item_code_taken
-- (kept separate from customer keys so error messages can be specific).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.create_supplier(
  p_full_name text,
  p_business_name text,
  p_mobile text,
  p_email text,
  p_gstin text,
  p_pan text,
  p_address_line1 text,
  p_address_line2 text,
  p_city text,
  p_state text,
  p_pincode text,
  p_notes text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.suppliers;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  BEGIN
    INSERT INTO public.suppliers (
      full_name, business_name, mobile, email, gstin, pan,
      address_line1, address_line2, city, state, pincode,
      notes, created_by
    )
    VALUES (
      btrim(p_full_name),
      nullif(btrim(p_business_name),''),
      btrim(p_mobile),
      nullif(btrim(p_email),''),
      nullif(upper(btrim(p_gstin)),''),
      nullif(upper(btrim(p_pan)),''),
      nullif(btrim(p_address_line1),''),
      nullif(btrim(p_address_line2),''),
      nullif(btrim(p_city),''),
      nullif(btrim(p_state),''),
      nullif(btrim(p_pincode),''),
      nullif(btrim(p_notes),''),
      v_caller.id
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM LIKE '%idx_suppliers_gstin_active%' THEN
      RAISE EXCEPTION 'supplier_gstin_taken';
    ELSE
      RAISE EXCEPTION 'supplier_mobile_taken';
    END IF;
  END;

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_supplier(
  p_id uuid,
  p_full_name text,
  p_business_name text,
  p_mobile text,
  p_email text,
  p_gstin text,
  p_pan text,
  p_address_line1 text,
  p_address_line2 text,
  p_city text,
  p_state text,
  p_pincode text,
  p_notes text,
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
  v_row public.suppliers;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  BEGIN
    UPDATE public.suppliers
    SET full_name = btrim(p_full_name),
        business_name = nullif(btrim(p_business_name),''),
        mobile = btrim(p_mobile),
        email = nullif(btrim(p_email),''),
        gstin = nullif(upper(btrim(p_gstin)),''),
        pan = nullif(upper(btrim(p_pan)),''),
        address_line1 = nullif(btrim(p_address_line1),''),
        address_line2 = nullif(btrim(p_address_line2),''),
        city = nullif(btrim(p_city),''),
        state = nullif(btrim(p_state),''),
        pincode = nullif(btrim(p_pincode),''),
        notes = nullif(btrim(p_notes),''),
        is_active = p_is_active
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM LIKE '%idx_suppliers_gstin_active%' THEN
      RAISE EXCEPTION 'supplier_gstin_taken';
    ELSE
      RAISE EXCEPTION 'supplier_mobile_taken';
    END IF;
  END;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_supplier(p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.suppliers;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  UPDATE public.suppliers
  SET deleted_at = now(), is_active = false
  WHERE id = p_id AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_supplier(p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.suppliers;
BEGIN
  IF v_caller.role <> 'super_admin' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  BEGIN
    UPDATE public.suppliers
    SET deleted_at = NULL, is_active = true
    WHERE id = p_id AND deleted_at IS NOT NULL
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM LIKE '%idx_suppliers_gstin_active%' THEN
      RAISE EXCEPTION 'supplier_gstin_taken';
    ELSE
      RAISE EXCEPTION 'supplier_mobile_taken';
    END IF;
  END;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

-- =========================================================================
-- Purchase items
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_purchase_item(
  p_item_code text,
  p_name text,
  p_name_gu text,
  p_uom text,
  p_hsn_code text,
  p_default_rate numeric,
  p_default_gst_pct numeric,
  p_notes text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.purchase_items;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  BEGIN
    INSERT INTO public.purchase_items (
      item_code, name, name_gu, uom, hsn_code,
      default_rate, default_gst_pct, notes, created_by
    )
    VALUES (
      upper(btrim(p_item_code)),
      btrim(p_name),
      nullif(btrim(p_name_gu),''),
      coalesce(nullif(btrim(p_uom),''),'pcs'),
      nullif(btrim(p_hsn_code),''),
      coalesce(p_default_rate, 0),
      coalesce(p_default_gst_pct, 0),
      nullif(btrim(p_notes),''),
      v_caller.id
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'item_code_taken';
  END;

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_purchase_item(
  p_id uuid,
  p_item_code text,
  p_name text,
  p_name_gu text,
  p_uom text,
  p_hsn_code text,
  p_default_rate numeric,
  p_default_gst_pct numeric,
  p_notes text,
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
  v_row public.purchase_items;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  BEGIN
    UPDATE public.purchase_items
    SET item_code = upper(btrim(p_item_code)),
        name = btrim(p_name),
        name_gu = nullif(btrim(p_name_gu),''),
        uom = coalesce(nullif(btrim(p_uom),''),'pcs'),
        hsn_code = nullif(btrim(p_hsn_code),''),
        default_rate = coalesce(p_default_rate, 0),
        default_gst_pct = coalesce(p_default_gst_pct, 0),
        notes = nullif(btrim(p_notes),''),
        is_active = p_is_active
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'item_code_taken';
  END;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_purchase_item(p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.purchase_items;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  UPDATE public.purchase_items
  SET deleted_at = now(), is_active = false
  WHERE id = p_id AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_purchase_item(p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.purchase_items;
BEGIN
  IF v_caller.role <> 'super_admin' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  BEGIN
    UPDATE public.purchase_items
    SET deleted_at = NULL, is_active = true
    WHERE id = p_id AND deleted_at IS NOT NULL
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'item_code_taken';
  END;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_supplier      (text, text, text, text, text, text, text, text, text, text, text, text, text)                                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_supplier      (uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text)                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_supplier (uuid, text)                                                                                                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_supplier     (uuid, text)                                                                                                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_purchase_item (text, text, text, text, text, numeric, numeric, text, text)                                                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_purchase_item (uuid, text, text, text, text, text, numeric, numeric, text, boolean, text)                                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_purchase_item (uuid, text)                                                                                                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_purchase_item     (uuid, text)                                                                                                     TO authenticated;
