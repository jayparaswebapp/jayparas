import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale } from '@/lib/format/locale';
import { getSkuPhotoPublicUrl } from '@/lib/storage/sku-photos';
import { SkuLibraryView, type SkuRow } from './library-view';

export const dynamic = 'force-dynamic';

export default async function SkusLibraryPage() {
  const user = await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const { data: rows } = await supabase
    .from('skus')
    .select(
      'id, sku_code, pack_type, design_no, mix_code, design_name, pack_size, price, photo_path, is_active',
    )
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  const skus = (
    (rows ?? []) as Array<Omit<SkuRow, 'photo_url'> & { photo_path: string | null }>
  ).map((r) => ({
    id: r.id,
    sku_code: r.sku_code,
    pack_type: r.pack_type as 'single' | 'mix',
    design_no: r.design_no,
    mix_code: r.mix_code,
    design_name: r.design_name,
    pack_size: r.pack_size,
    price: Number(r.price),
    is_active: r.is_active,
    photo_url: getSkuPhotoPublicUrl(supabase, r.photo_path),
  })) satisfies SkuRow[];

  const canWrite = user.role === 'super_admin' || user.role === 'supervisor';

  return <SkuLibraryView skus={skus} canWrite={canWrite} locale={locale} />;
}
