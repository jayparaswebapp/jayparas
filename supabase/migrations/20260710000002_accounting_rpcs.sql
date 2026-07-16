-- Accounting phase 1 RPCs.
--
-- create_journal_entry — the ONLY way to write to journal_entries + lines
-- from the app. Validates:
--   * caller role in ('super_admin', 'accountant')
--   * at least two lines
--   * each line has exactly one of debit/credit > 0 (also table-level CHECK)
--   * sum(debit) = sum(credit) — the double-entry set-level rule
--   * every referenced account exists, is active, is a LEAF (is_group=false)
-- On success returns to_jsonb(entry).
--
-- cancel_journal_entry — reversible flip to status='cancelled'. Cancelled
-- entries are excluded from the account_balances view.
--
-- create_account / update_account — for adding a bank sub-account, renaming,
-- deactivating a leaf. is_system accounts can be renamed and deactivated
-- but NOT deleted, so auto-posting hooks (phase 2) keep working.

CREATE OR REPLACE FUNCTION public._next_journal_entry_number(p_date date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_fy text := public._financial_year(p_date);
  v_seq integer;
BEGIN
  INSERT INTO public.journal_entry_counters (financial_year, last_number)
  VALUES (v_fy, 1)
  ON CONFLICT (financial_year) DO UPDATE
    SET last_number = public.journal_entry_counters.last_number + 1, updated_at = now()
  RETURNING last_number INTO v_seq;
  RETURN 'JE/' || v_fy || '/' || lpad(v_seq::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.create_journal_entry(p_header jsonb, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_date date;
  v_number text;
  v_narration text;
  v_source_type public.journal_source_type;
  v_source_id uuid;
  v_row public.journal_entries;
  v_line jsonb;
  v_idx int := 0;
  v_account public.chart_of_accounts;
  v_dr numeric;
  v_cr numeric;
  v_sum_dr numeric := 0;
  v_sum_cr numeric := 0;
BEGIN
  IF v_caller.role NOT IN ('super_admin', 'accountant') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  v_date        := coalesce((p_header->>'entry_date')::date, current_date);
  v_narration   := nullif(btrim(p_header->>'narration'), '');
  v_source_type := coalesce((p_header->>'source_type')::public.journal_source_type, 'manual');
  v_source_id   := nullif(p_header->>'source_id', '')::uuid;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'journal_lines_required';
  END IF;

  v_number := public._next_journal_entry_number(v_date);

  INSERT INTO public.journal_entries (
    entry_number, entry_date, narration, source_type, source_id, created_by
  ) VALUES (
    v_number, v_date, v_narration, v_source_type, v_source_id, v_caller.id
  ) RETURNING * INTO v_row;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_idx := v_idx + 1;
    v_dr := coalesce((v_line->>'debit')::numeric, 0);
    v_cr := coalesce((v_line->>'credit')::numeric, 0);

    IF (v_dr > 0 AND v_cr > 0) OR (v_dr = 0 AND v_cr = 0) THEN
      RAISE EXCEPTION 'journal_line_dr_xor_cr';
    END IF;
    IF v_dr < 0 OR v_cr < 0 THEN
      RAISE EXCEPTION 'journal_line_negative';
    END IF;

    SELECT * INTO v_account
    FROM public.chart_of_accounts
    WHERE id = nullif(v_line->>'account_id', '')::uuid
      AND deleted_at IS NULL;
    IF v_account.id IS NULL THEN
      RAISE EXCEPTION 'journal_account_missing';
    END IF;
    IF v_account.is_group THEN
      RAISE EXCEPTION 'journal_account_is_group';
    END IF;
    IF NOT v_account.is_active THEN
      RAISE EXCEPTION 'journal_account_inactive';
    END IF;

    INSERT INTO public.journal_lines (
      journal_entry_id, line_no, account_id, debit, credit, note
    ) VALUES (
      v_row.id, v_idx, v_account.id, v_dr, v_cr, nullif(btrim(v_line->>'note'), '')
    );

    v_sum_dr := v_sum_dr + v_dr;
    v_sum_cr := v_sum_cr + v_cr;
  END LOOP;

  -- Set-level double-entry check. 0.005 tolerance for float rounding on
  -- payloads coming in as numeric strings.
  IF abs(v_sum_dr - v_sum_cr) > 0.005 THEN
    RAISE EXCEPTION 'journal_unbalanced';
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_journal_entry(p_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.journal_entries;
BEGIN
  IF v_caller.role NOT IN ('super_admin', 'accountant') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  SELECT * INTO v_row FROM public.journal_entries WHERE id = p_id AND deleted_at IS NULL;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_row.status = 'cancelled' THEN RAISE EXCEPTION 'journal_already_cancelled'; END IF;

  -- Auto-posted entries (from invoice/payment/etc) can't be cancelled from
  -- the accounting UI — the source document has to be cancelled instead,
  -- which will handle the reversing entry in phase 2.
  IF v_row.source_type <> 'manual' THEN
    RAISE EXCEPTION 'journal_auto_posted';
  END IF;

  UPDATE public.journal_entries
  SET status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = v_caller.id,
      cancellation_reason = nullif(btrim(p_reason), '')
  WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_account(
  p_code text, p_name_en text, p_name_gu text, p_parent_id uuid, p_is_group boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_parent public.chart_of_accounts;
  v_row public.chart_of_accounts;
BEGIN
  IF v_caller.role NOT IN ('super_admin', 'accountant') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  IF p_code IS NULL OR btrim(p_code) = '' THEN RAISE EXCEPTION 'account_code_required'; END IF;
  IF p_name_en IS NULL OR btrim(p_name_en) = '' THEN RAISE EXCEPTION 'account_name_required'; END IF;
  IF p_name_gu IS NULL OR btrim(p_name_gu) = '' THEN RAISE EXCEPTION 'account_name_required'; END IF;
  IF p_parent_id IS NULL THEN RAISE EXCEPTION 'account_parent_required'; END IF;

  SELECT * INTO v_parent FROM public.chart_of_accounts
  WHERE id = p_parent_id AND deleted_at IS NULL;
  IF v_parent.id IS NULL THEN RAISE EXCEPTION 'account_parent_missing'; END IF;

  INSERT INTO public.chart_of_accounts (
    code, name_en, name_gu, account_type, parent_id, is_group, is_system, created_by
  ) VALUES (
    btrim(p_code), btrim(p_name_en), btrim(p_name_gu), v_parent.account_type,
    v_parent.id, coalesce(p_is_group, false), false, v_caller.id
  ) RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'account_code_duplicate';
END;
$$;

CREATE OR REPLACE FUNCTION public.update_account(
  p_id uuid, p_name_en text, p_name_gu text, p_is_active boolean, p_notes text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.chart_of_accounts;
BEGIN
  IF v_caller.role NOT IN ('super_admin', 'accountant') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  SELECT * INTO v_row FROM public.chart_of_accounts WHERE id = p_id AND deleted_at IS NULL;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  UPDATE public.chart_of_accounts
  SET name_en   = coalesce(nullif(btrim(p_name_en), ''), name_en),
      name_gu   = coalesce(nullif(btrim(p_name_gu), ''), name_gu),
      is_active = coalesce(p_is_active, is_active),
      notes     = coalesce(nullif(btrim(p_notes), ''), notes)
  WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_journal_entry(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_journal_entry(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_account(text, text, text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_account(uuid, text, text, boolean, text) TO authenticated;
