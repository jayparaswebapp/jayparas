-- Sales Returns / Credit Notes — goods coming back from customers against a
-- specific original invoice. The data model:
--   sales_returns        one credit-note header per return event
--   sales_return_lines   the SKU lines / qty being returned
--   credit_note_number_counters  per-(business_line, FY) numbering
--
-- A return is always linked 1:1 to an original invoice (Indian GST credit
-- notes must reference the source invoice). The line items must be a subset
-- of that invoice's lines (same SKU snapshot, same rate, same GST %); only
-- the returned qty and any per-line override are captured here.
--
-- The invoice_balances view is updated so the credit-note grand total is
-- subtracted from grand_total in addition to the payments already applied —
-- so the customer's outstanding drops automatically when a return is issued.
--
-- Status flow mirrors invoices: draft → issued → cancelled. Drafts can be
-- hard-deleted by writers; issued/cancelled rows preserve the number.

-- ── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sales_return_status') THEN
    CREATE TYPE public.sales_return_status AS ENUM ('draft', 'issued', 'cancelled');
  END IF;
END $$;

-- ── Counter table (per business line + FY) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_note_number_counters (
  business_line public.business_line NOT NULL,
  financial_year text NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (business_line, financial_year)
);

ALTER TABLE public.credit_note_number_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read credit_note_number_counters"
  ON public.credit_note_number_counters;
CREATE POLICY "authenticated read credit_note_number_counters"
  ON public.credit_note_number_counters
  FOR SELECT USING (auth.uid() IS NOT NULL);
REVOKE ALL ON public.credit_note_number_counters FROM anon;

