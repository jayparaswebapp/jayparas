import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import {
  CustomerForm,
  type CustomerFormValues,
  type GroupOption,
  type KiteCompanyOption,
} from '../customer-form';
import { DestructiveActions } from './destructive-actions';

export const dynamic = 'force-dynamic';

export default async function EditBillingCustomerPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { kitePricingError?: string };
}) {
  await requireRole(['super_admin', 'supervisor']);
  const supabase = createClient();

  const { data: row } = await supabase
    .from('billing_customers')
    .select(
      'id, full_name, business_name, mobile, email, gstin, pan, address_line1, address_line2, city, state, pincode, notes, group_id, is_active, deleted_at, price_tier',
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

  // Every non-deleted company is listed (inactive ones too) so saving the
  // form never silently drops a % the party already has.
  const [{ data: kc }, { data: dr }] = await Promise.all([
    supabase
      .from('kite_companies')
      .select('id, name, is_active')
      .is('deleted_at', null)
      .order('name', { ascending: true }),
    supabase
      .from('customer_company_discounts')
      .select('company_id, discount_pct')
      .eq('customer_id', row.id),
  ]);

  const kiteCompanies: KiteCompanyOption[] = kc ?? [];
  const kiteDiscounts: Record<string, number> = {};
  for (const d of dr ?? []) kiteDiscounts[d.company_id] = Number(d.discount_pct);

  const tier = row.price_tier === 'A' || row.price_tier === 'B' ? row.price_tier : 'C';

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
    price_tier: tier,
    kite_discounts: kiteDiscounts,
  };

  return (
    <EditView
      initial={initial}
      groups={groups}
      kiteCompanies={kiteCompanies}
      isDeleted={!!row.deleted_at}
      kitePricingError={searchParams.kitePricingError === '1'}
    />
  );
}

function EditView({
  initial,
  groups,
  kiteCompanies,
  isDeleted,
  kitePricingError,
}: {
  initial: CustomerFormValues;
  groups: GroupOption[];
  kiteCompanies: KiteCompanyOption[];
  isDeleted: boolean;
  kitePricingError: boolean;
}) {
  const t = useTranslations('billing.customers.form');
  return (
    <>
      <PageHeader title={t('editTitle')} />
      {kitePricingError ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {t('kitePricingSaveFailed')}
        </div>
      ) : null}
      {isDeleted ? (
        <DestructiveActions customerId={initial.id!} isDeleted />
      ) : (
        <>
          <CustomerForm initial={initial} groups={groups} kiteCompanies={kiteCompanies} />
          <div className="mt-6 border-t border-neutral-200 pt-4">
            <DestructiveActions customerId={initial.id!} isDeleted={false} />
          </div>
        </>
      )}
    </>
  );
}
