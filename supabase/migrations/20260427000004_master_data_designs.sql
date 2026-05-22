-- WS-B migration 4/8: designs catalogue.
-- design_number is unique among non-deleted rows (so deleted numbers can be reused).
-- image_path holds a relative path inside the 'design-images' Storage bucket; nullable.

CREATE TABLE IF NOT EXISTS public.designs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_number text NOT NULL,
  name_en text,
  name_gu text,
  current_rate_per_guss numeric(10,2) NOT NULL CHECK (current_rate_per_guss > 0),
  image_path text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid REFERENCES public.app_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_designs_design_number_active
  ON public.designs(design_number)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_designs_updated_at ON public.designs;
CREATE TRIGGER trg_designs_updated_at
  BEFORE UPDATE ON public.designs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.designs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read designs" ON public.designs;
CREATE POLICY "authenticated read designs" ON public.designs
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "super_admin or supervisor write designs" ON public.designs;
CREATE POLICY "super_admin or supervisor write designs" ON public.designs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );

REVOKE SELECT ON public.designs FROM anon;
