import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { getServerLocale, pickLocalised } from '@/lib/format/locale';
import { PageHeader } from '@/components/page-header';
import { StatusBadge, RoleBadge } from '@/components/badges';

export const dynamic = 'force-dynamic';

interface UserRow {
  id: string;
  full_name: string;
  mobile: string;
  role: 'super_admin' | 'supervisor' | 'centre_manager' | 'accountant';
  is_active: boolean;
  deleted_at: string | null;
  centre_manager_locations: Array<{
    location: { id: string; name_en: string; name_gu: string } | null;
  }>;
}

export default async function UsersPage({ searchParams }: { searchParams: { deleted?: string } }) {
  await requireRole(['super_admin']);
  const showDeleted = searchParams.deleted === '1';
  const locale = getServerLocale();
  const supabase = createClient();

  let query = supabase
    .from('app_users')
    .select(
      'id, full_name, mobile, role, is_active, deleted_at, centre_manager_locations(location:locations(id, name_en, name_gu))',
    )
    .order('full_name', { ascending: true });

  query = showDeleted ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null);

  const { data: rows } = await query;
  const users = (rows ?? []) as unknown as UserRow[];

  return <UsersView rows={users} showDeleted={showDeleted} locale={locale} />;
}

function UsersView({
  rows,
  showDeleted,
  locale,
}: {
  rows: UserRow[];
  showDeleted: boolean;
  locale: 'gu' | 'en';
}) {
  const t = useTranslations('admin.users');
  const tCommon = useTranslations('common.actions');
  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          <Link href="/admin/users/new" className="btn-primary !w-auto px-4">
            {t('newButton')}
          </Link>
        }
      />
      <div className="mb-3">
        <Link
          href={showDeleted ? '/admin/users' : '/admin/users?deleted=1'}
          className="btn-ghost border border-neutral-300 text-sm"
        >
          {showDeleted ? tCommon('hideDeleted') : tCommon('showDeleted')}
        </Link>
      </div>
      <ul className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {rows.map((row) => {
          const isDeleted = !!row.deleted_at;
          const locationNames =
            row.role === 'centre_manager'
              ? row.centre_manager_locations
                  .map((l) =>
                    l.location
                      ? pickLocalised(locale, l.location.name_en, l.location.name_gu)
                      : null,
                  )
                  .filter((s): s is string => !!s)
              : [];
          return (
            <li key={row.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-neutral-900">{row.full_name}</span>
                  <RoleBadge role={row.role} />
                  <StatusBadge isActive={row.is_active} isDeleted={isDeleted} />
                </div>
                <div className="text-sm text-neutral-700">{row.mobile}</div>
                {locationNames.length > 0 ? (
                  <div className="truncate text-xs text-neutral-500">
                    {locationNames.join(' · ')}
                  </div>
                ) : null}
              </div>
              <Link href={`/admin/users/${row.id}`} className="btn-ghost border border-neutral-300">
                {tCommon('edit')}
              </Link>
            </li>
          );
        })}
        {rows.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-neutral-500">—</li>
        ) : null}
      </ul>
    </>
  );
}
