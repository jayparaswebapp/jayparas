import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { getServerLocale, pickLocalised } from '@/lib/format/locale';
import { PageHeader } from '@/components/page-header';
import { UserForm, type AppUserRole, type LocationOption, type UserFormValues } from '../user-form';
import { DestructiveActions } from './destructive-actions';

export const dynamic = 'force-dynamic';

export default async function EditUserPage({ params }: { params: { id: string } }) {
  const caller = await requireRole(['super_admin']);
  const locale = getServerLocale();
  const supabase = createClient();

  const { data: row } = await supabase
    .from('app_users')
    .select(
      'id, full_name, mobile, role, is_active, deleted_at, centre_manager_locations(location_id)',
    )
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

  const initial: UserFormValues = {
    id: row.id,
    full_name: row.full_name,
    mobile: row.mobile,
    role: row.role as AppUserRole,
    is_active: row.is_active,
    location_ids: (row.centre_manager_locations ?? []).map(
      (l: { location_id: string }) => l.location_id,
    ),
  };

  return (
    <EditView
      initial={initial}
      isDeleted={!!row.deleted_at}
      locations={locations}
      isSelf={caller.id === row.id}
    />
  );
}

function EditView({
  initial,
  isDeleted,
  locations,
  isSelf,
}: {
  initial: UserFormValues;
  isDeleted: boolean;
  locations: LocationOption[];
  isSelf: boolean;
}) {
  const t = useTranslations('admin.users.form');
  return (
    <>
      <PageHeader title={t('editTitle')} />
      {isDeleted ? (
        <DestructiveActions userId={initial.id!} isDeleted />
      ) : (
        <>
          <UserForm initial={initial} locations={locations} isSelf={isSelf} />
          {!isSelf ? (
            <div className="mt-6 border-t border-neutral-200 pt-4">
              <DestructiveActions userId={initial.id!} isDeleted={false} />
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
