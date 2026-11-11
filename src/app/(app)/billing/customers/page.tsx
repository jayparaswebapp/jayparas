import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { CustomerForm, type GroupOption, type KiteCompanyOption } from '../customer-form';

export const dynamic = 'force-dynamic';

export default async function NewBillingCustomerPage() {
  await requireRole(['super_admin', 'supervisor']);
  const supabase = createClient();

  const { data: gs } = await supabase
    .from('customer_groups')
    .select('id, name, city')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('city', { ascending: true })
    .order('name', { ascending: true });

  const groups: GroupOption[] = (gs ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    city: g.city,
  }));

  const { data: kc } = await supabase
    .from('kite_companies')
    .select('id, name, is_active')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  const kiteCompanies: KiteCompanyOption[] = kc ?? [];

  return <NewView groups={groups} kiteCompanies={kiteCompanies} />;
}

function NewView({
  groups,
  kiteCompanies,
}: {
  groups: GroupOption[];
  kiteCompanies: KiteCompanyOption[];
}) {
  const t = useTranslations('billing.customers.form');
  return (
    <>
      <PageHeader title={t('createTitle')} />
      <CustomerForm initial={null} groups={groups} kiteCompanies={kiteCompanies} />
    </>
  );
}
