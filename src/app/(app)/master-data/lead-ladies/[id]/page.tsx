import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { getServerLocale, pickLocalised } from '@/lib/format/locale';
import { PageHeader } from '@/components/page-header';
import { LeadLadyForm, type LeadLadyFormValues, type LocationOption } from '../lead-lady-form';
import { DestructiveActions } from './destructive-actions';

export const dynamic = 'force-dynamic';

export default async function EditLeadLadyPage({ params }: { params: { id: string } }) {
  const user = await requireRole(['super_admin', 'supervisor']);
  const locale = getServerLocale();
  const supabase = createClient();

  const { data: row } = await supabase
    .from('lead_ladies')
    .select('id, full_name, mobile, notes, is_active, deleted_at, lead_lady_locations(location_id)')
    .eq('id', params.id)
    .maybeSingle();

  if (!row) notFound();

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

  const initial: LeadLadyFormValues = {
    id: row.id,
    full_name: row.full_name,
    mobile: row.mobile,
    notes: row.notes,
    is_active: row.is_active,
    location_ids: (row.lead_lady_locations ?? []).map(
      (l: { location_id: string }) => l.location_id,
    ),
  };

  return (
    <EditView
      initial={initial}
      isDeleted={!!row.deleted_at}
      locations={locations}
      isSuperAdmin={user.role === 'super_admin'}
    />
  );
}

function EditView({
  initial,
  isDeleted,
  locations,
  isSuperAdmin,
}: {
  initial: LeadLadyFormValues;
  isDeleted: boolean;
  locations: LocationOption[];
  isSuperAdmin: boolean;
}) {
  const t = useTranslations('masterData.leadLadies.form');
  return (
    <>
      <PageHeader title={t('editTitle')} />
      {isDeleted ? (
        <DestructiveActions leadLadyId={initial.id!} isDeleted />
      ) : (
        <>
          <LeadLadyForm initial={initial} locations={locations} isSuperAdmin={isSuperAdmin} />
          <div className="mt-6 border-t border-neutral-200 pt-4">
            <DestructiveActions leadLadyId={initial.id!} isDeleted={false} />
          </div>
        </>
      )}
    </>
  );
}
