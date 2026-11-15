-- =========================================================================
-- GST: CGST+SGST (same state) vs IGST (other state) — agreed 2026-11-15.
--
-- The split compared place_of_supply with our state as plain text, so
-- "GUJRAT." / "VALSAD" counted as another state (IGST), and a blank place of
-- supply silently meant IGST.
--
--   * _norm_state(): one spelling per state (Gujarat, Maharashtra, ...),
--     used by the invoice / purchase bill / sales return total functions.
--   * Party states cleaned up to the standard spelling (bills untouched).
--   * A kite bill can't be issued without a place of supply.
--   * Billing an order needs the party's state.
-- Issued bills are never recalculated: totals are only recomputed on drafts.
-- =========================================================================

CREATE OR REPLACE FUNCTION public._norm_state(p text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE s text := lower(regexp_replace(coalesce(p, ''), '[^a-zA-Z]', '', 'g'));
BEGIN
  IF s = '' THEN RETURN NULL; END IF;
  RETURN CASE
    WHEN s IN ('gujarat', 'gujrat', 'gujaratstate', 'gj', 'valsad', 'vapi', 'surat') THEN 'gujarat'
    WHEN s IN ('maharashtra', 'maharastra', 'maharashtr', 'mh', 'mumbai') THEN 'maharashtra'
    WHEN s IN ('rajasthan', 'rajsthan', 'rj') THEN 'rajasthan'
    WHEN s IN ('madhyapradesh', 'mp') THEN 'madhyapradesh'
    WHEN s IN ('dadranagarhaveli', 'dadranagarhavelianddamananddiu', 'dnhdd', 'silvassa', 'daman') THEN 'dadranagarhavelianddamananddiu'
    ELSE s END;
END; $$;

-- Swap the text comparison for _norm_state in the three total functions.
DO $$
DECLARE
  f text;
  def text;
  patched text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public._recompute_invoice_totals(uuid)',
    'public._recompute_purchase_bill_totals(uuid)',
    'public._recompute_sales_return_totals(uuid)'] LOOP
    def := pg_get_functiondef(f::regprocedure);
    patched := regexp_replace(def,
      'lower\(btrim\(([a-z_]+\.place_of_supply)\)\) = lower\(btrim\(([a-z_]+)\)\)',
      'public._norm_state(\1) = public._norm_state(\2)');
    IF patched = def THEN RAISE EXCEPTION 'state comparison not found in %', f; END IF;
    EXECUTE patched;
  END LOOP;
END $$;

-- Party states → standard spelling.
UPDATE public.billing_customers SET state = CASE public._norm_state(state)
    WHEN 'gujarat' THEN 'Gujarat'
    WHEN 'maharashtra' THEN 'Maharashtra'
    WHEN 'rajasthan' THEN 'Rajasthan'
    ELSE state END
  WHERE public._norm_state(state) IN ('gujarat', 'maharashtra', 'rajasthan')
    AND state IS DISTINCT FROM CASE public._norm_state(state)
      WHEN 'gujarat' THEN 'Gujarat' WHEN 'maharashtra' THEN 'Maharashtra' ELSE 'Rajasthan' END;

-- Kite bill: no issuing without a place of supply.
CREATE OR REPLACE FUNCTION public.trg_invoice_kite_pos_required()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.business_line = 'kite' AND NEW.status = 'issued'
     AND OLD.status IS DISTINCT FROM 'issued'
     AND public._norm_state(NEW.place_of_supply) IS NULL THEN
    RAISE EXCEPTION 'place_of_supply_required';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_invoice_kite_pos_required ON public.invoices;
CREATE TRIGGER trg_invoice_kite_pos_required
  BEFORE UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_kite_pos_required();

-- Billing an order: the party's state must be set (it becomes the place of supply).
DO $$
DECLARE def text; patched text;
BEGIN
  def := pg_get_functiondef('public.create_invoice_from_order(uuid)'::regprocedure);
  patched := replace(def,
    'SELECT state INTO v_state FROM public.billing_customers WHERE id = v_order.customer_id;',
    'SELECT state INTO v_state FROM public.billing_customers WHERE id = v_order.customer_id;
  IF public._norm_state(v_state) IS NULL THEN RAISE EXCEPTION ''party_state_required''; END IF;');
  IF patched = def THEN RAISE EXCEPTION 'create_invoice_from_order: state lookup not found'; END IF;
  EXECUTE patched;
END $$;
