-- =========================================================================
-- Orders → bills, part 4 (agreed 2026-11-14).
--
--   * An order is billed ONCE, for the packed qty.
--   * Whatever was not packed moves to a NEW order (status new) that refers
--     back to the old one (parent_order_id) and keeps the old order's rates,
--     discounts, HSN and GST. The old order is then fully closed (billed).
--   * If that bill is deleted (draft) or cancelled (issued), the old order
--     goes back to Ready with the same packed qty, so it can be billed again.
--     The new pending order is not touched.
--
-- Deleting a draft bill made from an order used to fail on the foreign key;
-- the link now cascades away after the order has been restored.
-- =========================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS parent_order_id uuid REFERENCES public.orders(id);
CREATE INDEX IF NOT EXISTS orders_parent_idx ON public.orders (parent_order_id);

-- qty_moved = qty sent to the pending order when this order was billed.
ALTER TABLE public.order_lines
  ADD COLUMN IF NOT EXISTS qty_moved numeric(12,3) NOT NULL DEFAULT 0;
ALTER TABLE public.order_lines DROP CONSTRAINT IF EXISTS order_lines_qty_chk;
ALTER TABLE public.order_lines ADD CONSTRAINT order_lines_qty_chk CHECK (
  qty_ordered > 0 AND qty_packed >= 0 AND qty_billed >= 0 AND qty_moved >= 0
  AND qty_packed + qty_billed + qty_moved <= qty_ordered
);

-- Which order line gave how much qty to the bill: [{line_id, qty}].
ALTER TABLE public.order_invoices
  ADD COLUMN IF NOT EXISTS lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
ALTER TABLE public.order_invoices DROP CONSTRAINT IF EXISTS order_invoices_invoice_id_fkey;
ALTER TABLE public.order_invoices
  ADD CONSTRAINT order_invoices_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;

-- =========================================================================
-- create_invoice_from_order: Ready order → DRAFT bill of the packed qty;
-- unpacked qty → new pending order. Returns the invoice row plus
-- pending_order_id / pending_order_number (null when nothing was left).
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_invoice_from_order(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._order_caller(true);
  v_order public.orders;
  v_new public.orders;
  v_state text;
  v_lines jsonb;
  v_link_lines jsonb;
  v_invoice jsonb;
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
           'gst_pct', l.gst_pct) ORDER BY l.line_no),
         jsonb_agg(jsonb_build_object('line_id', l.id, 'qty', l.qty_packed) ORDER BY l.line_no)
    INTO v_lines, v_link_lines
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

  INSERT INTO public.order_invoices (order_id, invoice_id, lines)
    VALUES (p_id, (v_invoice->>'id')::uuid, v_link_lines);

  -- Pending order for whatever was not packed, at this order's rates.
  IF EXISTS (SELECT 1 FROM public.order_lines
              WHERE order_id = p_id AND qty_ordered - qty_billed - qty_moved - qty_packed > 0) THEN
    INSERT INTO public.orders (order_number, business_line, customer_id, notes, created_by, parent_order_id)
    VALUES ('ORD-' || lpad(nextval('public.order_number_seq')::text, 4, '0'),
            v_order.business_line, v_order.customer_id,
            'Pending from ' || v_order.order_number, v_caller.id, p_id)
    RETURNING * INTO v_new;

    INSERT INTO public.order_lines (
      order_id, line_no, sku_id, sku_snapshot, description, hsn_code, uom,
      rate, discount_pct, gst_pct, qty_ordered)
    SELECT v_new.id, row_number() OVER (ORDER BY l.line_no), l.sku_id, l.sku_snapshot,
           l.description, l.hsn_code, l.uom, l.rate, l.discount_pct, l.gst_pct,
           l.qty_ordered - l.qty_billed - l.qty_moved - l.qty_packed
      FROM public.order_lines l
     WHERE l.order_id = p_id AND l.qty_ordered - l.qty_billed - l.qty_moved - l.qty_packed > 0;

    PERFORM public._recompute_order_total(v_new.id);
  END IF;

  UPDATE public.order_lines
     SET qty_moved = qty_ordered - qty_billed - qty_packed,
         qty_billed = qty_billed + qty_packed,
         qty_packed = 0
   WHERE order_id = p_id;
  UPDATE public.orders SET status = 'billed' WHERE id = p_id;

  RETURN v_invoice || jsonb_build_object(
    'pending_order_id', v_new.id, 'pending_order_number', v_new.order_number);
END; $$;

-- =========================================================================
-- Bill deleted / cancelled → its order back to Ready with the same packing.
-- =========================================================================
CREATE OR REPLACE FUNCTION public._order_reverse_invoice(p_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_link public.order_invoices;
  v_el jsonb;
  v_qty numeric;
BEGIN
  FOR v_link IN
    SELECT * FROM public.order_invoices
     WHERE invoice_id = p_invoice_id AND reversed_at IS NULL FOR UPDATE
  LOOP
    PERFORM 1 FROM public.orders WHERE id = v_link.order_id FOR UPDATE;
    FOR v_el IN SELECT * FROM jsonb_array_elements(v_link.lines) LOOP
      v_qty := (v_el->>'qty')::numeric;
      UPDATE public.order_lines
         SET qty_billed = qty_billed - least(qty_billed, v_qty),
             qty_packed = qty_packed + least(qty_billed, v_qty)
       WHERE id = (v_el->>'line_id')::uuid AND order_id = v_link.order_id;
    END LOOP;
    UPDATE public.order_invoices SET reversed_at = now() WHERE id = v_link.id;
    UPDATE public.orders SET status = 'ready'
     WHERE id = v_link.order_id AND status <> 'cancelled';
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_invoice_order_reverse()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public._order_reverse_invoice(OLD.id);
    RETURN OLD;
  END IF;
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    PERFORM public._order_reverse_invoice(NEW.id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_invoice_order_reverse_del ON public.invoices;
CREATE TRIGGER trg_invoice_order_reverse_del
  BEFORE DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_order_reverse();

DROP TRIGGER IF EXISTS trg_invoice_order_reverse_upd ON public.invoices;
CREATE TRIGGER trg_invoice_order_reverse_upd
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_order_reverse();

REVOKE EXECUTE ON FUNCTION
  public._order_reverse_invoice(uuid),
  public.trg_invoice_order_reverse()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_order(uuid) TO authenticated;
