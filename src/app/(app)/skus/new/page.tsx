import { useTranslations } from 'next-intl';
import { requireRole } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { SkuCreateForm } from '../sku-create-form';

export const dynamic = 'force-dynamic';

export default async function NewSkuPage() {
  const user = await requireRole(['super_admin', 'supervisor']);
  return <NewSkuView isSuperAdmin={user.role === 'super_admin'} />;
}

function NewSkuView({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const t = useTranslations('skus.form');
  return (
    <>
      <PageHeader title={t('createTitle')} />
      <SkuCreateForm isSuperAdmin={isSuperAdmin} />
    </>
  );
}
