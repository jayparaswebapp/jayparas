-- WS-B migration 2/8: lead_ladies + lead_lady_locations (M:N to locations).
-- Mobile is uniquely constrained among non-deleted rows (per workstream brief Q&A).
-- Soft-delete preserves historical mobile so we can audit prior assignments.

CREATE TABLE IF NOT EXISTS public.lead_ladies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  mobile text NOT NULL,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES public.app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_ladies_mobile_active
  ON public.lead_ladies(mobile)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_lead_ladies_updated_at ON public.lead_ladies;
CREATE TRIGGER trg_lead_ladies_updated_at
  BEFORE UPDATE ON public.lead_ladies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.lead_lady_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_lady_id uuid NOT NULL REFERENCES public.lead_ladies(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_lady_location_unique UNIQUE (lead_lady_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_lady_locations_location
  ON public.lead_lady_locations(location_id);

ALTER TABLE public.lead_ladies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_lady_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read lead_ladies" ON public.lead_ladies;
CREATE POLICY "authenticated read lead_ladies" ON public.lead_ladies
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "super_admin or supervisor write lead_ladies" ON public.lead_ladies;
CREATE POLICY "super_admin or supervisor write lead_ladies" ON public.lead_ladies
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "authenticated read lead_lady_locations" ON public.lead_lady_locations;
CREATE POLICY "authenticated read lead_lady_locations" ON public.lead_lady_locations
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "super_admin or supervisor write lead_lady_locations" ON public.lead_lady_locations;
CREATE POLICY "super_admin or supervisor write lead_lady_locations" ON public.lead_lady_locations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );

REVOKE SELECT ON public.lead_ladies         FROM anon;
REVOKE SELECT ON public.lead_lady_locations FROM anon;
