-- WS-E1 migration 2/3: sku-photos Storage bucket.
--
-- Public bucket at v1 (rakhi product photos are low-sensitivity; keeps display
-- simple via public URL — no signing round-trip on the library grid). Can
-- tighten to private + signed URLs later without schema change.
-- See ADR-009 and docs/data-model-inventory.md §2.
--
-- Path convention: <random_hex_4>/<random_hex_12>.<ext>
-- (mirrors design-images per ADR-007; decoupled from sku_id so the photo can
-- be uploaded client-side before the row exists, sidestepping the 1 MB
-- server-action body limit.)
--
-- RLS on storage.objects is defence-in-depth: server actions use a session
-- client that respects RLS, so writes get rejected at the storage layer if
-- the caller's role isn't super_admin/supervisor.

INSERT INTO storage.buckets (id, name, public)
VALUES ('sku-photos', 'sku-photos', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Public bucket: anyone can read object bytes via the public URL. We don't
-- add a SELECT policy here because public buckets bypass storage.objects RLS
-- for object reads via Supabase's storage API.

DROP POLICY IF EXISTS "super_admin or supervisor write sku-photos" ON storage.objects;
CREATE POLICY "super_admin or supervisor write sku-photos" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'sku-photos'
    AND EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "super_admin or supervisor update sku-photos" ON storage.objects;
CREATE POLICY "super_admin or supervisor update sku-photos" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'sku-photos'
    AND EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "super_admin or supervisor delete sku-photos" ON storage.objects;
CREATE POLICY "super_admin or supervisor delete sku-photos" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'sku-photos'
    AND EXISTS (
      SELECT 1 FROM public.app_users a
      WHERE a.auth_user_id = auth.uid()
        AND a.role IN ('super_admin','supervisor')
        AND a.deleted_at IS NULL
    )
  );
