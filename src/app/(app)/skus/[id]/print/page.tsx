import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { DEFAULT_LABEL_GRID } from '@/lib/skus/label-grid';

export const dynamic = 'force-dynamic';

/**
 * Single-SKU "Print label" entry point — staff press this on the detail
 * page. One sticker per click (no more 2-up wasted-pair behaviour). The
 * actual rendering happens on /skus/print/sheet so the print pipeline
 * stays in one place.
 */
export default async function SkuSinglePrintRedirect({ params }: { params: { id: string } }) {
  await requireAppUser();
  const supabase = createClient();
  const { data: row } = await supabase
    .from('skus')
    .select('id')
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!row) notFound();

  redirect(`/skus/print/sheet?items=${row.id}:${DEFAULT_LABEL_GRID.columns}`);
}
