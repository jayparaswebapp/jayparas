import { useTranslations } from 'next-intl';
import { requireRole } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { DesignForm } from '../design-form';

export const dynamic = 'force-dynamic';

export default async function NewDesignPage() {
  const user = await requireRole(['super_admin', 'supervisor']);
  return <NewDesignView isSuperAdmin={user.role === 'super_admin'} />;
}

function NewDesignView({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const t = useTranslations('masterData.designs.form');
  return (
    <>
      <PageHeader title={t('createTitle')} />
      <DesignForm initial={null} imageSignedUrl={null} isSuperAdmin={isSuperAdmin} />
    </>
  );
}
