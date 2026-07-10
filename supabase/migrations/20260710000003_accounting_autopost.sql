-- Accounting phase 2 — auto-posting hooks for invoices + payments.
--
-- Approach: AFTER-UPDATE triggers watch status transitions and insert
-- journal_entries directly. The source RPCs (create_invoice_draft,
-- issue_invoice, create_payment, cancel_*) stay untouched — trigger-only
-- integration lets us keep the two concerns (business flow vs. books)
-- separate and independently reversible.
--
-- Failure mode: if a required system account is missing (COA broken),
-- we log a NOTICE and DO NOT raise — a broken books setup should never
-- block an invoice from being issued. An unposted event can be found
-- later by cross-referencing invoices where issued_at IS NOT NULL against
-- journal_entries where source_id = invoice.id.
--
-- Reversals: cancel_invoice / cancel_payment simply flip status. The
-- trigger sees the old→new transition, and emits an equal-but-opposite
-- entry with source_type still set — so the day-book shows both events.

-- Seed a default bank sub-account so UPI/bank_transfer payments have
-- somewhere to land. The user can rename it (e.g. "HDFC Current") from
-- /accounting/coa. Not marked is_system=true — deletable if the user
-- decides not to use it, though the payment autopost will then skip.
DO $$
DECLARE
  v_bank_group_id uuid;
BEGIN
  SELECT id INTO v_bank_group_id FROM public.chart_of_accounts
  WHERE code = '1200' AND deleted_at IS NULL AND is_group = true;
  IF v_bank_group_id IS NULL THEN RETURN; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE code = '1201' AND deleted_at IS NULL) THEN
    INSERT INTO public.chart_of_accounts (
      code, name_en, name_gu, account_type, parent_id, is_group, is_system
    ) VALUES (
      '1201', 'Default bank', 'ડિફોલ્ટ બેન્ક', 'asset', v_bank_group_id, false, false
    );
  END IF;
END $$;

-- Helper: resolve a system account id by its seeded code. Returns NULL
-- if the account is missing/deleted so callers can gracefully skip.
CREATE OR REPLACE FUNCTION public._acct_id(p_code text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT id FROM public.chart_of_accounts
  WHERE code = p_code AND deleted_at IS NULL AND is_active = true AND is_group = false
  LIMIT 1;
$$;

-- Helper: insert a two-line journal entry. Used by the triggers below.
-- Bypasses create_journal_entry's role check because triggers run with
-- SECURITY DEFINER as the underlying app_user context (already resolved
-- by the source RPC's audit binding). Assumes caller already validated
-- dr = cr; we just insert.
CREATE OR REPLACE FUNCTION public._post_je_two_line(
  p_entry_date date,
  p_narration text,
  p_source_type public.journal_source_type,
  p_source_id uuid,
  p_dr_account uuid,
  p_cr_account uuid,
  p_amount numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_number text;
  v_entry_id uuid;
  v_actor uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN NULL; END IF;
  IF p_dr_account IS NULL OR p_cr_account IS NULL THEN RETURN NULL; END IF;

  v_number := public._next_journal_entry_number(p_entry_date);
  -- Grab the current app_user id from the audit context if we can; otherwise
  -- leave created_by NULL. The transactional trigger runs after the source
  -- RPC bound the audit context, so current_setting reflects the caller.
  BEGIN
    v_actor := nullif(current_setting('app.changed_by', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN v_actor := NULL;
  END;

  INSERT INTO public.journal_entries (
    entry_number, entry_date, narration, source_type, source_id, created_by
  ) VALUES (
    v_number, p_entry_date, p_narration, p_source_type, p_source_id, v_actor
  ) RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_lines (journal_entry_id, line_no, account_id, debit, credit)
  VALUES (v_entry_id, 1, p_dr_account, p_amount, 0),
         (v_entry_id, 2, p_cr_account, 0, p_amount);

  RETURN v_entry_id;
END;
$$;

-- ── Invoice autopost ────────────────────────────────────────────────────────
-- Fires when:
--   * status transitions to 'issued' → Dr Sundry debtors, Cr Sales
--   * status transitions from 'issued' to 'cancelled' → reversing entry
-- For phase 2, the entire grand_total posts as Sales (no GST split yet —
-- that split lands when we add proper GST ledgers in phase 4).
CREATE OR REPLACE FUNCTION public._autopost_invoice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_debtors uuid := public._acct_id('1300');
  v_sales_acct uuid;
  v_narration text;
BEGIN
  v_sales_acct := CASE NEW.business_line
    WHEN 'rakhi' THEN public._acct_id('3100')
    WHEN 'kite' THEN public._acct_id('3200')
    ELSE NULL
  END;
  IF v_debtors IS NULL OR v_sales_acct IS NULL THEN RETURN NEW; END IF;

  -- draft → issued: primary posting
  IF (OLD.status IS DISTINCT FROM 'issued') AND NEW.status = 'issued' AND NEW.deleted_at IS NULL THEN
    v_narration := 'Invoice ' || coalesce(NEW.invoice_number, '') || ' — ' || NEW.business_line;
    PERFORM public._post_je_two_line(
      NEW.invoice_date, v_narration, 'invoice', NEW.id,
      v_debtors, v_sales_acct, NEW.grand_total
    );
  END IF;

  -- issued → cancelled: reversing entry
  IF OLD.status = 'issued' AND NEW.status = 'cancelled' THEN
    v_narration := 'Cancelled invoice ' || coalesce(NEW.invoice_number, '');
    PERFORM public._post_je_two_line(
      NEW.cancelled_at::date, v_narration, 'invoice', NEW.id,
      v_sales_acct, v_debtors, NEW.grand_total
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_autopost_invoice ON public.invoices;
CREATE TRIGGER trg_autopost_invoice
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public._autopost_invoice();

-- ── Payment autopost ────────────────────────────────────────────────────────
-- Fires on INSERT (all payments start life as 'received') and on UPDATE
-- when status flips to 'cancelled'.
CREATE OR REPLACE FUNCTION public._autopost_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_debtors uuid := public._acct_id('1300');
  v_dr uuid;
  v_narration text;
BEGIN
  -- Choose the "money in" side by payment method.
  v_dr := CASE NEW.payment_method
    WHEN 'cash' THEN public._acct_id('1100')
    WHEN 'upi' THEN public._acct_id('1201')
    WHEN 'bank_transfer' THEN public._acct_id('1201')
    ELSE NULL
  END;
  IF v_debtors IS NULL OR v_dr IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' AND NEW.status = 'received' AND NEW.deleted_at IS NULL THEN
    v_narration := 'Payment ' || coalesce(NEW.payment_number, '') || ' — ' || NEW.payment_method;
    PERFORM public._post_je_two_line(
      NEW.payment_date, v_narration, 'payment', NEW.id,
      v_dr, v_debtors, NEW.amount
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'received' AND NEW.status = 'cancelled' THEN
    v_narration := 'Cancelled payment ' || coalesce(NEW.payment_number, '');
    PERFORM public._post_je_two_line(
      NEW.cancelled_at::date, v_narration, 'payment', NEW.id,
      v_debtors, v_dr, NEW.amount
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_autopost_payment_insert ON public.payments;
CREATE TRIGGER trg_autopost_payment_insert
AFTER INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public._autopost_payment();

DROP TRIGGER IF EXISTS trg_autopost_payment_update ON public.payments;
CREATE TRIGGER trg_autopost_payment_update
AFTER UPDATE OF status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public._autopost_payment();
