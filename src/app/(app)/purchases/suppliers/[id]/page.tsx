import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { SupplierForm, type SupplierFormValues } from '../supplier-form';
import { DestructiveActions } from './destructive-actions';

export const dynamic = 'force-dynamic';

export default async function EditSupplierPage({ params }: { params: { id: string } }) {
  await requireRole(['super_admin', 'supervisor']);
  const supabase = createClient();

  const { data: row } = await supabase
    .from('suppliers')
    .select(
      'id, full_name, business_name, mobile, email, gstin, pan, address_line1, address_line2, city, state, pincode, notes, is_active, deleted_at',
    )
    .eq('id', params.id)
    .maybeSingle();

  if (!row) notFound();

  const initial: SupplierFormValues = {
    id: row.id,
    full_name: row.full_name,
    business_name: row.business_name,
    mobile: row.mobile,
    email: row.email,
    gstin: row.gstin,
    pan: row.pan,
    address_line1: row.address_line1,
    address_line2: row.address_line2,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    notes: row.notes,
    is_active: row.is_active,
  };

  return <EditView initial={initial} isDeleted={!!row.deleted_at} />;
}

function EditView({ initial, isDeleted }: { initial: SupplierFormValues; isDeleted: boolean }) {
  const t = useTranslations('purchases.suppliers.form');
  return (
    <>
      <PageHeader title={t('editTitle')} />
      {isDeleted ? (
        <DestructiveActions supplierId={initial.id!} isDeleted />
      ) : (
        <>
          <SupplierForm initial={initial} />
          <div className="mt-6 border-t border-neutral-200 pt-4">
            <DestructiveActions supplierId={initial.id!} isDeleted={false} />
          </div>
        </>
      )}
    </>
  );
}
