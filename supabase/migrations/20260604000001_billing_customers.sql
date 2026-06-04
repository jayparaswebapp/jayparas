-- Billing customers (buyer master).
-- Shared across rakhi (no-GST) and kite (GST) business lines, so GSTIN/PAN are
-- optional. Mobile is uniquely constrained among non-deleted rows so historical
-- contact info is preserved on soft-delete; GSTIN is uniquely constrained the
-- same way among non-null, non-deleted rows.

CREATE TABLE IF NOT EXISTS public.billing_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  business_name text,
  mobile text NOT NULL,
  email text,
  gstin text,
  pan text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  pincode text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES public.app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_customers_mobile_active
  ON public.billing_customers(mobile)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_customers_gstin_active
  ON public.billing_customers(gstin)
  WHERE deleted_at IS NULL AND gstin IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_customers_full_name
  ON public.billing_customers(full_name);

DROP TRIGGER IF EXISTS trg_billing_customers_updated_at ON public.billing_customers;
CREATE TRIGGER trg_billing_customers_updated_at
  BEFORE UPDATE ON public.billing_customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.billing_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read billing_customers" ON public.billing_customers;
CREATE POLICY "authenticated read billing_customers" ON public.billing_customers
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "super_admin or supervisor write billing_customers" ON public.billing_customers;
CREATE POLICY "super_admin or supervisor write billing_customers" ON public.billing_customers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );

REVOKE SELECT ON public.billing_customers FROM anon;

DROP TRIGGER IF EXISTS audit_billing_customers ON public.billing_customers;
CREATE TRIGGER audit_billing_customers
  AFTER INSERT OR UPDATE OR DELETE ON public.billing_customers
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
