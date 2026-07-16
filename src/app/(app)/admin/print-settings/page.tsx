import { useTranslations } from 'next-intl';
import { requireAppUser } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { PrintSettingsForm } from './print-settings-form';

export const dynamic = 'force-dynamic';

export default async function PrintSettingsPage() {
  // Every signed-in staff member can configure THEIR device's printers —
  // this is a per-device local preference, not a global admin setting, so
  // there's no permission gate beyond being logged in.
  await requireAppUser();
  return <View />;
}

function View() {
  const t = useTranslations('admin.printSettings');
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <PrintSettingsForm />
    </>
  );
}
