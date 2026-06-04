import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { CustomerForm, type CustomerFormValues, type GroupOption } from '../customer-form';
import { DestructiveActions } from './destructive-actions';

export const dynamic = 'force-dynamic';

export default async function EditBillingCustomerPage({ params }: { params: { id: string } }) {
  const user = await requireRole(['super_admin', 'supervisor']);
  const supabase = createClient();

  const { data: row } = await supabase
    .from('billing_customers')
    .select(
      'id, full_name, business_name, mobile, email, gstin, pan, address_line1, address_line2, city, state, pincode, notes, group_id, is_active, deleted_at',
    )
    .eq('id', params.id)
    .maybeSingle();

  if (!row) notFound();

  const { data: gs } = await supabase
    .from('customer_groups')
    .select('id, name, city, is_active, deleted_at')
    .or(
      `and(is_active.eq.true,deleted_at.is.null),id.eq.${row.group_id ?? '00000000-0000-0000-0000-000000000000'}`,
    )
    .order('city', { ascending: true })
    .order('name', { ascending: true });

  const groups: GroupOption[] = (gs ?? [])
    .filter((g) => g.deleted_at === null || g.id === row.group_id)
    .map((g) => ({ id: g.id, name: g.name, city: g.city }));

  const initial: CustomerFormValues = {
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
    group_id: row.group_id,
    is_active: row.is_active,
  };

  return (
    <EditView
      initial={initial}
      groups={groups}
      isDeleted={!!row.deleted_at}
      isSuperAdmin={user.role === 'super_admin'}
    />
  );
}

function EditView({
  initial,
  groups,
  isDeleted,
  isSuperAdmin,
}: {
  initial: CustomerFormValues;
  groups: GroupOption[];
  isDeleted: boolean;
  isSuperAdmin: boolean;
}) {
  const t = useTranslations('billing.customers.form');
  return (
    <>
      <PageHeader title={t('editTitle')} />
      {isDeleted ? (
        <DestructiveActions customerId={initial.id!} isDeleted />
      ) : (
        <>
          <CustomerForm initial={initial} groups={groups} isSuperAdmin={isSuperAdmin} />
          <div className="mt-6 border-t border-neutral-200 pt-4">
            <DestructiveActions customerId={initial.id!} isDeleted={false} />
          </div>
        </>
      )}
    </>
  );
}
