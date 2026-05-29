import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale } from '@/lib/format/locale';
import { getSkuPhotoPublicUrl } from '@/lib/storage/sku-photos';
import { PrintPicker, type PickerRow } from './print-picker';

export const dynamic = 'force-dynamic';

export default async function PrintPickerPage() {
  await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const { data: rows } = await supabase
    .from('skus')
    .select(
      'id, sku_code, pack_type, design_no, mix_code, design_name, pack_size, price, photo_path, is_active',
    )
    .is('deleted_at', null)
    .eq('is_active', true)
    .order('design_name', { ascending: true });

  const skus = (
    (rows ?? []) as Array<Omit<PickerRow, 'photo_url'> & { photo_path: string | null }>
  ).map((r) => ({
    id: r.id,
    sku_code: r.sku_code,
    pack_type: r.pack_type as 'single' | 'mix',
    design_no: r.design_no,
    mix_code: r.mix_code,
    design_name: r.design_name,
    pack_size: r.pack_size,
    price: Number(r.price),
    photo_url: getSkuPhotoPublicUrl(supabase, r.photo_path),
  })) satisfies PickerRow[];

  return <PrintPicker skus={skus} locale={locale} />;
}
