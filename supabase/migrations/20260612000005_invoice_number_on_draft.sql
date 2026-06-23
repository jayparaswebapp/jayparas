-- Bug fix: invoice_number was being assigned only at issue_invoice() time,
-- so drafts had no number and staff couldn't see one "while making" the bill.
-- Now create_invoice_draft assigns the number on initial insert. Re-saves
-- of the same draft (update_invoice_draft) don't touch the number, and
-- issue_invoice keeps the already-assigned number instead of re-generating.

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
  v_number text;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  v_business_line := (p_header->>'business_line')::public.business_line;
  v_invoice_date := coalesce((p_header->>'invoice_date')::date, current_date);

  -- Reserve the next sequential number from the per-line counter so the
  -- draft already has its final bill number.
  v_number := public._next_invoice_number(v_business_line, v_invoice_date);

  INSERT INTO public.invoices (
    invoice_number, business_line, status, invoice_date, due_date,
    customer_id, notes, terms, place_of_supply, created_by
  )
  VALUES (
    v_number,
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

-- issue_invoice no longer re-generates the number — drafts already have one.
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

  -- Keep the draft's already-assigned number; only generate fresh if a
  -- legacy draft predates the create_invoice_draft fix and somehow has NULL.
  v_number := coalesce(v_inv.invoice_number, public._next_invoice_number(v_inv.business_line, v_inv.invoice_date));

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

  PERFORM public._recompute_invoice_totals(p_id);

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_id;
  RETURN to_jsonb(v_inv);
END;
$$;
