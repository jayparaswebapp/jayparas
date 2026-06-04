-- Customer groups: a route-planning bucket inside a city.
-- E.g. group "Station Road" in city "Surat" — every customer assigned to
-- that group is on the same road so a delivery run can hit them together.
--
-- (city, name) is uniquely constrained among non-deleted rows. Different
-- cities can reuse the same group name (e.g. "Main Bazar" in two cities).

CREATE TABLE IF NOT EXISTS public.customer_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text NOT NULL,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES public.app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_groups_city_name_active
  ON public.customer_groups(city, name)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_groups_city
  ON public.customer_groups(city);

DROP TRIGGER IF EXISTS trg_customer_groups_updated_at ON public.customer_groups;
CREATE TRIGGER trg_customer_groups_updated_at
  BEFORE UPDATE ON public.customer_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.customer_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read customer_groups" ON public.customer_groups;
CREATE POLICY "authenticated read customer_groups" ON public.customer_groups
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "super_admin or supervisor write customer_groups" ON public.customer_groups;
CREATE POLICY "super_admin or supervisor write customer_groups" ON public.customer_groups
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );

REVOKE SELECT ON public.customer_groups FROM anon;

DROP TRIGGER IF EXISTS audit_customer_groups ON public.customer_groups;
CREATE TRIGGER audit_customer_groups
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_groups
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

-- Wire customer → group.
ALTER TABLE public.billing_customers
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.customer_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_billing_customers_group_id
  ON public.billing_customers(group_id)
  WHERE deleted_at IS NULL;
