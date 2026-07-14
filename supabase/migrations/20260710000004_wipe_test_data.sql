-- Super-admin maintenance action: wipe all transactional data so the shop
-- can clear out trial invoices/payments/etc before going live.
--
-- Preserves master data (users, locations, designs, lead-ladies, labourers,
-- customers, groups, suppliers, purchase items, SKUs, chart of accounts,
-- company info, settings) — anything you'd normally set up ONCE and then
-- operate against. Only transactional flow (invoices, payments, journal
-- entries, job orders, etc) plus per-FY number counters get wiped.
--
-- Guard: p_confirm must be exactly 'WIPE' (case-sensitive) or the RPC
-- raises. The client will also enforce a type-to-confirm on the form so
-- there's no way to trigger this by accident.

CREATE OR REPLACE FUNCTION public.wipe_test_data(p_confirm text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_result jsonb := '{}'::jsonb;
  v_c bigint;
BEGIN
  IF v_caller.role <> 'super_admin' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF p_confirm IS NULL OR p_confirm <> 'WIPE' THEN RAISE EXCEPTION 'wipe_confirmation_missing'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, 'wipe_test_data');

  -- Ordering matters: child rows before parents, and rows that reference
  -- invoices/payments (via source_id or FK) before the invoices/payments
  -- themselves.

  -- Accounting (journal_entries.source_id is a nullable uuid, not a FK, so
  -- we can wipe entries at any point — do it first to keep the day book
  -- consistent with what's left after the wipe).
  DELETE FROM public.journal_lines;         GET DIAGNOSTICS v_c = ROW_COUNT;
  v_result := v_result || jsonb_build_object('journal_lines', v_c);
  DELETE FROM public.journal_entries;       GET DIAGNOSTICS v_c = ROW_COUNT;
  v_result := v_result || jsonb_build_object('journal_entries', v_c);

  -- Payments (payment_allocations references invoices via FK; delete
  -- allocations first so we can then delete payments AND then invoices).
  DELETE FROM public.payment_allocations;   GET DIAGNOSTICS v_c = ROW_COUNT;
  v_result := v_result || jsonb_build_object('payment_allocations', v_c);
  DELETE FROM public.payments;              GET DIAGNOSTICS v_c = ROW_COUNT;
  v_result := v_result || jsonb_build_object('payments', v_c);

  -- Sales returns reference invoices — must go before invoices.
  DELETE FROM public.sales_return_lines;    GET DIAGNOSTICS v_c = ROW_COUNT;
  v_result := v_result || jsonb_build_object('sales_return_lines', v_c);
  DELETE FROM public.sales_returns;         GET DIAGNOSTICS v_c = ROW_COUNT;
  v_result := v_result || jsonb_build_object('sales_returns', v_c);

  -- Invoices.
  DELETE FROM public.invoice_lines;         GET DIAGNOSTICS v_c = ROW_COUNT;
  v_result := v_result || jsonb_build_object('invoice_lines', v_c);
  DELETE FROM public.invoices;              GET DIAGNOSTICS v_c = ROW_COUNT;
  v_result := v_result || jsonb_build_object('invoices', v_c);

  -- Purchases.
  DELETE FROM public.purchase_bill_lines;   GET DIAGNOSTICS v_c = ROW_COUNT;
  v_result := v_result || jsonb_build_object('purchase_bill_lines', v_c);
  DELETE FROM public.purchase_bills;        GET DIAGNOSTICS v_c = ROW_COUNT;
  v_result := v_result || jsonb_build_object('purchase_bills', v_c);

  -- Job work (job_order_items → sub_assignments + receipts are set up
  -- with ON DELETE CASCADE, so deleting job_order_items handles them,
  -- but explicit is safer + gives us counts).
  DELETE FROM public.job_receipts;          GET DIAGNOSTICS v_c = ROW_COUNT;
  v_result := v_result || jsonb_build_object('job_receipts', v_c);
  DELETE FROM public.job_sub_assignments;   GET DIAGNOSTICS v_c = ROW_COUNT;
  v_result := v_result || jsonb_build_object('job_sub_assignments', v_c);
  DELETE FROM public.job_order_items;       GET DIAGNOSTICS v_c = ROW_COUNT;
  v_result := v_result || jsonb_build_object('job_order_items', v_c);
  DELETE FROM public.job_orders;            GET DIAGNOSTICS v_c = ROW_COUNT;
  v_result := v_result || jsonb_build_object('job_orders', v_c);

  -- Reset all per-FY counters so numbering restarts at 0001.
  DELETE FROM public.invoice_number_counters;
  DELETE FROM public.payment_number_counters;
  DELETE FROM public.credit_note_number_counters;
  DELETE FROM public.purchase_bill_counters;
  DELETE FROM public.journal_entry_counters;
  DELETE FROM public.job_order_number_counters;

  RETURN v_result || jsonb_build_object(
    'ok', true,
    'wiped_by', v_caller.id,
    'wiped_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.wipe_test_data(text) TO authenticated;
