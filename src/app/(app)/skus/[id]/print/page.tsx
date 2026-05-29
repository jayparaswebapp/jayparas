import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { DEFAULT_LABEL_GRID } from '@/lib/skus/label-grid';

export const dynamic = 'force-dynamic';

/**
 * Single-SKU "Print label" entry point — staff press this on the detail
 * page. Per the user's lock-in: print the full 2-up row (i.e. two identical
 * labels) so no roll space is wasted on a half-empty row.
 *
 * The actual rendering happens on /skus/print/sheet — we just redirect to it
 * with the right item count so the print pipeline stays in one place.
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
