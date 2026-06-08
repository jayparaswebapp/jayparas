-- Purchase bills (the supplier's invoice we receive).
--
-- Mirrors the sales invoices schema but inverted: the supplier is the
-- 'from' party, our company is the 'to' party, and the number series
-- is per business_line + FY with prefix PRK (rakhi) / PKT (kite).
--
-- Reuses the existing business_line and invoice_status enums so the
-- code paths stay consistent ("issued" means "posted" here).
--
-- New error keys raised:
--   purchase_bill_not_editable   — write attempted on non-draft
--   purchase_supplier_missing    — post attempted with no supplier
--   purchase_lines_required      — post attempted with zero lines
--   purchase_company_missing     — post attempted before company info exists

CREATE TABLE IF NOT EXISTS public.purchase_bill_counters (
  business_line public.business_line NOT NULL,
  financial_year text NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (business_line, financial_year)
);

ALTER TABLE public.purchase_bill_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read purchase_bill_counters" ON public.purchase_bill_counters;
CREATE POLICY "authenticated read purchase_bill_counters" ON public.purchase_bill_counters
  FOR SELECT USING (auth.uid() IS NOT NULL);
REVOKE ALL ON public.purchase_bill_counters FROM anon;

CREATE TABLE IF NOT EXISTS public.purchase_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_number text,
  supplier_bill_number text,
  business_line public.business_line NOT NULL,
  status public.invoice_status NOT NULL DEFAULT 'draft',

  bill_date date NOT NULL DEFAULT current_date,

  supplier_id uuid REFERENCES public.suppliers(id),
  supplier_snapshot jsonb,
  buyer_snapshot jsonb,
  place_of_supply text,
  intra_state boolean,

  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount_total numeric(14,2) NOT NULL DEFAULT 0,
  taxable_total numeric(14,2) NOT NULL DEFAULT 0,
  cgst_total numeric(14,2) NOT NULL DEFAULT 0,
  sgst_total numeric(14,2) NOT NULL DEFAULT 0,
  igst_total numeric(14,2) NOT NULL DEFAULT 0,
  round_off numeric(14,2) NOT NULL DEFAULT 0,
  grand_total numeric(14,2) NOT NULL DEFAULT 0,

  notes text,

  posted_at timestamptz,
  cancelled_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES public.app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_bills_bill_number_active
  ON public.purchase_bills(bill_number)
  WHERE bill_number IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_bills_supplier
  ON public.purchase_bills(supplier_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_bills_status_date
  ON public.purchase_bills(status, bill_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_bills_business_line
  ON public.purchase_bills(business_line);

DROP TRIGGER IF EXISTS trg_purchase_bills_updated_at ON public.purchase_bills;
CREATE TRIGGER trg_purchase_bills_updated_at
  BEFORE UPDATE ON public.purchase_bills
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.purchase_bill_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES public.purchase_bills(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  item_id uuid REFERENCES public.purchase_items(id),
  item_snapshot jsonb,
  description text NOT NULL,
  hsn_code text,
  qty numeric(12,3) NOT NULL DEFAULT 1,
  uom text NOT NULL DEFAULT 'pcs',
  rate numeric(14,2) NOT NULL DEFAULT 0,
  discount_pct numeric(5,2) NOT NULL DEFAULT 0,
  gst_pct numeric(5,2) NOT NULL DEFAULT 0,
  line_subtotal numeric(14,2) NOT NULL DEFAULT 0,
  line_cgst numeric(14,2) NOT NULL DEFAULT 0,
  line_sgst numeric(14,2) NOT NULL DEFAULT 0,
  line_igst numeric(14,2) NOT NULL DEFAULT 0,
  line_total numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_bill_lines_bill ON public.purchase_bill_lines(bill_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_bill_lines_bill_lineno
  ON public.purchase_bill_lines(bill_id, line_no);

ALTER TABLE public.purchase_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_bill_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read purchase_bills" ON public.purchase_bills;
CREATE POLICY "authenticated read purchase_bills" ON public.purchase_bills
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "super_admin or supervisor write purchase_bills" ON public.purchase_bills;
CREATE POLICY "super_admin or supervisor write purchase_bills" ON public.purchase_bills
  FOR ALL USING (EXISTS (SELECT 1 FROM public.app_users a WHERE a.auth_user_id = auth.uid()
    AND a.role IN ('super_admin','supervisor') AND a.deleted_at IS NULL));

DROP POLICY IF EXISTS "authenticated read purchase_bill_lines" ON public.purchase_bill_lines;
CREATE POLICY "authenticated read purchase_bill_lines" ON public.purchase_bill_lines
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "super_admin or supervisor write purchase_bill_lines" ON public.purchase_bill_lines;
CREATE POLICY "super_admin or supervisor write purchase_bill_lines" ON public.purchase_bill_lines
  FOR ALL USING (EXISTS (SELECT 1 FROM public.app_users a WHERE a.auth_user_id = auth.uid()
    AND a.role IN ('super_admin','supervisor') AND a.deleted_at IS NULL));

REVOKE SELECT ON public.purchase_bills FROM anon;
REVOKE SELECT ON public.purchase_bill_lines FROM anon;

DROP TRIGGER IF EXISTS audit_purchase_bills ON public.purchase_bills;
CREATE TRIGGER audit_purchase_bills AFTER INSERT OR UPDATE OR DELETE ON public.purchase_bills
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
DROP TRIGGER IF EXISTS audit_purchase_bill_lines ON public.purchase_bill_lines;
CREATE TRIGGER audit_purchase_bill_lines AFTER INSERT OR UPDATE OR DELETE ON public.purchase_bill_lines
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

-- =========================================================================
-- Helpers
-- =========================================================================
CREATE OR REPLACE FUNCTION public._next_purchase_bill_number(p_business_line public.business_line, p_date date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_fy text := public._financial_year(p_date);
  v_prefix text;
  v_n int;
BEGIN
  v_prefix := CASE p_business_line WHEN 'rakhi' THEN 'PRK' WHEN 'kite' THEN 'PKT' END;

  INSERT INTO public.purchase_bill_counters (business_line, financial_year, last_number)
  VALUES (p_business_line, v_fy, 1)
  ON CONFLICT (business_line, financial_year) DO UPDATE
    SET last_number = public.purchase_bill_counters.last_number + 1
  RETURNING last_number INTO v_n;

  RETURN v_prefix || '/' || v_fy || '/' || to_char(v_n, 'FM0000');
END;
$$;

CREATE OR REPLACE FUNCTION public._replace_purchase_bill_lines(p_bill_id uuid, p_lines jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_line jsonb;
  v_idx int := 0;
  v_qty numeric;
  v_rate numeric;
  v_disc numeric;
  v_subtotal numeric;
  v_gst_pct numeric;
BEGIN
  DELETE FROM public.purchase_bill_lines WHERE bill_id = p_bill_id;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN RETURN; END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_idx := v_idx + 1;
    v_qty := coalesce((v_line->>'qty')::numeric, 0);
    v_rate := coalesce((v_line->>'rate')::numeric, 0);
    v_disc := coalesce((v_line->>'discount_pct')::numeric, 0);
    v_subtotal := round(v_qty * v_rate * (1 - v_disc / 100), 2);
    v_gst_pct := coalesce((v_line->>'gst_pct')::numeric, 0);

    INSERT INTO public.purchase_bill_lines (
      bill_id, line_no, item_id, item_snapshot, description, hsn_code,
      qty, uom, rate, discount_pct, gst_pct,
      line_subtotal, line_cgst, line_sgst, line_igst, line_total
    )
    VALUES (
      p_bill_id,
      v_idx,
      nullif(v_line->>'item_id','')::uuid,
      v_line->'item_snapshot',
      coalesce(nullif(btrim(v_line->>'description'),''),'—'),
      nullif(btrim(v_line->>'hsn_code'),''),
      v_qty,
      coalesce(nullif(btrim(v_line->>'uom'),''),'pcs'),
      v_rate,
      v_disc,
      v_gst_pct,
      v_subtotal,
      0, 0, 0,
      v_subtotal
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public._recompute_purchase_bill_totals(p_bill_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_bill public.purchase_bills;
  v_buyer_state text;
  v_intra boolean;
  v_subtotal numeric := 0;
  v_discount_total numeric := 0;
  v_cgst numeric := 0;
  v_sgst numeric := 0;
  v_igst numeric := 0;
  v_grand numeric := 0;
  v_round numeric := 0;
  v_line record;
  v_tax numeric;
  v_half numeric;
BEGIN
  SELECT * INTO v_bill FROM public.purchase_bills WHERE id = p_bill_id;
  IF v_bill.id IS NULL THEN RETURN; END IF;

  -- For purchases, intra/inter is determined by OUR state vs supplier's
  -- place-of-supply. Our state lives in buyer_snapshot once posted; before
  -- that fall back to company_info.
  IF v_bill.buyer_snapshot IS NOT NULL THEN
    v_buyer_state := v_bill.buyer_snapshot->>'state';
  ELSE
    SELECT state INTO v_buyer_state FROM public.company_info LIMIT 1;
  END IF;
  v_intra := v_bill.place_of_supply IS NOT NULL AND v_buyer_state IS NOT NULL
         AND lower(btrim(v_bill.place_of_supply)) = lower(btrim(v_buyer_state));

  FOR v_line IN
    SELECT id, qty, rate, discount_pct, gst_pct, line_subtotal
    FROM public.purchase_bill_lines WHERE bill_id = p_bill_id ORDER BY line_no
  LOOP
    v_subtotal := v_subtotal + v_line.line_subtotal;
    v_discount_total := v_discount_total + round(v_line.qty * v_line.rate * v_line.discount_pct / 100, 2);

    IF v_bill.business_line = 'kite' AND v_line.gst_pct > 0 THEN
      v_tax := round(v_line.line_subtotal * v_line.gst_pct / 100, 2);
      IF v_intra THEN
        v_half := round(v_tax / 2, 2);
        UPDATE public.purchase_bill_lines SET line_cgst = v_half, line_sgst = v_tax - v_half,
          line_igst = 0, line_total = v_line.line_subtotal + v_tax WHERE id = v_line.id;
        v_cgst := v_cgst + v_half; v_sgst := v_sgst + (v_tax - v_half);
      ELSE
        UPDATE public.purchase_bill_lines SET line_cgst = 0, line_sgst = 0,
          line_igst = v_tax, line_total = v_line.line_subtotal + v_tax WHERE id = v_line.id;
        v_igst := v_igst + v_tax;
      END IF;
    ELSE
      UPDATE public.purchase_bill_lines SET line_cgst = 0, line_sgst = 0, line_igst = 0,
        line_total = v_line.line_subtotal WHERE id = v_line.id;
    END IF;
  END LOOP;

  v_grand := v_subtotal + v_cgst + v_sgst + v_igst;
  v_round := round(v_grand) - v_grand;
  v_grand := v_grand + v_round;

  UPDATE public.purchase_bills
  SET subtotal = v_subtotal, discount_total = v_discount_total, taxable_total = v_subtotal,
      cgst_total = v_cgst, sgst_total = v_sgst, igst_total = v_igst,
      round_off = v_round, grand_total = v_grand, intra_state = v_intra
  WHERE id = p_bill_id;
END;
$$;

-- =========================================================================
-- create / update / post / cancel / delete
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_purchase_bill_draft(p_header jsonb, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.purchase_bills;
  v_business_line public.business_line;
  v_bill_date date;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  v_business_line := (p_header->>'business_line')::public.business_line;
  v_bill_date := coalesce((p_header->>'bill_date')::date, current_date);

  INSERT INTO public.purchase_bills (
    business_line, status, bill_date, supplier_id, supplier_bill_number,
    notes, place_of_supply, created_by
  ) VALUES (
    v_business_line, 'draft', v_bill_date,
    nullif(p_header->>'supplier_id','')::uuid,
    nullif(btrim(p_header->>'supplier_bill_number'),''),
    nullif(btrim(p_header->>'notes'),''),
    nullif(btrim(p_header->>'place_of_supply'),''),
    v_caller.id
  ) RETURNING * INTO v_row;

  PERFORM public._replace_purchase_bill_lines(v_row.id, p_lines);
  PERFORM public._recompute_purchase_bill_totals(v_row.id);

  RETURN to_jsonb(v_row);
END; $$;

CREATE OR REPLACE FUNCTION public.update_purchase_bill_draft(p_id uuid, p_header jsonb, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.purchase_bills;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  SELECT * INTO v_row FROM public.purchase_bills WHERE id = p_id AND deleted_at IS NULL;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_row.status <> 'draft' THEN RAISE EXCEPTION 'purchase_bill_not_editable'; END IF;

  UPDATE public.purchase_bills
  SET business_line = (p_header->>'business_line')::public.business_line,
      bill_date = coalesce((p_header->>'bill_date')::date, bill_date),
      supplier_id = nullif(p_header->>'supplier_id','')::uuid,
      supplier_bill_number = nullif(btrim(p_header->>'supplier_bill_number'),''),
      notes = nullif(btrim(p_header->>'notes'),''),
      place_of_supply = nullif(btrim(p_header->>'place_of_supply'),'')
  WHERE id = p_id;

  PERFORM public._replace_purchase_bill_lines(p_id, p_lines);
  PERFORM public._recompute_purchase_bill_totals(p_id);

  SELECT * INTO v_row FROM public.purchase_bills WHERE id = p_id;
  RETURN to_jsonb(v_row);
END; $$;

CREATE OR REPLACE FUNCTION public.post_purchase_bill(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_bill public.purchase_bills;
  v_buyer public.company_info;
  v_supplier public.suppliers;
  v_line_count int;
  v_number text;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  SELECT * INTO v_bill FROM public.purchase_bills WHERE id = p_id AND deleted_at IS NULL;
  IF v_bill.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_bill.status <> 'draft' THEN RAISE EXCEPTION 'purchase_bill_not_editable'; END IF;
  IF v_bill.supplier_id IS NULL THEN RAISE EXCEPTION 'purchase_supplier_missing'; END IF;

  SELECT count(*) INTO v_line_count FROM public.purchase_bill_lines WHERE bill_id = p_id;
  IF v_line_count = 0 THEN RAISE EXCEPTION 'purchase_lines_required'; END IF;

  SELECT * INTO v_buyer FROM public.company_info LIMIT 1;
  IF v_buyer.id IS NULL THEN RAISE EXCEPTION 'purchase_company_missing'; END IF;

  SELECT * INTO v_supplier FROM public.suppliers WHERE id = v_bill.supplier_id;
  IF v_supplier.id IS NULL THEN RAISE EXCEPTION 'purchase_supplier_missing'; END IF;

  v_number := public._next_purchase_bill_number(v_bill.business_line, v_bill.bill_date);

  UPDATE public.purchase_bills
  SET supplier_snapshot = jsonb_build_object(
        'full_name', v_supplier.full_name,
        'business_name', v_supplier.business_name,
        'mobile', v_supplier.mobile,
        'email', v_supplier.email,
        'gstin', v_supplier.gstin,
        'pan', v_supplier.pan,
        'address_line1', v_supplier.address_line1,
        'address_line2', v_supplier.address_line2,
        'city', v_supplier.city,
        'state', v_supplier.state,
        'pincode', v_supplier.pincode
      ),
      buyer_snapshot = jsonb_build_object(
        'legal_name', v_buyer.legal_name,
        'address_line1', v_buyer.address_line1,
        'address_line2', v_buyer.address_line2,
        'city', v_buyer.city,
        'state', v_buyer.state,
        'pincode', v_buyer.pincode,
        'gstin', v_buyer.gstin,
        'pan', v_buyer.pan,
        'mobile', v_buyer.mobile,
        'email', v_buyer.email
      ),
      place_of_supply = coalesce(v_bill.place_of_supply, v_supplier.state),
      bill_number = v_number,
      status = 'issued',
      posted_at = now()
  WHERE id = p_id;

  PERFORM public._recompute_purchase_bill_totals(p_id);

  SELECT * INTO v_bill FROM public.purchase_bills WHERE id = p_id;
  RETURN to_jsonb(v_bill);
END; $$;

CREATE OR REPLACE FUNCTION public.cancel_purchase_bill(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_caller public.app_users := public._current_app_user(); v_bill public.purchase_bills;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');
  SELECT * INTO v_bill FROM public.purchase_bills WHERE id = p_id AND deleted_at IS NULL;
  IF v_bill.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_bill.status <> 'issued' THEN RAISE EXCEPTION 'purchase_bill_not_editable'; END IF;
  UPDATE public.purchase_bills SET status = 'cancelled', cancelled_at = now()
    WHERE id = p_id RETURNING * INTO v_bill;
  RETURN to_jsonb(v_bill);
END; $$;

CREATE OR REPLACE FUNCTION public.delete_purchase_bill_draft(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_caller public.app_users := public._current_app_user(); v_bill public.purchase_bills;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');
  SELECT * INTO v_bill FROM public.purchase_bills WHERE id = p_id;
  IF v_bill.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_bill.status <> 'draft' THEN RAISE EXCEPTION 'purchase_bill_not_editable'; END IF;
  DELETE FROM public.purchase_bills WHERE id = p_id;
  RETURN to_jsonb(v_bill);
END; $$;

GRANT EXECUTE ON FUNCTION public.create_purchase_bill_draft(jsonb, jsonb)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_purchase_bill_draft(uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_purchase_bill(uuid)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_bill(uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_purchase_bill_draft(uuid)               TO authenticated;
