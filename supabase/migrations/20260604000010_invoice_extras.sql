-- Add per-invoice packing & delivery charges. These sit AFTER the tax block
-- and BEFORE the round-off, so the grand total includes them but they don't
-- attract GST themselves (intentional — if the seller needs GST on packing,
-- they can still add a regular taxable line).
--
-- Both columns default to 0 so existing rows keep their grand totals.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS packing_charges  numeric(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_charges numeric(14, 2) NOT NULL DEFAULT 0;

-- Replace the totals helper to include the new charges.
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
  v_extras numeric := 0;
  v_grand numeric := 0;
  v_round numeric := 0;
  v_line record;
  v_tax numeric;
  v_half numeric;
BEGIN
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id;
  IF v_inv.id IS NULL THEN RETURN; END IF;

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

  v_extras := coalesce(v_inv.packing_charges, 0) + coalesce(v_inv.delivery_charges, 0);
  v_grand := v_subtotal + v_cgst + v_sgst + v_igst + v_extras;
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

-- Recreate create_invoice_draft / update_invoice_draft to read packing &
-- delivery charges out of the header jsonb.
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
    customer_id, notes, terms, place_of_supply,
    packing_charges, delivery_charges, created_by
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
    coalesce((p_header->>'packing_charges')::numeric, 0),
    coalesce((p_header->>'delivery_charges')::numeric, 0),
    v_caller.id
  )
  RETURNING * INTO v_row;

  PERFORM public._replace_invoice_lines(v_row.id, p_lines);
  PERFORM public._recompute_invoice_totals(v_row.id);

  RETURN to_jsonb(v_row);
END;
$$;

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
      place_of_supply = nullif(btrim(p_header->>'place_of_supply'), ''),
      packing_charges = coalesce((p_header->>'packing_charges')::numeric, 0),
      delivery_charges = coalesce((p_header->>'delivery_charges')::numeric, 0)
  WHERE id = p_id;

  PERFORM public._replace_invoice_lines(p_id, p_lines);
  PERFORM public._recompute_invoice_totals(p_id);

  SELECT * INTO v_row FROM public.invoices WHERE id = p_id;
  RETURN to_jsonb(v_row);
END;
$$;
