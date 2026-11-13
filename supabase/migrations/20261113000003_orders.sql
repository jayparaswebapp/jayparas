-- Orders: staff take an order → pack it → owner turns it into a draft bill.
--
-- Rules (agreed 2026-11-13):
--   * Prices / discounts / HSN / GST are fixed on the order line when the
--     order is taken (estimated value known up front). The bill copies them.
--   * Packing = tick + packed qty (can be less than ordered).
--   * Billing bills ONLY the packed qty. The rest stays pending on the order
--     and can be packed + billed later, or closed.
--   * Statuses: new → packing → ready → (partial ↔ packing/ready) → billed,
--     or cancelled (only while nothing has been billed).
--   * order_staff can take / edit / pack / cancel orders, and sees prices,
--     but can't bill. Billing = super_admin / supervisor.
--   * No advance payments on orders.
--
-- NOTE: _validate_reason() only allows super_admin / supervisor, so these
-- functions do their own role checks and never call it.

CREATE SEQUENCE IF NOT EXISTS public.order_number_seq START 1;

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  business_line public.business_line NOT NULL,
  customer_id uuid NOT NULL REFERENCES public.billing_customers(id),
  status text NOT NULL DEFAULT 'new',
  notes text,
  estimated_total numeric(14,2) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT orders_status_chk
    CHECK (status IN ('new','packing','ready','partial','billed','cancelled'))
);
CREATE INDEX IF NOT EXISTS orders_status_idx ON public.orders (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS orders_customer_idx ON public.orders (customer_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  sku_id uuid REFERENCES public.skus(id),
  sku_snapshot jsonb,
  description text NOT NULL,
  hsn_code text NOT NULL DEFAULT '',
  uom text NOT NULL DEFAULT 'Pcs',
  rate numeric(12,2) NOT NULL,
  discount_pct numeric(5,2) NOT NULL DEFAULT 0,
  gst_pct numeric(5,2) NOT NULL DEFAULT 0,
  qty_ordered numeric(12,3) NOT NULL,
  qty_packed numeric(12,3) NOT NULL DEFAULT 0,   -- packed this round, not yet billed
  qty_billed numeric(12,3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_lines_qty_chk CHECK (
    qty_ordered > 0 AND qty_packed >= 0 AND qty_billed >= 0
    AND qty_packed + qty_billed <= qty_ordered
  ),
  CONSTRAINT order_lines_rate_chk CHECK (rate >= 0),
  CONSTRAINT order_lines_disc_chk CHECK (discount_pct >= 0 AND discount_pct <= 100),
  CONSTRAINT order_lines_gst_chk CHECK (gst_pct >= 0 AND gst_pct <= 28)
);
CREATE INDEX IF NOT EXISTS order_lines_order_idx ON public.order_lines (order_id);

-- One order can produce several bills (pending items billed later).
CREATE TABLE IF NOT EXISTS public.order_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_invoices_uq UNIQUE (order_id, invoice_id)
);

-- updated_at + audit + RLS (reads open to logged-in users like the rest of
-- billing; writes go through the functions below).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders','order_lines'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['orders','order_lines','order_invoices'] LOOP
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
-- Helpers
-- =========================================================================
CREATE OR REPLACE FUNCTION public._order_caller(p_can_bill boolean)
RETURNS public.app_users LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_caller public.app_users := public._current_app_user();
BEGIN
  IF v_caller.id IS NULL THEN RAISE EXCEPTION 'session_invalid'; END IF;
  IF p_can_bill THEN
    IF v_caller.role::text NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  ELSE
    IF v_caller.role::text NOT IN ('super_admin','supervisor','order_staff') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');
  RETURN v_caller;
END; $$;

CREATE OR REPLACE FUNCTION public._recompute_order_total(p_order_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.orders o SET estimated_total = coalesce((
    SELECT round(sum(round(l.qty_ordered * l.rate * (1 - l.discount_pct / 100), 2)
                     * (1 + CASE WHEN o.business_line = 'kite' THEN l.gst_pct ELSE 0 END / 100)), 2)
    FROM public.order_lines l WHERE l.order_id = o.id), 0)
  WHERE o.id = p_order_id;
$$;

-- =========================================================================
-- save_order: create, or edit while status = 'new'. Replaces all lines.
-- p_lines: [{sku_id, sku_snapshot, description, hsn_code, uom, rate,
--            discount_pct, gst_pct, qty}]
-- =========================================================================
CREATE OR REPLACE FUNCTION public.save_order(
  p_id uuid,
  p_business_line public.business_line,
  p_customer_id uuid,
  p_notes text,
  p_lines jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._order_caller(false);
  v_order public.orders;
  v_line jsonb;
  v_no integer := 0;
  v_sku public.skus;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.billing_customers WHERE id = p_customer_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.orders (order_number, business_line, customer_id, notes, created_by)
    VALUES ('ORD-' || lpad(nextval('public.order_number_seq')::text, 4, '0'),
            p_business_line, p_customer_id, nullif(btrim(p_notes), ''), v_caller.id)
    RETURNING * INTO v_order;
  ELSE
    SELECT * INTO v_order FROM public.orders WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
    IF v_order.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
    IF v_order.status <> 'new' THEN RAISE EXCEPTION 'order_locked'; END IF;
    UPDATE public.orders
      SET business_line = p_business_line, customer_id = p_customer_id,
          notes = nullif(btrim(p_notes), '')
      WHERE id = p_id RETURNING * INTO v_order;
    DELETE FROM public.order_lines WHERE order_id = p_id;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_no := v_no + 1;
    IF nullif(v_line->>'sku_id', '') IS NOT NULL THEN
      SELECT * INTO v_sku FROM public.skus WHERE id = (v_line->>'sku_id')::uuid AND deleted_at IS NULL;
      IF v_sku.id IS NULL OR v_sku.business_line <> p_business_line THEN RAISE EXCEPTION 'invalid_input'; END IF;
    END IF;
    BEGIN
      INSERT INTO public.order_lines (
        order_id, line_no, sku_id, sku_snapshot, description, hsn_code, uom,
        rate, discount_pct, gst_pct, qty_ordered
      ) VALUES (
        v_order.id, v_no,
        nullif(v_line->>'sku_id', '')::uuid,
        v_line->'sku_snapshot',
        coalesce(nullif(btrim(v_line->>'description'), ''), '—'),
        coalesce(btrim(v_line->>'hsn_code'), ''),
        coalesce(nullif(btrim(v_line->>'uom'), ''), 'Pcs'),
        (v_line->>'rate')::numeric,
        coalesce((v_line->>'discount_pct')::numeric, 0),
        CASE WHEN p_business_line = 'kite' THEN coalesce((v_line->>'gst_pct')::numeric, 0) ELSE 0 END,
        (v_line->>'qty')::numeric
      );
    EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation THEN
      RAISE EXCEPTION 'invalid_input';
    END;
  END LOOP;

  PERFORM public._recompute_order_total(v_order.id);
  SELECT * INTO v_order FROM public.orders WHERE id = v_order.id;
  RETURN to_jsonb(v_order);
END; $$;

-- =========================================================================
-- save_order_packing: set packed qty per line (this round). Optionally mark
-- the order Ready. p_lines: [{line_id, qty_packed}]
-- =========================================================================
CREATE OR REPLACE FUNCTION public.save_order_packing(
  p_id uuid,
  p_lines jsonb,
  p_mark_ready boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._order_caller(false);
  v_order public.orders;
  v_line jsonb;
  v_any_packed boolean;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_order.status NOT IN ('new','packing','ready','partial') THEN RAISE EXCEPTION 'order_locked'; END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) LOOP
    BEGIN
      UPDATE public.order_lines
        SET qty_packed = coalesce((v_line->>'qty_packed')::numeric, 0)
        WHERE id = (v_line->>'line_id')::uuid AND order_id = p_id;
    EXCEPTION WHEN check_violation OR invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_input';
    END;
  END LOOP;

  SELECT bool_or(qty_packed > 0) INTO v_any_packed FROM public.order_lines WHERE order_id = p_id;

  UPDATE public.orders
    SET status = CASE WHEN p_mark_ready AND coalesce(v_any_packed, false) THEN 'ready' ELSE 'packing' END
    WHERE id = p_id RETURNING * INTO v_order;

  IF p_mark_ready AND NOT coalesce(v_any_packed, false) THEN RAISE EXCEPTION 'order_nothing_packed'; END IF;
  RETURN to_jsonb(v_order);
END; $$;

-- =========================================================================
-- cancel_order: only while nothing has been billed.
-- close_order_pending: drop the pending (unbilled) rest of a partly billed order.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.cancel_order(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._order_caller(false);
  v_order public.orders;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_order.status NOT IN ('new','packing','ready') THEN RAISE EXCEPTION 'order_locked'; END IF;
  IF EXISTS (SELECT 1 FROM public.order_lines WHERE order_id = p_id AND qty_billed > 0) THEN
    RAISE EXCEPTION 'order_locked';
  END IF;
  UPDATE public.orders SET status = 'cancelled', cancelled_at = now()
    WHERE id = p_id RETURNING * INTO v_order;
  RETURN to_jsonb(v_order);
END; $$;

CREATE OR REPLACE FUNCTION public.close_order_pending(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._order_caller(true);
  v_order public.orders;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_order.status NOT IN ('partial','packing') OR NOT EXISTS (
       SELECT 1 FROM public.order_lines WHERE order_id = p_id AND qty_billed > 0) THEN
    RAISE EXCEPTION 'order_locked';
  END IF;
  UPDATE public.order_lines SET qty_packed = 0 WHERE order_id = p_id;
  UPDATE public.orders SET status = 'billed' WHERE id = p_id RETURNING * INTO v_order;
  RETURN to_jsonb(v_order);
END; $$;

-- =========================================================================
-- create_invoice_from_order: Ready order → DRAFT bill of the packed qty, at
-- the order's own rates / discounts / HSN / GST. Uses the normal
-- create_invoice_draft (same numbering, totals, accounts). The owner then
-- reviews and issues the draft as usual. Returns the invoice row.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_invoice_from_order(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._order_caller(true);
  v_order public.orders;
  v_state text;
  v_lines jsonb;
  v_invoice jsonb;
  v_left numeric;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_order.status <> 'ready' THEN RAISE EXCEPTION 'order_not_ready'; END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'sku_id', l.sku_id,
           'sku_snapshot', l.sku_snapshot,
           'description', l.description,
           'hsn_code', l.hsn_code,
           'qty', l.qty_packed,
           'uom', l.uom,
           'rate', l.rate,
           'discount_pct', l.discount_pct,
           'gst_pct', l.gst_pct) ORDER BY l.line_no)
    INTO v_lines
    FROM public.order_lines l WHERE l.order_id = p_id AND l.qty_packed > 0;
  IF v_lines IS NULL THEN RAISE EXCEPTION 'order_nothing_packed'; END IF;

  SELECT state INTO v_state FROM public.billing_customers WHERE id = v_order.customer_id;

  v_invoice := public.create_invoice_draft(
    jsonb_build_object(
      'business_line', v_order.business_line,
      'customer_id', v_order.customer_id,
      'invoice_date', current_date,
      'place_of_supply', coalesce(v_state, ''),
      'notes', 'Order ' || v_order.order_number
    ),
    v_lines
  );

  INSERT INTO public.order_invoices (order_id, invoice_id) VALUES (p_id, (v_invoice->>'id')::uuid);

  UPDATE public.order_lines
    SET qty_billed = qty_billed + qty_packed, qty_packed = 0
    WHERE order_id = p_id AND qty_packed > 0;

  SELECT sum(qty_ordered - qty_billed) INTO v_left FROM public.order_lines WHERE order_id = p_id;
  UPDATE public.orders SET status = CASE WHEN coalesce(v_left, 0) > 0 THEN 'partial' ELSE 'billed' END
    WHERE id = p_id;

  RETURN v_invoice;
END; $$;

REVOKE EXECUTE ON FUNCTION
  public._order_caller(boolean),
  public._recompute_order_total(uuid),
  public.save_order(uuid, public.business_line, uuid, text, jsonb),
  public.save_order_packing(uuid, jsonb, boolean),
  public.cancel_order(uuid),
  public.close_order_pending(uuid),
  public.create_invoice_from_order(uuid)
FROM anon, public;
GRANT EXECUTE ON FUNCTION
  public.save_order(uuid, public.business_line, uuid, text, jsonb),
  public.save_order_packing(uuid, jsonb, boolean),
  public.cancel_order(uuid),
  public.close_order_pending(uuid),
  public.create_invoice_from_order(uuid)
TO authenticated;
