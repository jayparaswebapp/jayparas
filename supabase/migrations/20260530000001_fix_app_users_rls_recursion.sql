-- Fix infinite recursion in app_users RLS.
--
-- The original "super_admin full access" policy on app_users contained a
-- subquery against app_users itself, so evaluating it required re-evaluating
-- it. Postgres detects this and aborts with
--   "infinite recursion detected in policy for relation \"app_users\"".
--
-- Move the role lookup into a SECURITY DEFINER helper that bypasses RLS,
-- and rewrite the policy to call it.

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users
    WHERE auth_user_id = auth.uid()
      AND role = 'super_admin'
      AND deleted_at IS NULL
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

DROP POLICY IF EXISTS "super_admin full access" ON public.app_users;
CREATE POLICY "super_admin full access"
  ON public.app_users
  USING (public.is_super_admin());
