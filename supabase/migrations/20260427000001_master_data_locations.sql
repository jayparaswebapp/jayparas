-- WS-B migration 1/8: locations master table + seed.
-- Locations are seeded at install. Super-admin can edit names + is_active.
-- Add/delete deliberately not supported in v1 (per workstream decision D).

CREATE TABLE IF NOT EXISTS public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en text NOT NULL,
  name_gu text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT locations_name_en_unique UNIQUE (name_en),
  CONSTRAINT locations_name_gu_unique UNIQUE (name_gu)
);

DROP TRIGGER IF EXISTS trg_locations_updated_at ON public.locations;
CREATE TRIGGER trg_locations_updated_at
  BEFORE UPDATE ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed the six job-work villages.
INSERT INTO public.locations (name_en, name_gu) VALUES
  ('Atgam',      'આટગામ'),
  ('Khergam',    'ખેરગામ'),
  ('Arnala',     'અરનાળા'),
  ('Ambheti',    'આંબેટી'),
  ('Jashoda',    'જશોદા'),
  ('Vaghchhipa', 'વાઘછીપા')
ON CONFLICT (name_en) DO NOTHING;

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read locations" ON public.locations;
CREATE POLICY "authenticated read locations" ON public.locations
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "super_admin update locations" ON public.locations;
CREATE POLICY "super_admin update locations" ON public.locations
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role = 'super_admin'
        AND a.deleted_at IS NULL
    )
  );

-- Hide schema from anon /graphql/v1 introspection (defence-in-depth; we don't use GraphQL).
REVOKE SELECT ON public.locations FROM anon;
