import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { PrintSheet, type SheetItem } from './print-sheet';

export const dynamic = 'force-dynamic';

/**
 * Parses the `items` query parameter — a comma-separated `id:qty` list — into
 * a tuple array. Caps per-line quantity to keep one bad URL from rendering
 * thousands of labels.
 */
function parseItems(raw: string | undefined): Array<{ id: string; qty: number }> {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => {
      const [id, qStr] = s.split(':');
      const qty = Math.max(1, Math.min(999, Number.parseInt(qStr ?? '1', 10) || 1));
      return id ? { id: id.trim(), qty } : null;
    })
    .filter((x): x is { id: string; qty: number } => !!x);
}

export default async function PrintSheetPage({
  searchParams,
}: {
  searchParams: { items?: string };
}) {
  await requireAppUser();
  const parsed = parseItems(searchParams.items);
  if (parsed.length === 0) notFound();

  const supabase = createClient();
  const ids = parsed.map((p) => p.id);

  const { data: rows } = await supabase
    .from('skus')
    .select('id, sku_code, pack_type, design_no, mix_code, design_name, pack_size, price')
    .in('id', ids)
    .is('deleted_at', null);

  const byId = new Map((rows ?? []).map((r) => [r.id as string, r]));

  // Expand each (id, qty) into qty copies, preserving the picker's order.
  const items: SheetItem[] = [];
  for (const { id, qty } of parsed) {
    const r = byId.get(id);
    if (!r) continue;
    const sku = {
      sku_code: r.sku_code as string,
      pack_type: r.pack_type as 'single' | 'mix',
      design_no: r.design_no as string | null,
      mix_code: r.mix_code as string | null,
      design_name: r.design_name as string,
      pack_size: r.pack_size as number,
      price: Number(r.price),
    };
    for (let i = 0; i < qty; i += 1) {
      items.push({ key: `${id}-${i}`, sku });
    }
  }

  if (items.length === 0) notFound();

  return <PrintSheet items={items} />;
}
