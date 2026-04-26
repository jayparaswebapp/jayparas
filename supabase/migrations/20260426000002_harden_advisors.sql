-- Address Supabase security advisor warnings from the initial migration:
-- 1. Pin search_path on set_updated_at (function_search_path_mutable).
-- 2. Revoke anon SELECT on app_users + login_attempts so they're not visible
--    via the public /graphql/v1 introspection endpoint (pg_graphql_anon_table_exposed).
--    RLS already prevents row reads; this hides the schema too. We use PostgREST
--    REST + the auth admin API, never GraphQL.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE SELECT ON public.app_users FROM anon;
REVOKE SELECT ON public.login_attempts FROM anon;
REVOKE ALL ON public.login_attempts FROM authenticated;
