-- WS-B migration 7/8: design-images Storage bucket + RLS on storage.objects.
-- Bucket is private; clients render images via short-lived signed URLs.
-- Path convention (per ADR-007): '<design_id>/<random>.<ext>'.
--
-- RLS policies are defence-in-depth — server actions upload via the service-role
-- client, which bypasses RLS — but the policies stop a client-side direct upload
-- attempt cold.

INSERT INTO storage.buckets (id, name, public)
VALUES ('design-images', 'design-images', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "authenticated read design-images" ON storage.objects;
CREATE POLICY "authenticated read design-images" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'design-images' AND auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "super_admin or supervisor write design-images" ON storage.objects;
CREATE POLICY "super_admin or supervisor write design-images" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'design-images'
    AND EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "super_admin or supervisor update design-images" ON storage.objects;
CREATE POLICY "super_admin or supervisor update design-images" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'design-images'
    AND EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "super_admin or supervisor delete design-images" ON storage.objects;
CREATE POLICY "super_admin or supervisor delete design-images" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'design-images'
    AND EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );
