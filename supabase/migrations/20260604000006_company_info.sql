-- Company / seller info, snapshotted into every issued invoice.
-- Singleton table: at most one row, enforced by a partial unique index on a
-- constant expression so the app always has one logical place to read from.

CREATE TABLE IF NOT EXISTS public.company_info (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  pincode text,
  gstin text,
  pan text,
  mobile text,
  email text,
  bank_name text,
  bank_account_no text,
  bank_ifsc text,
  default_terms text,
  default_due_days integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_info_singleton
  ON public.company_info ((true));

DROP TRIGGER IF EXISTS trg_company_info_updated_at ON public.company_info;
CREATE TRIGGER trg_company_info_updated_at
  BEFORE UPDATE ON public.company_info
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.company_info ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read company_info" ON public.company_info;
CREATE POLICY "authenticated read company_info" ON public.company_info
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "super_admin writes company_info" ON public.company_info;
CREATE POLICY "super_admin writes company_info" ON public.company_info
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role = 'super_admin'
        AND a.deleted_at IS NULL
    )
  );

REVOKE SELECT ON public.company_info FROM anon;

DROP TRIGGER IF EXISTS audit_company_info ON public.company_info;
CREATE TRIGGER audit_company_info
  AFTER INSERT OR UPDATE OR DELETE ON public.company_info
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

-- Upsert RPC — caller always works on the singleton.
CREATE OR REPLACE FUNCTION public.upsert_company_info(
  p_legal_name text,
  p_address_line1 text,
  p_address_line2 text,
  p_city text,
  p_state text,
  p_pincode text,
  p_gstin text,
  p_pan text,
  p_mobile text,
  p_email text,
  p_bank_name text,
  p_bank_account_no text,
  p_bank_ifsc text,
  p_default_terms text,
  p_default_due_days integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.company_info;
  v_existing_id uuid;
BEGIN
  IF v_caller.role <> 'super_admin' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._bind_audit_context(v_caller.id, '');

  SELECT id INTO v_existing_id FROM public.company_info LIMIT 1;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.company_info (
      legal_name, address_line1, address_line2, city, state, pincode,
      gstin, pan, mobile, email,
      bank_name, bank_account_no, bank_ifsc, default_terms, default_due_days, created_by
    )
    VALUES (
      btrim(p_legal_name),
      nullif(btrim(p_address_line1), ''),
      nullif(btrim(p_address_line2), ''),
      nullif(btrim(p_city), ''),
      nullif(btrim(p_state), ''),
      nullif(btrim(p_pincode), ''),
      nullif(upper(btrim(p_gstin)), ''),
      nullif(upper(btrim(p_pan)), ''),
      nullif(btrim(p_mobile), ''),
      nullif(btrim(p_email), ''),
      nullif(btrim(p_bank_name), ''),
      nullif(btrim(p_bank_account_no), ''),
      nullif(upper(btrim(p_bank_ifsc)), ''),
      nullif(btrim(p_default_terms), ''),
      coalesce(p_default_due_days, 0),
      v_caller.id
    )
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.company_info
    SET legal_name = btrim(p_legal_name),
        address_line1 = nullif(btrim(p_address_line1), ''),
        address_line2 = nullif(btrim(p_address_line2), ''),
        city = nullif(btrim(p_city), ''),
        state = nullif(btrim(p_state), ''),
        pincode = nullif(btrim(p_pincode), ''),
        gstin = nullif(upper(btrim(p_gstin)), ''),
        pan = nullif(upper(btrim(p_pan)), ''),
        mobile = nullif(btrim(p_mobile), ''),
        email = nullif(btrim(p_email), ''),
        bank_name = nullif(btrim(p_bank_name), ''),
        bank_account_no = nullif(btrim(p_bank_account_no), ''),
        bank_ifsc = nullif(upper(btrim(p_bank_ifsc)), ''),
        default_terms = nullif(btrim(p_default_terms), ''),
        default_due_days = coalesce(p_default_due_days, 0)
    WHERE id = v_existing_id
    RETURNING * INTO v_row;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_company_info(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text, integer
) TO authenticated;
