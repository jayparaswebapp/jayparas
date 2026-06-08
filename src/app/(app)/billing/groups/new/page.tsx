import { useTranslations } from 'next-intl';
import { requireRole } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { GroupForm } from '../group-form';

export const dynamic = 'force-dynamic';

export default async function NewCustomerGroupPage() {
  await requireRole(['super_admin', 'supervisor']);
  return <NewView />;
}

function NewView() {
  const t = useTranslations('billing.groups.form');
  return (
    <>
      <PageHeader title={t('createTitle')} />
      <GroupForm initial={null} />
    </>
  );
}
