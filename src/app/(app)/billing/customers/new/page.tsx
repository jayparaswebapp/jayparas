import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { CustomerForm, type GroupOption } from '../customer-form';

export const dynamic = 'force-dynamic';

export default async function NewBillingCustomerPage() {
  const user = await requireRole(['super_admin', 'supervisor']);
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

  return <NewView groups={groups} isSuperAdmin={user.role === 'super_admin'} />;
}

function NewView({ groups, isSuperAdmin }: { groups: GroupOption[]; isSuperAdmin: boolean }) {
  const t = useTranslations('billing.customers.form');
  return (
    <>
      <PageHeader title={t('createTitle')} />
      <CustomerForm initial={null} groups={groups} isSuperAdmin={isSuperAdmin} />
    </>
  );
}
