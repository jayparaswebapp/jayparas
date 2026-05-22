-- WS-B migration 3/8: centre_manager_locations.
-- Many-to-many between centre managers (a subset of app_users) and locations.
-- Role membership is enforced by trigger because CHECK can't reference other tables.

CREATE TABLE IF NOT EXISTS public.centre_manager_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT centre_manager_location_unique UNIQUE (app_user_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_centre_manager_locations_user
  ON public.centre_manager_locations(app_user_id);
CREATE INDEX IF NOT EXISTS idx_centre_manager_locations_location
  ON public.centre_manager_locations(location_id);

CREATE OR REPLACE FUNCTION public.enforce_centre_manager_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE id = NEW.app_user_id
      AND role = 'centre_manager'
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'app_user_id must reference an active centre_manager';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_centre_manager_role_trg ON public.centre_manager_locations;
CREATE TRIGGER enforce_centre_manager_role_trg
  BEFORE INSERT OR UPDATE ON public.centre_manager_locations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_centre_manager_role();

ALTER TABLE public.centre_manager_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read centre_manager_locations" ON public.centre_manager_locations;
CREATE POLICY "authenticated read centre_manager_locations" ON public.centre_manager_locations
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "super_admin write centre_manager_locations" ON public.centre_manager_locations;
CREATE POLICY "super_admin write centre_manager_locations" ON public.centre_manager_locations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role = 'super_admin'
        AND a.deleted_at IS NULL
    )
  );

REVOKE SELECT ON public.centre_manager_locations FROM anon;
