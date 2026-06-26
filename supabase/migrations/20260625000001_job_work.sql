-- Job-work management: tracking work given out to lead-ladies (LLs) and the
-- sub-distribution from LLs to individual labourers.
--
-- Data model:
--   labourers                each LL has a sub-list of labourers she manages.
--   job_orders               header — "office gave these pieces to LL X on date D".
--   job_order_items          one line per design within a job order.
--   job_sub_assignments      stage-2 tracking: LL gave N of this item to a labourer.
--   job_receipts             work coming back — accepted vs rejected, with optional
--                            labourer_id when a labourer (not the LL) finished it.
--   job_order_number_counters per-FY auto-numbering ("JW/26-27/001").
--   job_order_item_balances (view) derived per-item balances:
--                            qty_at_ll       (raw still at LL's home, not given out)
--                            qty_at_labourer (out at labourers, not yet returned)
--                            qty_accepted / qty_rejected
--
-- Wage math (paid to the LL who settles her labourers privately):
--   wages_owed = sum(qty_accepted × rate_per_piece) across all items.
-- Payouts to LLs ship in a follow-up migration that mirrors the customer-payment
-- + sales-return tables.

-- ── Labourers ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.labourers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_lady_id uuid NOT NULL REFERENCES public.lead_ladies(id),
  full_name text NOT NULL,
  mobile text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES public.app_users(id)
);

CREATE INDEX IF NOT EXISTS idx_labourers_lead_lady
  ON public.labourers(lead_lady_id) WHERE deleted_at IS NULL;
-- Same labourer (by mobile, within an LL's team) shouldn't be created twice
-- among active rows. mobile is optional so we only enforce when present.
CREATE UNIQUE INDEX IF NOT EXISTS idx_labourers_mobile_active
  ON public.labourers(lead_lady_id, mobile)
  WHERE deleted_at IS NULL AND mobile IS NOT NULL;

DROP TRIGGER IF EXISTS trg_labourers_updated_at ON public.labourers;
CREATE TRIGGER trg_labourers_updated_at
  BEFORE UPDATE ON public.labourers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.labourers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read labourers" ON public.labourers;
CREATE POLICY "authenticated read labourers" ON public.labourers
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "super_admin or supervisor write labourers" ON public.labourers;
CREATE POLICY "super_admin or supervisor write labourers" ON public.labourers
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.app_users a WHERE a.auth_user_id = auth.uid()
      AND a.role IN ('super_admin','supervisor') AND a.deleted_at IS NULL)
  );
REVOKE SELECT ON public.labourers FROM anon;

