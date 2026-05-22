import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { LocationEditForm } from './edit-form';

export const dynamic = 'force-dynamic';

export default async function EditLocationPage({ params }: { params: { id: string } }) {
  await requireRole(['super_admin']);
  const supabase = createClient();
  const { data: row } = await supabase
    .from('locations')
    .select('id, name_en, name_gu, is_active')
    .eq('id', params.id)
    .maybeSingle();

  if (!row) notFound();

  return <EditView location={row} />;
}

function EditView({
  location,
}: {
  location: { id: string; name_en: string; name_gu: string; is_active: boolean };
}) {
  const t = useTranslations('masterData.locations.edit');
  return (
    <>
      <PageHeader title={t('title')} />
      <LocationEditForm location={location} />
    </>
  );
}
