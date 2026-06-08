import { useTranslations } from 'next-intl';
import { requireRole } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { ItemForm } from '../item-form';

export const dynamic = 'force-dynamic';

export default async function NewItemPage() {
  await requireRole(['super_admin', 'supervisor']);
  return <NewView />;
}

function NewView() {
  const t = useTranslations('purchases.items.form');
  return (
    <>
      <PageHeader title={t('createTitle')} />
      <ItemForm initial={null} />
    </>
  );
}