-- ── sales_returns header ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sales_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_number text,
  business_line public.business_line NOT NULL,
  status public.sales_return_status NOT NULL DEFAULT 'draft',

  return_date date NOT NULL DEFAULT current_date,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  customer_id uuid REFERENCES public.billing_customers(id),

  -- Snapshots frozen on issue, same shape as invoices.
  customer_snapshot jsonb,
  seller_snapshot jsonb,
  place_of_supply text,
  intra_state boolean,

  -- Totals roll up from sales_return_lines on every save (mirrors invoice math).
  subtotal numeric(14, 2) NOT NULL DEFAULT 0,
  discount_total numeric(14, 2) NOT NULL DEFAULT 0,
  taxable_total numeric(14, 2) NOT NULL DEFAULT 0,
  cgst_total numeric(14, 2) NOT NULL DEFAULT 0,
  sgst_total numeric(14, 2) NOT NULL DEFAULT 0,
  igst_total numeric(14, 2) NOT NULL DEFAULT 0,
  round_off numeric(14, 2) NOT NULL DEFAULT 0,
  grand_total numeric(14, 2) NOT NULL DEFAULT 0,

  reason text,
  notes text,

  issued_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.app_users(id),
  cancellation_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES public.app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_returns_number_active
  ON public.sales_returns(credit_note_number)
  WHERE credit_note_number IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_returns_invoice ON public.sales_returns(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_customer ON public.sales_returns(customer_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_returns_status_date
  ON public.sales_returns(status, return_date DESC);

DROP TRIGGER IF EXISTS trg_sales_returns_updated_at ON public.sales_returns;
CREATE TRIGGER trg_sales_returns_updated_at
  BEFORE UPDATE ON public.sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── sales_return_lines ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sales_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_return_id uuid NOT NULL REFERENCES public.sales_returns(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  invoice_line_id uuid REFERENCES public.invoice_lines(id),
  sku_id uuid REFERENCES public.skus(id),
  sku_snapshot jsonb,
  description text NOT NULL,
  hsn_code text,
  qty numeric(12, 3) NOT NULL DEFAULT 1,
  uom text NOT NULL DEFAULT 'Pack',
  rate numeric(14, 2) NOT NULL DEFAULT 0,
  discount_pct numeric(5, 2) NOT NULL DEFAULT 0,
  gst_pct numeric(5, 2) NOT NULL DEFAULT 0,
  line_subtotal numeric(14, 2) NOT NULL DEFAULT 0,
  line_cgst numeric(14, 2) NOT NULL DEFAULT 0,
  line_sgst numeric(14, 2) NOT NULL DEFAULT 0,
  line_igst numeric(14, 2) NOT NULL DEFAULT 0,
  line_total numeric(14, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_return_lines_return
  ON public.sales_return_lines(sales_return_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_return_lines_return_lineno
  ON public.sales_return_lines(sales_return_id, line_no);

ALTER TABLE public.sales_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_return_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read sales_returns" ON public.sales_returns;
CREATE POLICY "authenticated read sales_returns" ON public.sales_returns
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "super_admin or supervisor write sales_returns" ON public.sales_returns;
CREATE POLICY "super_admin or supervisor write sales_returns" ON public.sales_returns
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "authenticated read sales_return_lines" ON public.sales_return_lines;
CREATE POLICY "authenticated read sales_return_lines" ON public.sales_return_lines
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "super_admin or supervisor write sales_return_lines"
  ON public.sales_return_lines;
CREATE POLICY "super_admin or supervisor write sales_return_lines"
  ON public.sales_return_lines
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );

REVOKE SELECT ON public.sales_returns FROM anon;
REVOKE SELECT ON public.sales_return_lines FROM anon;

DROP TRIGGER IF EXISTS audit_sales_returns ON public.sales_returns;
CREATE TRIGGER audit_sales_returns
  AFTER INSERT OR UPDATE OR DELETE ON public.sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

DROP TRIGGER IF EXISTS audit_sales_return_lines ON public.sales_return_lines;
CREATE TRIGGER audit_sales_return_lines
  AFTER INSERT OR UPDATE OR DELETE ON public.sales_return_lines
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

-- ── Helpers ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._next_credit_note_number(
  p_business_line public.business_line, p_date date
)
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
  -- Per Indian GST convention we prefix with CN/ and tag the business line
  -- so rakhi & kite credit-note series are independent (same as invoices).
  v_prefix := 'CN-' || CASE p_business_line WHEN 'rakhi' THEN 'RKH' WHEN 'kite' THEN 'KIT' END;

  INSERT INTO public.credit_note_number_counters (business_line, financial_year, last_number)
  VALUES (p_business_line, v_fy, 1)
  ON CONFLICT (business_line, financial_year) DO UPDATE
    SET last_number = public.credit_note_number_counters.last_number + 1
  RETURNING last_number INTO v_n;

  RETURN v_prefix || '/' || v_fy || '/' || to_char(v_n, 'FM0000');
END;
$$;

CREATE OR REPLACE FUNCTION public._replace_sales_return_lines(
  p_return_id uuid, p_lines jsonb
)
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
  v_gst_pct numeric;
  v_subtotal numeric;
BEGIN
  DELETE FROM public.sales_return_lines WHERE sales_return_id = p_return_id;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN RETURN; END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_idx := v_idx + 1;
    v_qty := coalesce((v_line->>'qty')::numeric, 0);
    v_rate := coalesce((v_line->>'rate')::numeric, 0);
    v_disc := coalesce((v_line->>'discount_pct')::numeric, 0);
    v_gst_pct := coalesce((v_line->>'gst_pct')::numeric, 0);
    v_subtotal := round(v_qty * v_rate * (1 - v_disc / 100), 2);

    INSERT INTO public.sales_return_lines (
      sales_return_id, line_no, invoice_line_id, sku_id, sku_snapshot,
      description, hsn_code, qty, uom, rate, discount_pct, gst_pct,
      line_subtotal, line_cgst, line_sgst, line_igst, line_total
    )
    VALUES (
      p_return_id,
      v_idx,
      nullif(v_line->>'invoice_line_id', '')::uuid,
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

CREATE OR REPLACE FUNCTION public._recompute_sales_return_totals(p_return_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_ret public.sales_returns;
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
  SELECT * INTO v_ret FROM public.sales_returns WHERE id = p_return_id;
  IF v_ret.id IS NULL THEN RETURN; END IF;

  IF v_ret.seller_snapshot IS NOT NULL THEN
    v_seller_state := v_ret.seller_snapshot->>'state';
  ELSE
    SELECT state INTO v_seller_state FROM public.company_info LIMIT 1;
  END IF;
  v_intra := v_ret.place_of_supply IS NOT NULL
         AND v_seller_state IS NOT NULL
         AND lower(btrim(v_ret.place_of_supply)) = lower(btrim(v_seller_state));

  FOR v_line IN
    SELECT id, qty, rate, discount_pct, gst_pct, line_subtotal
    FROM public.sales_return_lines
    WHERE sales_return_id = p_return_id
    ORDER BY line_no
  LOOP
    v_subtotal := v_subtotal + v_line.line_subtotal;
    v_discount_total := v_discount_total + round(v_line.qty * v_line.rate * v_line.discount_pct / 100, 2);

    IF v_ret.business_line = 'kite' AND v_line.gst_pct > 0 THEN
      v_tax := round(v_line.line_subtotal * v_line.gst_pct / 100, 2);
      IF v_intra THEN
        v_half := round(v_tax / 2, 2);
        UPDATE public.sales_return_lines
          SET line_cgst = v_half,
              line_sgst = v_tax - v_half,
              line_igst = 0,
              line_total = v_line.line_subtotal + v_tax
          WHERE id = v_line.id;
        v_cgst := v_cgst + v_half;
        v_sgst := v_sgst + (v_tax - v_half);
      ELSE
        UPDATE public.sales_return_lines
          SET line_cgst = 0,
              line_sgst = 0,
              line_igst = v_tax,
              line_total = v_line.line_subtotal + v_tax
          WHERE id = v_line.id;
        v_igst := v_igst + v_tax;
      END IF;
    ELSE
      UPDATE public.sales_return_lines
        SET line_cgst = 0, line_sgst = 0, line_igst = 0,
            line_total = v_line.line_subtotal
        WHERE id = v_line.id;
    END IF;
  END LOOP;

  v_grand := v_subtotal + v_cgst + v_sgst + v_igst;
  v_round := round(v_grand) - v_grand;
  v_grand := v_grand + v_round;

  UPDATE public.sales_returns
  SET subtotal = v_subtotal,
      discount_total = v_discount_total,
      taxable_total = v_subtotal,
      cgst_total = v_cgst,
      sgst_total = v_sgst,
      igst_total = v_igst,
      round_off = v_round,
      grand_total = v_grand,
      intra_state = v_intra
  WHERE id = p_return_id;
END;
$$;

-- ── create_sales_return_draft ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_sales_return_draft(p_header jsonb, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.sales_returns;
  v_invoice public.invoices;
  v_invoice_id uuid;
  v_return_date date;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  v_invoice_id := nullif(p_header->>'invoice_id', '')::uuid;
  v_return_date := coalesce((p_header->>'return_date')::date, current_date);
  IF v_invoice_id IS NULL THEN RAISE EXCEPTION 'sales_return_invoice_missing'; END IF;

  SELECT * INTO v_invoice FROM public.invoices
   WHERE id = v_invoice_id AND deleted_at IS NULL;
  IF v_invoice.id IS NULL THEN RAISE EXCEPTION 'sales_return_invoice_missing'; END IF;
  IF v_invoice.status <> 'issued' THEN RAISE EXCEPTION 'sales_return_invoice_not_issued'; END IF;

  INSERT INTO public.sales_returns (
    business_line, status, return_date, invoice_id, customer_id,
    reason, notes, place_of_supply, created_by
  )
  VALUES (
    v_invoice.business_line,
    'draft',
    v_return_date,
    v_invoice.id,
    v_invoice.customer_id,
    nullif(btrim(p_header->>'reason'), ''),
    nullif(btrim(p_header->>'notes'), ''),
    v_invoice.place_of_supply,
    v_caller.id
  )
  RETURNING * INTO v_row;

  PERFORM public._replace_sales_return_lines(v_row.id, p_lines);
  PERFORM public._recompute_sales_return_totals(v_row.id);

  SELECT * INTO v_row FROM public.sales_returns WHERE id = v_row.id;
  RETURN to_jsonb(v_row);
END;
$$;

-- ── update_sales_return_draft ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_sales_return_draft(p_id uuid, p_header jsonb, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.sales_returns;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  SELECT * INTO v_row FROM public.sales_returns WHERE id = p_id AND deleted_at IS NULL;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_row.status <> 'draft' THEN RAISE EXCEPTION 'sales_return_not_editable'; END IF;

  UPDATE public.sales_returns
  SET return_date = coalesce((p_header->>'return_date')::date, return_date),
      reason = nullif(btrim(p_header->>'reason'), ''),
      notes = nullif(btrim(p_header->>'notes'), '')
  WHERE id = p_id;

  PERFORM public._replace_sales_return_lines(p_id, p_lines);
  PERFORM public._recompute_sales_return_totals(p_id);

  SELECT * INTO v_row FROM public.sales_returns WHERE id = p_id;
  RETURN to_jsonb(v_row);
END;
$$;

-- ── delete_sales_return_draft (drafts only) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_sales_return_draft(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.sales_returns;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  SELECT * INTO v_row FROM public.sales_returns WHERE id = p_id AND deleted_at IS NULL;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_row.status <> 'draft' THEN RAISE EXCEPTION 'sales_return_not_editable'; END IF;

  DELETE FROM public.sales_returns WHERE id = p_id;
END;
$$;

-- ── issue_sales_return ───────────────────────────────────────────────────────
-- Snapshots the customer + seller, computes totals, allocates a number, and
-- moves the row to status='issued'. The new credit-note total starts reducing
-- the linked invoice's balance immediately via the invoice_balances view.
CREATE OR REPLACE FUNCTION public.issue_sales_return(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_ret public.sales_returns;
  v_invoice public.invoices;
  v_seller public.company_info;
  v_customer public.billing_customers;
  v_line_count int;
  v_number text;
  v_lines_total numeric;
  v_paid_or_credited numeric;
  v_remaining_balance numeric;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  SELECT * INTO v_ret FROM public.sales_returns WHERE id = p_id AND deleted_at IS NULL;
  IF v_ret.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_ret.status <> 'draft' THEN RAISE EXCEPTION 'sales_return_not_editable'; END IF;

  SELECT count(*) INTO v_line_count FROM public.sales_return_lines WHERE sales_return_id = p_id;
  IF v_line_count = 0 THEN RAISE EXCEPTION 'sales_return_lines_required'; END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = v_ret.invoice_id;
  IF v_invoice.id IS NULL OR v_invoice.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'sales_return_invoice_missing';
  END IF;
  IF v_invoice.status <> 'issued' THEN RAISE EXCEPTION 'sales_return_invoice_not_issued'; END IF;

  SELECT * INTO v_seller FROM public.company_info LIMIT 1;
  IF v_seller.id IS NULL THEN RAISE EXCEPTION 'company_info_missing'; END IF;

  SELECT * INTO v_customer FROM public.billing_customers WHERE id = v_invoice.customer_id;
  IF v_customer.id IS NULL THEN RAISE EXCEPTION 'sales_return_customer_missing'; END IF;

  -- Total of THIS draft's lines. Compare against the invoice's remaining
  -- (un-paid + un-credited) so a return can't exceed what's still owed.
  PERFORM public._recompute_sales_return_totals(p_id);
  SELECT grand_total INTO v_lines_total FROM public.sales_returns WHERE id = p_id;

  SELECT coalesce(sum(a.amount_applied), 0) INTO v_paid_or_credited
  FROM public.payment_allocations a
  JOIN public.payments p ON p.id = a.payment_id
  WHERE a.invoice_id = v_invoice.id AND p.status = 'received' AND p.deleted_at IS NULL;

  -- Also subtract any OTHER issued credit notes already against this invoice.
  v_paid_or_credited := v_paid_or_credited + coalesce((
    SELECT sum(sr.grand_total) FROM public.sales_returns sr
    WHERE sr.invoice_id = v_invoice.id
      AND sr.status = 'issued'
      AND sr.deleted_at IS NULL
      AND sr.id <> p_id
  ), 0);

  v_remaining_balance := v_invoice.grand_total - v_paid_or_credited;
  IF v_lines_total > v_remaining_balance + 0.005 THEN
    RAISE EXCEPTION 'sales_return_exceeds_invoice';
  END IF;

  v_number := public._next_credit_note_number(v_ret.business_line, v_ret.return_date);

  UPDATE public.sales_returns
  SET credit_note_number = v_number,
      status = 'issued',
      issued_at = now(),
      customer_id = v_invoice.customer_id,
      place_of_supply = coalesce(v_ret.place_of_supply, v_invoice.place_of_supply, v_customer.state),
      seller_snapshot = jsonb_build_object(
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
      )
  WHERE id = p_id;

  -- Recompute once more now that the snapshot/place_of_supply may have set
  -- intra_state, in case it flipped (it almost never does at this point but
  -- the recompute is cheap and keeps line_cgst/sgst/igst aligned with the
  -- header before we lock the row).
  PERFORM public._recompute_sales_return_totals(p_id);

  SELECT * INTO v_ret FROM public.sales_returns WHERE id = p_id;
  RETURN to_jsonb(v_ret);
END;
$$;

-- ── cancel_sales_return ──────────────────────────────────────────────────────
-- Soft-cancel: keeps the credit-note number for audit (gap-free series) but
-- the invoice_balances view filters status='issued' so a cancelled return
-- stops reducing the invoice balance.
CREATE OR REPLACE FUNCTION public.cancel_sales_return(p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.sales_returns;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  SELECT * INTO v_row FROM public.sales_returns WHERE id = p_id AND deleted_at IS NULL;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_row.status = 'cancelled' THEN RAISE EXCEPTION 'sales_return_already_cancelled'; END IF;
  IF v_row.status <> 'issued' THEN RAISE EXCEPTION 'sales_return_not_cancellable'; END IF;

  UPDATE public.sales_returns
  SET status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = v_caller.id,
      cancellation_reason = nullif(btrim(p_reason), '')
  WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

-- ── Update invoice_balances view to subtract issued credit notes ─────────────
-- balance_due = grand_total
--             − sum(applied payment allocations on received payments)
--             − sum(grand_total of issued, non-deleted credit notes)
--
-- We DROP first because CREATE OR REPLACE VIEW won't allow inserting a new
-- column (amount_credited) before an existing one (balance_due) — Postgres
-- only permits appending. Dropping is safe: nothing here depends on the
-- view's row type.
DROP VIEW IF EXISTS public.invoice_balances;
CREATE VIEW public.invoice_balances AS
  SELECT
    i.id AS invoice_id,
    i.invoice_number,
    i.customer_id,
    i.invoice_date,
    i.business_line,
    i.status,
    i.grand_total,
    coalesce((
      SELECT sum(a.amount_applied)
      FROM public.payment_allocations a
      JOIN public.payments p ON p.id = a.payment_id
      WHERE a.invoice_id = i.id
        AND p.status = 'received'
        AND p.deleted_at IS NULL
    ), 0)::numeric(14, 2) AS amount_paid,
    coalesce((
      SELECT sum(sr.grand_total)
      FROM public.sales_returns sr
      WHERE sr.invoice_id = i.id
        AND sr.status = 'issued'
        AND sr.deleted_at IS NULL
    ), 0)::numeric(14, 2) AS amount_credited,
    (i.grand_total
      - coalesce((
          SELECT sum(a.amount_applied)
          FROM public.payment_allocations a
          JOIN public.payments p ON p.id = a.payment_id
          WHERE a.invoice_id = i.id
            AND p.status = 'received'
            AND p.deleted_at IS NULL
        ), 0)
      - coalesce((
          SELECT sum(sr.grand_total)
          FROM public.sales_returns sr
          WHERE sr.invoice_id = i.id
            AND sr.status = 'issued'
            AND sr.deleted_at IS NULL
        ), 0)
    )::numeric(14, 2) AS balance_due
  FROM public.invoices i
  WHERE i.deleted_at IS NULL
    AND i.status = 'issued';

GRANT EXECUTE ON FUNCTION public.create_sales_return_draft(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_sales_return_draft(uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_sales_return_draft(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_sales_return(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_sales_return(uuid, text) TO authenticated;
