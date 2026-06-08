-- Invoice RPCs.
--
--   p_header  jsonb  { customer_id, business_line, invoice_date, due_date, notes, terms, place_of_supply }
--   p_lines   jsonb  [ { sku_id, description, hsn_code, qty, uom, rate, discount_pct, gst_pct }, ... ]
--
-- Drafts are freely editable. Issuing snapshots the customer + seller, computes
-- totals, allocates the next number for (business_line, financial_year), and
-- locks the row to status='issued'. Cancel preserves the number. Drafts can
-- be hard-deleted; issued/cancelled rows are soft-deleted only by super_admin.
--
-- New error keys:
--   invoice_not_editable      — write attempted on non-draft
--   company_info_missing      — issue attempted before seller is configured
--   invoice_lines_required    — issue attempted with zero lines
--   invoice_customer_missing  — issue attempted with no customer

-- =========================================================================
-- Helpers
-- =========================================================================
CREATE OR REPLACE FUNCTION public._financial_year(p_date date)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_y int := extract(year FROM p_date)::int;
  v_m int := extract(month FROM p_date)::int;
  v_start int;
BEGIN
  -- India FY runs April → March.
  IF v_m >= 4 THEN
    v_start := v_y;
  ELSE
    v_start := v_y - 1;
  END IF;
  RETURN to_char(v_start, 'FM0000') || '-' || to_char((v_start + 1) % 100, 'FM00');
END;
$$;

CREATE OR REPLACE FUNCTION public._next_invoice_number(p_business_line public.business_line, p_date date)
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
  v_prefix := CASE p_business_line WHEN 'rakhi' THEN 'RKH' WHEN 'kite' THEN 'KIT' END;

  INSERT INTO public.invoice_number_counters (business_line, financial_year, last_number)
  VALUES (p_business_line, v_fy, 1)
  ON CONFLICT (business_line, financial_year) DO UPDATE
    SET last_number = public.invoice_number_counters.last_number + 1
  RETURNING last_number INTO v_n;

  RETURN v_prefix || '/' || v_fy || '/' || to_char(v_n, 'FM0000');
END;
$$;

