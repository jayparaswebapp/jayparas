-- Default HSN code + GST % per product group, auto-filled onto kite bill
-- lines. Bill lines keep their own copy (invoice_lines.hsn_code / gst_pct),
-- so changing a group's defaults later never changes a bill already made.
--
-- save_product_group gains two optional params. NULL = "not sent" → keep the
-- current value on update (and '' / 0 on create), so the existing Kite setup
-- screen, which sends 5 args, keeps working unchanged until its code updates.

ALTER TABLE public.product_groups
  ADD COLUMN IF NOT EXISTS hsn_code text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS gst_pct numeric(5,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.product_groups
    ADD CONSTRAINT product_groups_gst_range CHECK (gst_pct >= 0 AND gst_pct <= 28);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP FUNCTION IF EXISTS public.save_product_group(uuid, text, uuid, boolean, text);

CREATE OR REPLACE FUNCTION public.save_product_group(
  p_id uuid,            -- NULL = create
  p_name text,
  p_company_id uuid,
  p_is_active boolean,
  p_reason text,
  p_hsn_code text DEFAULT NULL,   -- NULL = keep current
  p_gst_pct numeric DEFAULT NULL  -- NULL = keep current
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.product_groups;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF p_gst_pct IS NOT NULL AND (p_gst_pct < 0 OR p_gst_pct > 28) THEN RAISE EXCEPTION 'invalid_input'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kite_companies WHERE id = p_company_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, false);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);
  BEGIN
    IF p_id IS NULL THEN
      INSERT INTO public.product_groups (name, company_id, hsn_code, gst_pct, created_by)
      VALUES (btrim(p_name), p_company_id, coalesce(btrim(p_hsn_code), ''),
              coalesce(p_gst_pct, 0), v_caller.id)
      RETURNING * INTO v_row;
    ELSE
      UPDATE public.product_groups
        SET name = btrim(p_name),
            company_id = p_company_id,
            is_active = coalesce(p_is_active, true),
            hsn_code = coalesce(btrim(p_hsn_code), hsn_code),
            gst_pct = coalesce(p_gst_pct, gst_pct)
        WHERE id = p_id AND deleted_at IS NULL RETURNING * INTO v_row;
      IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
    END IF;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'group_name_taken';
  END;
  RETURN to_jsonb(v_row);
END; $$;

REVOKE EXECUTE ON FUNCTION public.save_product_group(uuid, text, uuid, boolean, text, text, numeric)
  FROM anon, public;
GRANT EXECUTE ON FUNCTION public.save_product_group(uuid, text, uuid, boolean, text, text, numeric)
  TO authenticated;
