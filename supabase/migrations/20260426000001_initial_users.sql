-- Foundation migration (WS-A): app_users, role enum, login attempts, RLS, trigger.
-- All other business tables come in WS-B.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Generic updated_at trigger function reused across the schema.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Roles
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM (
      'super_admin',
      'supervisor',
      'centre_manager',
      'accountant'
    );
  END IF;
END$$;

-- app_users
CREATE TABLE IF NOT EXISTS public.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  mobile text UNIQUE NOT NULL,
  role user_role NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_app_users_mobile
  ON public.app_users (mobile)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_app_users_updated_at ON public.app_users;
CREATE TRIGGER trg_app_users_updated_at
  BEFORE UPDATE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can read own row" ON public.app_users;
CREATE POLICY "users can read own row"
  ON public.app_users
  FOR SELECT
  USING (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS "super_admin full access" ON public.app_users;
CREATE POLICY "super_admin full access"
  ON public.app_users
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role = 'super_admin'
        AND a.deleted_at IS NULL
    )
  );

-- login_attempts: simple per-mobile rate-limit ledger.
-- Read/written only by the service-role client (no RLS policies = no anon access).
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile text NOT NULL,
  success boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_mobile_time
  ON public.login_attempts (mobile, attempted_at DESC);

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies; only the service role bypasses RLS.
