-- SECURITY DEFINER RPCs for billing_customers.
-- Mirrors the lead_ladies pattern: caller derived from auth.uid(), role +
-- reason rules enforced via shared helpers, audit context bound in the same
-- transaction so triggers capture changed_by + reason.
--
-- New error key: gstin_taken — unique violation on the partial gstin index.

CREATE OR REPLACE FUNCTION public.create_billing_customer(
  p_full_name text,
  p_business_name text,
  p_mobile text,
  p_email text,
  p_gstin text,
  p_pan text,
  p_address_line1 text,
  p_address_line2 text,
  p_city text,
  p_state text,
  p_pincode text,
  p_notes text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.billing_customers;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, false);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  BEGIN
    INSERT INTO public.billing_customers (
      full_name, business_name, mobile, email, gstin, pan,
      address_line1, address_line2, city, state, pincode,
      notes, created_by
    )
    VALUES (
      btrim(p_full_name),
      nullif(btrim(p_business_name),''),
      btrim(p_mobile),
      nullif(btrim(p_email),''),
      nullif(upper(btrim(p_gstin)),''),
      nullif(upper(btrim(p_pan)),''),
      nullif(btrim(p_address_line1),''),
      nullif(btrim(p_address_line2),''),
      nullif(btrim(p_city),''),
      nullif(btrim(p_state),''),
      nullif(btrim(p_pincode),''),
      nullif(btrim(p_notes),''),
      v_caller.id
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM LIKE '%idx_billing_customers_gstin_active%' THEN
      RAISE EXCEPTION 'gstin_taken';
    ELSE
      RAISE EXCEPTION 'mobile_taken';
    END IF;
  END;

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_billing_customer(
  p_id uuid,
  p_full_name text,
  p_business_name text,
  p_mobile text,
  p_email text,
  p_gstin text,
  p_pan text,
  p_address_line1 text,
  p_address_line2 text,
  p_city text,
  p_state text,
  p_pincode text,
  p_notes text,
  p_is_active boolean,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.billing_customers;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, false);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  BEGIN
    UPDATE public.billing_customers
    SET full_name = btrim(p_full_name),
        business_name = nullif(btrim(p_business_name),''),
        mobile = btrim(p_mobile),
        email = nullif(btrim(p_email),''),
        gstin = nullif(upper(btrim(p_gstin)),''),
        pan = nullif(upper(btrim(p_pan)),''),
        address_line1 = nullif(btrim(p_address_line1),''),
        address_line2 = nullif(btrim(p_address_line2),''),
        city = nullif(btrim(p_city),''),
        state = nullif(btrim(p_state),''),
        pincode = nullif(btrim(p_pincode),''),
        notes = nullif(btrim(p_notes),''),
        is_active = p_is_active
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM LIKE '%idx_billing_customers_gstin_active%' THEN
      RAISE EXCEPTION 'gstin_taken';
    ELSE
      RAISE EXCEPTION 'mobile_taken';
    END IF;
  END;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_billing_customer(p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.billing_customers;
BEGIN
  IF v_caller.role NOT IN ('super_admin','supervisor') THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, true);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  UPDATE public.billing_customers
  SET deleted_at = now(), is_active = false
  WHERE id = p_id AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_billing_customer(p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller public.app_users := public._current_app_user();
  v_row public.billing_customers;
BEGIN
  IF v_caller.role <> 'super_admin' THEN RAISE EXCEPTION 'permission_denied'; END IF;
  PERFORM public._validate_reason(v_caller.role, p_reason, true);
  PERFORM public._bind_audit_context(v_caller.id, p_reason);

  BEGIN
    UPDATE public.billing_customers
    SET deleted_at = NULL, is_active = true
    WHERE id = p_id AND deleted_at IS NOT NULL
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM LIKE '%idx_billing_customers_gstin_active%' THEN
      RAISE EXCEPTION 'gstin_taken';
    ELSE
      RAISE EXCEPTION 'mobile_taken';
    END IF;
  END;

  IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_billing_customer(text, text, text, text, text, text, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_billing_customer(uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_billing_customer(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_billing_customer(uuid, text) TO authenticated;
