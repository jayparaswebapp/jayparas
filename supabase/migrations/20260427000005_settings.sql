-- WS-B migration 5/8: settings singleton key-value table + seed.
-- Five business constants. season_start_month carries is_locked=true so the UI
-- renders it read-only — it can only be changed via direct SQL because doing so
-- would invalidate historical incentive_accruals.

CREATE TABLE IF NOT EXISTS public.settings (
  key text PRIMARY KEY,
  value_numeric numeric NOT NULL,
  description text NOT NULL,
  is_locked boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.app_users(id)
);

DROP TRIGGER IF EXISTS trg_settings_updated_at ON public.settings;
CREATE TRIGGER trg_settings_updated_at
  BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.settings (key, value_numeric, description, is_locked) VALUES
  ('weight_loss_tolerance_pct', 5.0,  'Soft-flag jobs whose weight loss exceeds this percentage', false),
  ('dozen_multiplier',          1.5,  'Multiplier for dozen quantity in labour calculation',     false),
  ('sla_days',                  20,   'Job-work deadline in days from issue',                    false),
  ('incentive_pct',             15.0, 'Lead lady annual incentive as % of total labour',         false),
  ('season_start_month',        8,    'Calendar month the rakhi season starts (1-12)',           true)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read settings" ON public.settings;
CREATE POLICY "authenticated read settings" ON public.settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "super_admin update unlocked settings" ON public.settings;
CREATE POLICY "super_admin update unlocked settings" ON public.settings
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role = 'super_admin'
        AND a.deleted_at IS NULL
    )
    AND is_locked = false
  );

REVOKE SELECT ON public.settings FROM anon;
