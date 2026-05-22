import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { getServerLocale, pickLocalised } from '@/lib/format/locale';
import { PageHeader } from '@/components/page-header';
import { LeadLadyForm, type LocationOption } from '../lead-lady-form';

export const dynamic = 'force-dynamic';

export default async function NewLeadLadyPage() {
  const user = await requireRole(['super_admin', 'supervisor']);
  const locale = getServerLocale();
  const supabase = createClient();

  const { data: locs } = await supabase
    .from('locations')
    .select('id, name_en, name_gu')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('name_en', { ascending: true });

  const locations: LocationOption[] = (locs ?? []).map((l) => ({
    id: l.id,
    label: pickLocalised(locale, l.name_en, l.name_gu),
  }));

  return <NewView locations={locations} isSuperAdmin={user.role === 'super_admin'} />;
}

function NewView({
  locations,
  isSuperAdmin,
}: {
  locations: LocationOption[];
  isSuperAdmin: boolean;
}) {
  const t = useTranslations('masterData.leadLadies.form');
  return (
    <>
      <PageHeader title={t('createTitle')} />
      <LeadLadyForm initial={null} locations={locations} isSuperAdmin={isSuperAdmin} />
    </>
  );
}
