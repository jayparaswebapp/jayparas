import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { ItemForm, type ItemFormValues } from '../item-form';
import { DestructiveActions } from './destructive-actions';

export const dynamic = 'force-dynamic';

export default async function EditItemPage({ params }: { params: { id: string } }) {
  await requireRole(['super_admin', 'supervisor']);
  const supabase = createClient();

  const { data: row } = await supabase
    .from('purchase_items')
    .select(
      'id, item_code, name, name_gu, uom, hsn_code, default_rate, default_gst_pct, notes, is_active, deleted_at',
    )
    .eq('id', params.id)
    .maybeSingle();

  if (!row) notFound();

  const initial: ItemFormValues = {
    id: row.id,
    item_code: row.item_code,
    name: row.name,
    name_gu: row.name_gu,
    uom: row.uom,
    hsn_code: row.hsn_code,
    default_rate: Number(row.default_rate),
    default_gst_pct: Number(row.default_gst_pct),
    notes: row.notes,
    is_active: row.is_active,
  };

  return <EditView initial={initial} isDeleted={!!row.deleted_at} />;
}

function EditView({ initial, isDeleted }: { initial: ItemFormValues; isDeleted: boolean }) {
  const t = useTranslations('purchases.items.form');
  return (
    <>
      <PageHeader title={t('editTitle')} />
      {isDeleted ? (
        <DestructiveActions itemId={initial.id!} isDeleted />
      ) : (
        <>
          <ItemForm initial={initial} />
          <div className="mt-6 border-t border-neutral-200 pt-4">
            <DestructiveActions itemId={initial.id!} isDeleted={false} />
          </div>
        </>
      )}
    </>
  );
}
