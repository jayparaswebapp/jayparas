import { useTranslations } from 'next-intl';
import { requireRole } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { CustomerForm } from '../customer-form';

export const dynamic = 'force-dynamic';

export default async function NewBillingCustomerPage() {
  const user = await requireRole(['super_admin', 'supervisor']);
  return <NewView isSuperAdmin={user.role === 'super_admin'} />;
}

function NewView({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const t = useTranslations('billing.customers.form');
  return (
    <>
      <PageHeader title={t('createTitle')} />
      <CustomerForm initial={null} isSuperAdmin={isSuperAdmin} />
    </>
  );
}
