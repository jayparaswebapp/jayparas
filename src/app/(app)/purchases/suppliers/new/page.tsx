import { useTranslations } from 'next-intl';
import { requireRole } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { SupplierForm } from '../supplier-form';

export const dynamic = 'force-dynamic';

export default async function NewSupplierPage() {
  await requireRole(['super_admin', 'supervisor']);
  return <NewView />;
}

function NewView() {
  const t = useTranslations('purchases.suppliers.form');
  return (
    <>
      <PageHeader title={t('createTitle')} />
      <SupplierForm initial={null} />
    </>
  );
}