-- ── Job-order counter ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_order_number_counters (
  financial_year text PRIMARY KEY,
  last_number integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.job_order_number_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read job_order_number_counters"
  ON public.job_order_number_counters;
CREATE POLICY "authenticated read job_order_number_counters"
  ON public.job_order_number_counters
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_order_status') THEN
    CREATE TYPE public.job_order_status AS ENUM ('open', 'closed', 'cancelled');
  END IF;
END $$;

-- ── Job orders header ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_number text,
  lead_lady_id uuid NOT NULL REFERENCES public.lead_ladies(id),
  location_id uuid REFERENCES public.locations(id),
  issue_date date NOT NULL DEFAULT current_date,
  expected_return_date date,
  status public.job_order_status NOT NULL DEFAULT 'open',
  -- Frozen at create so renaming a lead-lady later doesn't rewrite history.
  lead_lady_snapshot jsonb,
  location_snapshot jsonb,
  notes text,
  closed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.app_users(id),
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES public.app_users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_orders_number_active
  ON public.job_orders(job_order_number)
  WHERE job_order_number IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_job_orders_ll
  ON public.job_orders(lead_lady_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_job_orders_status_date
  ON public.job_orders(status, issue_date DESC);

DROP TRIGGER IF EXISTS trg_job_orders_updated_at ON public.job_orders;
CREATE TRIGGER trg_job_orders_updated_at
  BEFORE UPDATE ON public.job_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Job order items ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_id uuid NOT NULL REFERENCES public.job_orders(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  design_id uuid REFERENCES public.designs(id),
  design_snapshot jsonb,
  qty_issued numeric(12, 2) NOT NULL CHECK (qty_issued > 0),
  -- Locked at order create — rate the LL is paid per accepted piece for this
  -- batch. Default sourced from designs.current_rate_per_guss / 144 but can be
  -- overridden per order.
  rate_per_piece numeric(10, 2) NOT NULL CHECK (rate_per_piece >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_order_items_order
  ON public.job_order_items(job_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_order_items_order_lineno
  ON public.job_order_items(job_order_id, line_no);

-- ── Sub-assignments (LL → labourer) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_sub_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_item_id uuid NOT NULL REFERENCES public.job_order_items(id) ON DELETE CASCADE,
  labourer_id uuid NOT NULL REFERENCES public.labourers(id),
  qty_assigned numeric(12, 2) NOT NULL CHECK (qty_assigned > 0),
  assigned_date date NOT NULL DEFAULT current_date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id)
);
CREATE INDEX IF NOT EXISTS idx_job_sub_assignments_item
  ON public.job_sub_assignments(job_order_item_id);
CREATE INDEX IF NOT EXISTS idx_job_sub_assignments_labourer
  ON public.job_sub_assignments(labourer_id);

-- ── Receipts (finished work returning) ─────────────────────────────────────
-- labourer_id is nullable: when present, the receipt "credits back" against
-- that labourer's sub-assignment pile; when null, the LL did the work
-- herself (or just lumped a batch return without per-labourer attribution).
CREATE TABLE IF NOT EXISTS public.job_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_item_id uuid NOT NULL REFERENCES public.job_order_items(id) ON DELETE CASCADE,
  labourer_id uuid REFERENCES public.labourers(id),
  qty_accepted numeric(12, 2) NOT NULL DEFAULT 0 CHECK (qty_accepted >= 0),
  qty_rejected numeric(12, 2) NOT NULL DEFAULT 0 CHECK (qty_rejected >= 0),
  receipt_date date NOT NULL DEFAULT current_date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  CONSTRAINT job_receipt_nonzero CHECK (qty_accepted + qty_rejected > 0)
);
CREATE INDEX IF NOT EXISTS idx_job_receipts_item
  ON public.job_receipts(job_order_item_id);
CREATE INDEX IF NOT EXISTS idx_job_receipts_labourer
  ON public.job_receipts(labourer_id) WHERE labourer_id IS NOT NULL;

ALTER TABLE public.job_orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_order_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_sub_assignments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_receipts          ENABLE ROW LEVEL SECURITY;

-- Read for any authenticated user; writes gated to super_admin/supervisor.
DO $$ BEGIN
  PERFORM 1; -- placeholder so all the policies below can be in one block
END $$;

DROP POLICY IF EXISTS "authenticated read job_orders" ON public.job_orders;
CREATE POLICY "authenticated read job_orders" ON public.job_orders FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "super_admin or supervisor write job_orders" ON public.job_orders;
CREATE POLICY "super_admin or supervisor write job_orders" ON public.job_orders FOR ALL USING (
  EXISTS (SELECT 1 FROM public.app_users a WHERE a.auth_user_id = auth.uid()
    AND a.role IN ('super_admin','supervisor') AND a.deleted_at IS NULL));

DROP POLICY IF EXISTS "authenticated read job_order_items" ON public.job_order_items;
CREATE POLICY "authenticated read job_order_items" ON public.job_order_items FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "super_admin or supervisor write job_order_items" ON public.job_order_items;
CREATE POLICY "super_admin or supervisor write job_order_items" ON public.job_order_items FOR ALL USING (
  EXISTS (SELECT 1 FROM public.app_users a WHERE a.auth_user_id = auth.uid()
    AND a.role IN ('super_admin','supervisor') AND a.deleted_at IS NULL));

DROP POLICY IF EXISTS "authenticated read job_sub_assignments" ON public.job_sub_assignments;
CREATE POLICY "authenticated read job_sub_assignments" ON public.job_sub_assignments FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "super_admin or supervisor write job_sub_assignments" ON public.job_sub_assignments;
CREATE POLICY "super_admin or supervisor write job_sub_assignments" ON public.job_sub_assignments FOR ALL USING (
  EXISTS (SELECT 1 FROM public.app_users a WHERE a.auth_user_id = auth.uid()
    AND a.role IN ('super_admin','supervisor','centre_manager') AND a.deleted_at IS NULL));

DROP POLICY IF EXISTS "authenticated read job_receipts" ON public.job_receipts;
CREATE POLICY "authenticated read job_receipts" ON public.job_receipts FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "super_admin or supervisor write job_receipts" ON public.job_receipts;
CREATE POLICY "super_admin or supervisor write job_receipts" ON public.job_receipts FOR ALL USING (
  EXISTS (SELECT 1 FROM public.app_users a WHERE a.auth_user_id = auth.uid()
    AND a.role IN ('super_admin','supervisor','centre_manager') AND a.deleted_at IS NULL));

REVOKE SELECT ON public.job_orders          FROM anon;
REVOKE SELECT ON public.job_order_items     FROM anon;
REVOKE SELECT ON public.job_sub_assignments FROM anon;
REVOKE SELECT ON public.job_receipts        FROM anon;

DROP TRIGGER IF EXISTS audit_job_orders ON public.job_orders;
CREATE TRIGGER audit_job_orders AFTER INSERT OR UPDATE OR DELETE ON public.job_orders FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
DROP TRIGGER IF EXISTS audit_job_order_items ON public.job_order_items;
CREATE TRIGGER audit_job_order_items AFTER INSERT OR UPDATE OR DELETE ON public.job_order_items FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
DROP TRIGGER IF EXISTS audit_job_sub_assignments ON public.job_sub_assignments;
CREATE TRIGGER audit_job_sub_assignments AFTER INSERT OR UPDATE OR DELETE ON public.job_sub_assignments FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
DROP TRIGGER IF EXISTS audit_job_receipts ON public.job_receipts;
CREATE TRIGGER audit_job_receipts AFTER INSERT OR UPDATE OR DELETE ON public.job_receipts FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

-- ── Helpers ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._next_job_order_number(p_date date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_fy text := public._financial_year(p_date);
  v_seq integer;
BEGIN
  INSERT INTO public.job_order_number_counters (financial_year, last_number)
  VALUES (v_fy, 1)
  ON CONFLICT (financial_year) DO UPDATE
    SET last_number = public.job_order_number_counters.last_number + 1,
        updated_at = now()
  RETURNING last_number INTO v_seq;
  RETURN 'JW/' || v_fy || '/' || lpad(v_seq::text, 3, '0');
END;
$$;

-- ── create_job_order ────────────────────────────────────────────────────────
-- Header is snapshotted on create. Items are inserted with their rate_per_piece
-- locked. Number is assigned immediately (no draft state in this flow — work
-- physically moves as soon as we record it).
CREATE OR REPLACE FUNCTION public.create_job_order(p_header jsonb, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_ll public.lead_ladies;
  v_loc public.locations;
  v_ll_id uuid;
  v_loc_id uuid;
  v_date date;
  v_expected date;
  v_number text;
  v_row public.job_orders;
  v_item jsonb;
  v_idx int := 0;
  v_design public.designs;
  v_design_id uuid;
  v_qty numeric;
  v_rate numeric;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  v_ll_id  := nullif(p_header->>'lead_lady_id', '')::uuid;
  v_loc_id := nullif(p_header->>'location_id', '')::uuid;
  v_date     := coalesce((p_header->>'issue_date')::date, current_date);
  v_expected := nullif(p_header->>'expected_return_date', '')::date;
  IF v_ll_id IS NULL THEN RAISE EXCEPTION 'job_order_ll_missing'; END IF;

  SELECT * INTO v_ll FROM public.lead_ladies WHERE id = v_ll_id AND deleted_at IS NULL;
  IF v_ll.id IS NULL THEN RAISE EXCEPTION 'job_order_ll_missing'; END IF;

  IF v_loc_id IS NOT NULL THEN
    SELECT * INTO v_loc FROM public.locations WHERE id = v_loc_id AND deleted_at IS NULL;
    IF v_loc.id IS NULL THEN RAISE EXCEPTION 'job_order_location_missing'; END IF;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'job_order_items_required';
  END IF;

  v_number := public._next_job_order_number(v_date);

  INSERT INTO public.job_orders (
    job_order_number, lead_lady_id, location_id, issue_date, expected_return_date,
    lead_lady_snapshot, location_snapshot, notes, created_by
  ) VALUES (
    v_number, v_ll.id, v_loc.id, v_date, v_expected,
    jsonb_build_object('full_name', v_ll.full_name, 'mobile', v_ll.mobile),
    CASE WHEN v_loc.id IS NULL THEN NULL ELSE jsonb_build_object('name', v_loc.name) END,
    nullif(btrim(p_header->>'notes'), ''),
    v_caller.id
  ) RETURNING * INTO v_row;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_idx := v_idx + 1;
    v_design_id := nullif(v_item->>'design_id', '')::uuid;
    v_qty  := coalesce((v_item->>'qty_issued')::numeric, 0);
    v_rate := coalesce((v_item->>'rate_per_piece')::numeric, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'job_order_qty_required'; END IF;
    IF v_design_id IS NULL THEN RAISE EXCEPTION 'job_order_design_required'; END IF;

    SELECT * INTO v_design FROM public.designs WHERE id = v_design_id AND deleted_at IS NULL;
    IF v_design.id IS NULL THEN RAISE EXCEPTION 'job_order_design_required'; END IF;

    INSERT INTO public.job_order_items (
      job_order_id, line_no, design_id, design_snapshot, qty_issued, rate_per_piece, notes
    ) VALUES (
      v_row.id, v_idx, v_design.id,
      jsonb_build_object(
        'design_number', v_design.design_number,
        'name_en', v_design.name_en,
        'name_gu', v_design.name_gu
      ),
      v_qty, v_rate, nullif(btrim(v_item->>'notes'), '')
    );
  END LOOP;

  RETURN to_jsonb(v_row);
END;
$$;

-- ── add_job_sub_assignment ──────────────────────────────────────────────────
-- LL records that she has handed N pieces of this item to a labourer.
-- Total sub-assigned can't exceed qty_issued (LL doesn't have more to give).
CREATE OR REPLACE FUNCTION public.add_job_sub_assignment(
  p_item_id uuid, p_labourer_id uuid, p_qty numeric, p_date date, p_notes text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_item public.job_order_items;
  v_order public.job_orders;
  v_labourer public.labourers;
  v_already_assigned numeric;
  v_row public.job_sub_assignments;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor','centre_manager') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'job_sub_qty_required'; END IF;

  SELECT * INTO v_item FROM public.job_order_items WHERE id = p_item_id;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  SELECT * INTO v_order FROM public.job_orders WHERE id = v_item.job_order_id AND deleted_at IS NULL;
  IF v_order.id IS NULL OR v_order.status <> 'open' THEN
    RAISE EXCEPTION 'job_order_not_open';
  END IF;

  SELECT * INTO v_labourer FROM public.labourers WHERE id = p_labourer_id AND deleted_at IS NULL;
  IF v_labourer.id IS NULL THEN RAISE EXCEPTION 'job_labourer_missing'; END IF;
  -- Labourer must belong to the same LL who got this work, otherwise we'd
  -- start mis-attributing wages.
  IF v_labourer.lead_lady_id <> v_order.lead_lady_id THEN
    RAISE EXCEPTION 'job_labourer_wrong_ll';
  END IF;

  SELECT coalesce(sum(qty_assigned), 0) INTO v_already_assigned
  FROM public.job_sub_assignments WHERE job_order_item_id = p_item_id;
  IF v_already_assigned + p_qty > v_item.qty_issued + 0.005 THEN
    RAISE EXCEPTION 'job_sub_exceeds_issued';
  END IF;

  INSERT INTO public.job_sub_assignments (
    job_order_item_id, labourer_id, qty_assigned, assigned_date, notes, created_by
  ) VALUES (
    p_item_id, p_labourer_id, p_qty,
    coalesce(p_date, current_date),
    nullif(btrim(p_notes), ''), v_caller.id
  ) RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

-- ── add_job_receipt ─────────────────────────────────────────────────────────
-- Logs finished work coming back. If labourer_id is set, it "credits back"
-- against that labourer's outstanding pile (can't exceed what they have).
-- Aggregate accepted + rejected can't exceed qty_issued for the item.
CREATE OR REPLACE FUNCTION public.add_job_receipt(
  p_item_id uuid, p_labourer_id uuid, p_qty_accepted numeric, p_qty_rejected numeric,
  p_date date, p_notes text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_item public.job_order_items;
  v_order public.job_orders;
  v_labourer public.labourers;
  v_already_received numeric;
  v_per_labourer numeric;
  v_per_labourer_assigned numeric;
  v_row public.job_receipts;
  v_total numeric;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor','centre_manager') THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  IF p_qty_accepted IS NULL THEN p_qty_accepted := 0; END IF;
  IF p_qty_rejected IS NULL THEN p_qty_rejected := 0; END IF;
  IF p_qty_accepted < 0 OR p_qty_rejected < 0 THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  v_total := p_qty_accepted + p_qty_rejected;
  IF v_total <= 0 THEN RAISE EXCEPTION 'job_receipt_qty_required'; END IF;

  SELECT * INTO v_item FROM public.job_order_items WHERE id = p_item_id;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

  SELECT * INTO v_order FROM public.job_orders WHERE id = v_item.job_order_id AND deleted_at IS NULL;
  IF v_order.id IS NULL OR v_order.status <> 'open' THEN
    RAISE EXCEPTION 'job_order_not_open';
  END IF;

  IF p_labourer_id IS NOT NULL THEN
    SELECT * INTO v_labourer FROM public.labourers WHERE id = p_labourer_id AND deleted_at IS NULL;
    IF v_labourer.id IS NULL THEN RAISE EXCEPTION 'job_labourer_missing'; END IF;
    IF v_labourer.lead_lady_id <> v_order.lead_lady_id THEN
      RAISE EXCEPTION 'job_labourer_wrong_ll';
    END IF;

    -- Per-labourer guard: receipts against this labourer can't exceed what
    -- was sub-assigned to them (minus what they've already returned).
    SELECT coalesce(sum(qty_assigned), 0) INTO v_per_labourer_assigned
    FROM public.job_sub_assignments
    WHERE job_order_item_id = p_item_id AND labourer_id = p_labourer_id;

    SELECT coalesce(sum(qty_accepted + qty_rejected), 0) INTO v_per_labourer
    FROM public.job_receipts
    WHERE job_order_item_id = p_item_id AND labourer_id = p_labourer_id;

    IF v_per_labourer + v_total > v_per_labourer_assigned + 0.005 THEN
      RAISE EXCEPTION 'job_receipt_exceeds_labourer';
    END IF;
  END IF;

  -- Global guard: total received across all receipts can't exceed qty_issued.
  SELECT coalesce(sum(qty_accepted + qty_rejected), 0) INTO v_already_received
  FROM public.job_receipts WHERE job_order_item_id = p_item_id;
  IF v_already_received + v_total > v_item.qty_issued + 0.005 THEN
    RAISE EXCEPTION 'job_receipt_exceeds_issued';
  END IF;

  INSERT INTO public.job_receipts (
    job_order_item_id, labourer_id, qty_accepted, qty_rejected,
    receipt_date, notes, created_by
  ) VALUES (
    p_item_id, p_labourer_id, p_qty_accepted, p_qty_rejected,
    coalesce(p_date, current_date),
    nullif(btrim(p_notes), ''), v_caller.id
  ) RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

-- ── close_job_order ─────────────────────────────────────────────────────────
-- Manual close (the user marks the batch finished, e.g. when LL drops off
-- the last lot). We don't auto-close on full receipt because in practice some
-- pieces stay open as long-term outstanding.
CREATE OR REPLACE FUNCTION public.close_job_order(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.job_orders;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');
  SELECT * INTO v_row FROM public.job_orders WHERE id = p_id AND deleted_at IS NULL;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_row.status <> 'open' THEN RAISE EXCEPTION 'job_order_not_open'; END IF;
  UPDATE public.job_orders SET status = 'closed', closed_at = now() WHERE id = p_id
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_job_order(p_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.job_orders;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, p_reason);
  SELECT * INTO v_row FROM public.job_orders WHERE id = p_id AND deleted_at IS NULL;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_row.status = 'cancelled' THEN RAISE EXCEPTION 'job_order_already_cancelled'; END IF;
  UPDATE public.job_orders SET status = 'cancelled', cancelled_at = now(),
    cancelled_by = v_caller.id, cancellation_reason = nullif(btrim(p_reason), '')
  WHERE id = p_id RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

-- ── Per-item balances view ──────────────────────────────────────────────────
-- For every item:
--   qty_sub_assigned        = sum of sub-assignment qty (work the LL has given out)
--   qty_received_attributed = receipts where labourer_id is set (labourer brought back)
--   qty_received_direct     = receipts where labourer_id is null (LL did it directly)
--   qty_at_labourer         = sub_assigned − received_attributed
--   qty_at_ll               = qty_issued − sub_assigned − received_direct
--   qty_accepted / qty_rejected = totals across all receipts
DROP VIEW IF EXISTS public.job_order_item_balances;
CREATE VIEW public.job_order_item_balances AS
SELECT
  i.id AS job_order_item_id,
  i.job_order_id,
  i.design_id,
  i.qty_issued,
  i.rate_per_piece,
  coalesce(sa.qty_sub_assigned, 0)::numeric(12, 2) AS qty_sub_assigned,
  coalesce(ra.qty_accepted, 0)::numeric(12, 2) AS qty_accepted,
  coalesce(ra.qty_rejected, 0)::numeric(12, 2) AS qty_rejected,
  greatest(0, coalesce(sa.qty_sub_assigned, 0) - coalesce(ra.qty_received_attributed, 0))::numeric(12, 2) AS qty_at_labourer,
  greatest(0, i.qty_issued - coalesce(sa.qty_sub_assigned, 0) - coalesce(ra.qty_received_direct, 0))::numeric(12, 2) AS qty_at_ll,
  (coalesce(ra.qty_accepted, 0) * i.rate_per_piece)::numeric(14, 2) AS wages_owed
FROM public.job_order_items i
LEFT JOIN (
  SELECT job_order_item_id, sum(qty_assigned) AS qty_sub_assigned
  FROM public.job_sub_assignments GROUP BY job_order_item_id
) sa ON sa.job_order_item_id = i.id
LEFT JOIN (
  SELECT
    job_order_item_id,
    sum(qty_accepted) AS qty_accepted,
    sum(qty_rejected) AS qty_rejected,
    sum(CASE WHEN labourer_id IS NOT NULL THEN qty_accepted + qty_rejected ELSE 0 END) AS qty_received_attributed,
    sum(CASE WHEN labourer_id IS NULL THEN qty_accepted + qty_rejected ELSE 0 END) AS qty_received_direct
  FROM public.job_receipts GROUP BY job_order_item_id
) ra ON ra.job_order_item_id = i.id;

GRANT EXECUTE ON FUNCTION public.create_job_order(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_job_sub_assignment(uuid, uuid, numeric, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_job_receipt(uuid, uuid, numeric, numeric, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_job_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_job_order(uuid, text) TO authenticated;