CREATE OR REPLACE FUNCTION public._replace_invoice_lines(p_invoice_id uuid, p_lines jsonb)
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
  DELETE FROM public.invoice_lines WHERE invoice_id = p_invoice_id;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RETURN;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_idx := v_idx + 1;
    v_qty := coalesce((v_line->>'qty')::numeric, 0);
    v_rate := coalesce((v_line->>'rate')::numeric, 0);
    v_disc := coalesce((v_line->>'discount_pct')::numeric, 0);
    v_subtotal := round(v_qty * v_rate * (1 - v_disc / 100), 2);
    v_gst_pct := coalesce((v_line->>'gst_pct')::numeric, 0);

    INSERT INTO public.invoice_lines (
      invoice_id, line_no, sku_id, sku_snapshot, description, hsn_code,
      qty, uom, rate, discount_pct, gst_pct,
      line_subtotal, line_cgst, line_sgst, line_igst, line_total
    )
    VALUES (
      p_invoice_id,
      v_idx,
      nullif(v_line->>'sku_id', '')::uuid,
      v_line->'sku_snapshot',
      coalesce(nullif(btrim(v_line->>'description'), ''), '—'),
      nullif(btrim(v_line->>'hsn_code'), ''),
      v_qty,
      coalesce(nullif(btrim(v_line->>'uom'), ''), 'Pack'),
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

-- =========================================================================
-- create_invoice_draft
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_invoice_draft(p_header jsonb, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.invoices;
  v_business_line public.business_line;
  v_invoice_date date;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  v_business_line := (p_header->>'business_line')::public.business_line;
  v_invoice_date := coalesce((p_header->>'invoice_date')::date, current_date);

  INSERT INTO public.invoices (
    business_line, status, invoice_date, due_date,
    customer_id, notes, terms, place_of_supply, created_by
  )
  VALUES (
    v_business_line,
    'draft',
    v_invoice_date,
    nullif(p_header->>'due_date', '')::date,
    nullif(p_header->>'customer_id', '')::uuid,
    nullif(btrim(p_header->>'notes'), ''),
    nullif(btrim(p_header->>'terms'), ''),
    nullif(btrim(p_header->>'place_of_supply'), ''),
    v_caller.id
  )
  RETURNING * INTO v_row;

  PERFORM public._replace_invoice_lines(v_row.id, p_lines);
  PERFORM public._recompute_invoice_totals(v_row.id);

  RETURN to_jsonb(v_row);
END;
$$;

-- =========================================================================
-- update_invoice_draft — only for drafts.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.update_invoice_draft(p_id uuid, p_header jsonb, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.invoices;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  SELECT * INTO v_row FROM public.invoices WHERE id = p_id AND deleted_at IS NULL;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_row.status <> 'draft' THEN RAISE EXCEPTION 'invoice_not_editable'; END IF;

  UPDATE public.invoices
  SET business_line = (p_header->>'business_line')::public.business_line,
      invoice_date = coalesce((p_header->>'invoice_date')::date, invoice_date),
      due_date = nullif(p_header->>'due_date', '')::date,
      customer_id = nullif(p_header->>'customer_id', '')::uuid,
      notes = nullif(btrim(p_header->>'notes'), ''),
      terms = nullif(btrim(p_header->>'terms'), ''),
      place_of_supply = nullif(btrim(p_header->>'place_of_supply'), '')
  WHERE id = p_id;

  PERFORM public._replace_invoice_lines(p_id, p_lines);
  PERFORM public._recompute_invoice_totals(p_id);

  SELECT * INTO v_row FROM public.invoices WHERE id = p_id;
  RETURN to_jsonb(v_row);
END;
$$;

-- =========================================================================
-- _recompute_invoice_totals
--   Walks invoice_lines, applies CGST/SGST split for intra-state or IGST
--   for inter-state, rolls up totals to the header row.
-- =========================================================================
CREATE OR REPLACE FUNCTION public._recompute_invoice_totals(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_inv public.invoices;
  v_seller_state text;
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
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id;
  IF v_inv.id IS NULL THEN RETURN; END IF;

  -- Determine intra-vs-inter using seller state from a snapshot if available,
  -- else fall back to current company_info.
  IF v_inv.seller_snapshot IS NOT NULL THEN
    v_seller_state := v_inv.seller_snapshot->>'state';
  ELSE
    SELECT state INTO v_seller_state FROM public.company_info LIMIT 1;
  END IF;
  v_intra := v_inv.place_of_supply IS NOT NULL
         AND v_seller_state IS NOT NULL
         AND lower(btrim(v_inv.place_of_supply)) = lower(btrim(v_seller_state));

  FOR v_line IN
    SELECT id, qty, rate, discount_pct, gst_pct, line_subtotal
    FROM public.invoice_lines
    WHERE invoice_id = p_invoice_id
    ORDER BY line_no
  LOOP
    v_subtotal := v_subtotal + v_line.line_subtotal;
    v_discount_total := v_discount_total + round(v_line.qty * v_line.rate * v_line.discount_pct / 100, 2);

    IF v_inv.business_line = 'kite' AND v_line.gst_pct > 0 THEN
      v_tax := round(v_line.line_subtotal * v_line.gst_pct / 100, 2);
      IF v_intra THEN
        v_half := round(v_tax / 2, 2);
        UPDATE public.invoice_lines
          SET line_cgst = v_half,
              line_sgst = v_tax - v_half,
              line_igst = 0,
              line_total = v_line.line_subtotal + v_tax
          WHERE id = v_line.id;
        v_cgst := v_cgst + v_half;
        v_sgst := v_sgst + (v_tax - v_half);
      ELSE
        UPDATE public.invoice_lines
          SET line_cgst = 0,
              line_sgst = 0,
              line_igst = v_tax,
              line_total = v_line.line_subtotal + v_tax
          WHERE id = v_line.id;
        v_igst := v_igst + v_tax;
      END IF;
    ELSE
      UPDATE public.invoice_lines
        SET line_cgst = 0, line_sgst = 0, line_igst = 0,
            line_total = v_line.line_subtotal
        WHERE id = v_line.id;
    END IF;
  END LOOP;

  v_grand := v_subtotal + v_cgst + v_sgst + v_igst;
  v_round := round(v_grand) - v_grand;
  v_grand := v_grand + v_round;

  UPDATE public.invoices
  SET subtotal = v_subtotal,
      discount_total = v_discount_total,
      taxable_total = v_subtotal,
      cgst_total = v_cgst,
      sgst_total = v_sgst,
      igst_total = v_igst,
      round_off = v_round,
      grand_total = v_grand,
      intra_state = v_intra
  WHERE id = p_invoice_id;
END;
$$;

-- =========================================================================
-- issue_invoice — snapshots seller + customer, computes totals, assigns number.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.issue_invoice(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_inv public.invoices;
  v_seller public.company_info;
  v_customer public.billing_customers;
  v_line_count int;
  v_number text;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_id AND deleted_at IS NULL;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_inv.status <> 'draft' THEN RAISE EXCEPTION 'invoice_not_editable'; END IF;
  IF v_inv.customer_id IS NULL THEN RAISE EXCEPTION 'invoice_customer_missing'; END IF;

  SELECT count(*) INTO v_line_count FROM public.invoice_lines WHERE invoice_id = p_id;
  IF v_line_count = 0 THEN RAISE EXCEPTION 'invoice_lines_required'; END IF;

  SELECT * INTO v_seller FROM public.company_info LIMIT 1;
  IF v_seller.id IS NULL THEN RAISE EXCEPTION 'company_info_missing'; END IF;

  SELECT * INTO v_customer FROM public.billing_customers WHERE id = v_inv.customer_id;
  IF v_customer.id IS NULL THEN RAISE EXCEPTION 'invoice_customer_missing'; END IF;

  v_number := public._next_invoice_number(v_inv.business_line, v_inv.invoice_date);

  UPDATE public.invoices
  SET seller_snapshot = jsonb_build_object(
        'legal_name', v_seller.legal_name,
        'address_line1', v_seller.address_line1,
        'address_line2', v_seller.address_line2,
        'city', v_seller.city,
        'state', v_seller.state,
        'pincode', v_seller.pincode,
        'gstin', v_seller.gstin,
        'pan', v_seller.pan,
        'mobile', v_seller.mobile,
        'email', v_seller.email,
        'bank_name', v_seller.bank_name,
        'bank_account_no', v_seller.bank_account_no,
        'bank_ifsc', v_seller.bank_ifsc
      ),
      customer_snapshot = jsonb_build_object(
        'full_name', v_customer.full_name,
        'business_name', v_customer.business_name,
        'mobile', v_customer.mobile,
        'email', v_customer.email,
        'gstin', v_customer.gstin,
        'pan', v_customer.pan,
        'address_line1', v_customer.address_line1,
        'address_line2', v_customer.address_line2,
        'city', v_customer.city,
        'state', v_customer.state,
        'pincode', v_customer.pincode
      ),
      place_of_supply = coalesce(v_inv.place_of_supply, v_customer.state),
      invoice_number = v_number,
      status = 'issued',
      issued_at = now()
  WHERE id = p_id;

  -- Recompute totals now that the seller snapshot exists (intra-state check uses it).
  PERFORM public._recompute_invoice_totals(p_id);

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_id;
  RETURN to_jsonb(v_inv);
END;
$$;

-- =========================================================================
-- cancel_invoice — only on issued. Keeps the invoice_number for audit.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.cancel_invoice(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_inv public.invoices;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_id AND deleted_at IS NULL;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_inv.status <> 'issued' THEN RAISE EXCEPTION 'invoice_not_editable'; END IF;

  UPDATE public.invoices
  SET status = 'cancelled', cancelled_at = now()
  WHERE id = p_id
  RETURNING * INTO v_inv;

  RETURN to_jsonb(v_inv);
END;
$$;

-- =========================================================================
-- delete_invoice_draft — hard delete; drafts only.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.delete_invoice_draft(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_inv public.invoices;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_id;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_inv.status <> 'draft' THEN RAISE EXCEPTION 'invoice_not_editable'; END IF;

  DELETE FROM public.invoices WHERE id = p_id;
  RETURN to_jsonb(v_inv);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_invoice_draft(jsonb, jsonb)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_invoice_draft(uuid, jsonb, jsonb)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_invoice(uuid)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_invoice(uuid)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_invoice_draft(uuid)                 TO authenticated;
