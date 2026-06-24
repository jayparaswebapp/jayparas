-- Payments Received — money coming in from customers, applied against one
-- or more invoices. The data model:
--   payments              one record per money transfer received
--   payment_allocations   join: which invoices this payment settles, and how much per
--   payment_number_counters  per-FY auto-numbering ("PMT/26-27/001")
--   invoice_balances (view)  derived balance-due per invoice
--
-- Allocations are a separate table because one payment can settle multiple
-- invoices (one cheque covers #42 fully + #43 partially) and the running
-- balance per invoice has to subtract every allocation that's ever been
-- applied to it.

-- ── Counter table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_number_counters (
  financial_year text PRIMARY KEY,
  last_number integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_number_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read payment_number_counters" ON public.payment_number_counters;
CREATE POLICY "authenticated read payment_number_counters" ON public.payment_number_counters
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── payments table ─────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN
    CREATE TYPE public.payment_method AS ENUM ('cash', 'upi', 'bank_transfer');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE public.payment_status AS ENUM ('received', 'cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number text UNIQUE NOT NULL,
  customer_id uuid NOT NULL REFERENCES public.billing_customers(id),
  payment_date date NOT NULL DEFAULT current_date,
  payment_method public.payment_method NOT NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  reference_no text,
  notes text,
  status public.payment_status NOT NULL DEFAULT 'received',
  -- Frozen at create time so the printed receipt isn't affected by later
  -- customer / company-info edits.
  customer_snapshot jsonb,
  seller_snapshot jsonb,
  received_by uuid REFERENCES public.app_users(id),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.app_users(id),
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_payments_customer ON public.payments(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_date ON public.payments(payment_date DESC) WHERE deleted_at IS NULL;

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read payments" ON public.payments;
CREATE POLICY "authenticated read payments" ON public.payments
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "super_admin or supervisor write payments" ON public.payments;
CREATE POLICY "super_admin or supervisor write payments" ON public.payments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );

-- ── payment_allocations table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  amount_applied numeric(14, 2) NOT NULL CHECK (amount_applied > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice ON public.payment_allocations(invoice_id);

ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read payment_allocations" ON public.payment_allocations;
CREATE POLICY "authenticated read payment_allocations" ON public.payment_allocations
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "super_admin or supervisor write payment_allocations" ON public.payment_allocations;
CREATE POLICY "super_admin or supervisor write payment_allocations" ON public.payment_allocations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );

-- ── invoice_balances view ──────────────────────────────────────────────────
-- For every non-deleted, issued invoice, derives the running balance due:
--   balance_due = grand_total - sum(applied allocations from active payments)
-- Used by the payments form to show the unsettled invoices for a customer
-- and the customer detail page (later) to show outstanding receivables.
CREATE OR REPLACE VIEW public.invoice_balances AS
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
    (i.grand_total - coalesce((
      SELECT sum(a.amount_applied)
      FROM public.payment_allocations a
      JOIN public.payments p ON p.id = a.payment_id
      WHERE a.invoice_id = i.id
        AND p.status = 'received'
        AND p.deleted_at IS NULL
    ), 0))::numeric(14, 2) AS balance_due
  FROM public.invoices i
  WHERE i.deleted_at IS NULL
    AND i.status = 'issued';

-- ── Helpers ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._next_payment_number(p_date date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_fy text := public._financial_year(p_date);
  v_seq integer;
BEGIN
  INSERT INTO public.payment_number_counters (financial_year, last_number)
  VALUES (v_fy, 1)
  ON CONFLICT (financial_year) DO UPDATE
    SET last_number = public.payment_number_counters.last_number + 1,
        updated_at = now()
  RETURNING last_number INTO v_seq;
  RETURN 'PMT/' || v_fy || '/' || lpad(v_seq::text, 3, '0');
END;
$$;

-- ── create_payment RPC ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_payment(p_header jsonb, p_allocations jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_seller public.company_info;
  v_customer public.billing_customers;
  v_customer_id uuid;
  v_payment_date date;
  v_method public.payment_method;
  v_amount numeric(14, 2);
  v_reference text;
  v_notes text;
  v_number text;
  v_row public.payments;
  v_alloc jsonb;
  v_alloc_sum numeric(14, 2) := 0;
  v_inv public.invoices;
  v_already_applied numeric(14, 2);
  v_amount_applied numeric(14, 2);
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  v_customer_id := (p_header->>'customer_id')::uuid;
  v_payment_date := coalesce((p_header->>'payment_date')::date, current_date);
  v_method := (p_header->>'payment_method')::public.payment_method;
  v_amount := (p_header->>'amount')::numeric(14, 2);
  v_reference := nullif(btrim(p_header->>'reference_no'), '');
  v_notes := nullif(btrim(p_header->>'notes'), '');

  IF v_customer_id IS NULL THEN RAISE EXCEPTION 'payment_customer_missing'; END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'invalid_input'; END IF;

  SELECT * INTO v_customer FROM public.billing_customers
  WHERE id = v_customer_id AND deleted_at IS NULL;
  IF v_customer.id IS NULL THEN RAISE EXCEPTION 'payment_customer_missing'; END IF;

  SELECT * INTO v_seller FROM public.company_info LIMIT 1;
  IF v_seller.id IS NULL THEN RAISE EXCEPTION 'company_info_missing'; END IF;

  -- Validate allocation sum and per-invoice over-allocation.
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
    v_amount_applied := (v_alloc->>'amount_applied')::numeric(14, 2);
    IF v_amount_applied IS NULL OR v_amount_applied <= 0 THEN
      RAISE EXCEPTION 'invalid_input';
    END IF;
    v_alloc_sum := v_alloc_sum + v_amount_applied;

    SELECT * INTO v_inv FROM public.invoices
    WHERE id = (v_alloc->>'invoice_id')::uuid
      AND deleted_at IS NULL
      AND status = 'issued';
    IF v_inv.id IS NULL THEN RAISE EXCEPTION 'invoice_not_payable'; END IF;
    IF v_inv.customer_id <> v_customer_id THEN
      RAISE EXCEPTION 'invoice_customer_mismatch';
    END IF;

    SELECT coalesce(sum(a.amount_applied), 0) INTO v_already_applied
    FROM public.payment_allocations a
    JOIN public.payments p ON p.id = a.payment_id
    WHERE a.invoice_id = v_inv.id
      AND p.status = 'received'
      AND p.deleted_at IS NULL;

    IF v_already_applied + v_amount_applied > v_inv.grand_total + 0.005 THEN
      RAISE EXCEPTION 'invoice_overallocated';
    END IF;
  END LOOP;

  IF v_alloc_sum > v_amount + 0.005 THEN RAISE EXCEPTION 'payment_overallocated'; END IF;

  v_number := public._next_payment_number(v_payment_date);

  INSERT INTO public.payments (
    payment_number, customer_id, payment_date, payment_method,
    amount, reference_no, notes,
    customer_snapshot, seller_snapshot, received_by
  )
  VALUES (
    v_number,
    v_customer_id,
    v_payment_date,
    v_method,
    v_amount,
    v_reference,
    v_notes,
    jsonb_build_object(
      'full_name', v_customer.full_name,
      'business_name', v_customer.business_name,
      'mobile', v_customer.mobile,
      'email', v_customer.email,
      'gstin', v_customer.gstin,
      'city', v_customer.city,
      'state', v_customer.state
    ),
    jsonb_build_object(
      'legal_name', v_seller.legal_name,
      'gstin', v_seller.gstin,
      'address_line1', v_seller.address_line1,
      'address_line2', v_seller.address_line2,
      'city', v_seller.city,
      'state', v_seller.state,
      'pincode', v_seller.pincode,
      'mobile', v_seller.mobile,
      'email', v_seller.email
    ),
    v_caller.id
  )
  RETURNING * INTO v_row;

  -- Insert allocations.
  INSERT INTO public.payment_allocations (payment_id, invoice_id, amount_applied)
  SELECT v_row.id,
         (alloc->>'invoice_id')::uuid,
         (alloc->>'amount_applied')::numeric(14, 2)
  FROM jsonb_array_elements(p_allocations) AS alloc;

  RETURN to_jsonb(v_row);
END;
$$;

-- ── cancel_payment RPC ─────────────────────────────────────────────────────
-- Soft-cancel keeps the row for audit but frees the allocations from the
-- invoice_balances view (the view filters status='received'). Allocations
-- stay in place so we can show "this payment was applied here, now
-- cancelled" on the customer ledger.
CREATE OR REPLACE FUNCTION public.cancel_payment(p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.payments;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  SELECT * INTO v_row FROM public.payments
  WHERE id = p_id AND deleted_at IS NULL;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_row.status = 'cancelled' THEN RAISE EXCEPTION 'payment_already_cancelled'; END IF;

  UPDATE public.payments
  SET status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = v_caller.id,
      cancellation_reason = nullif(btrim(p_reason), ''),
      updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_payment(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_payment(uuid, text) TO authenticated;
