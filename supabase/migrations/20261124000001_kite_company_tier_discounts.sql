-- =========================================================================
-- Kite: discount by party type, set once per company (agreed 2026-11-24).
--
--   kite_companies.disc_a / disc_b / disc_c = % for A (wholesaler),
--   B (semi-wholesaler), C (retailer) parties. A party gets its type's % for
--   that company automatically. A % typed on the party itself
--   (customer_company_discounts) overrides it for that party only.
--
-- Bill / order lines keep their own discount, so changing these later never
-- touches a bill or order already made.
-- =========================================================================

ALTER TABLE public.kite_companies
  ADD COLUMN IF NOT EXISTS disc_a numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disc_b numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disc_c numeric(5,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.kite_companies ADD CONSTRAINT kite_companies_disc_chk CHECK (
    disc_a BETWEEN 0 AND 100 AND disc_b BETWEEN 0 AND 100 AND disc_c BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP FUNCTION IF EXISTS public.save_kite_company(uuid, text, boolean, text);

-- NULL disc_* = keep the current value.
CREATE OR REPLACE FUNCTION public.save_kite_company(
  p_id uuid,            -- NULL = create
  p_name text,
  p_is_active boolean,
  p_reason text,
  p_disc_a numeric DEFAULT NULL,
  p_disc_b numeric DEFAULT NULL,
  p_disc_c numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.kite_companies;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF coalesce(p_disc_a, 0) NOT BETWEEN 0 AND 100
     OR coalesce(p_disc_b, 0) NOT BETWEEN 0 AND 100
     OR coalesce(p_disc_c, 0) NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, false);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);
  BEGIN
    IF p_id IS NULL THEN
      INSERT INTO public.kite_companies (name, created_by, disc_a, disc_b, disc_c)
      VALUES (btrim(p_name), v_caller.id,
              coalesce(p_disc_a, 0), coalesce(p_disc_b, 0), coalesce(p_disc_c, 0))
      RETURNING * INTO v_row;
    ELSE
      UPDATE public.kite_companies
        SET name = btrim(p_name), is_active = coalesce(p_is_active, true),
            disc_a = coalesce(p_disc_a, disc_a),
            disc_b = coalesce(p_disc_b, disc_b),
            disc_c = coalesce(p_disc_c, disc_c)
        WHERE id = p_id AND deleted_at IS NULL RETURNING * INTO v_row;
      IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
    END IF;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'company_name_taken';
  END;
  RETURN to_jsonb(v_row);
END; $$;

REVOKE EXECUTE ON FUNCTION
  public.save_kite_company(uuid, text, boolean, text, numeric, numeric, numeric)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.save_kite_company(uuid, text, boolean, text, numeric, numeric, numeric)
TO authenticated;
