import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, pickLocalised } from '@/lib/format/locale';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/badges';

export const dynamic = 'force-dynamic';

interface LeadLadyRow {
  id: string;
  full_name: string;
  mobile: string;
  is_active: boolean;
  deleted_at: string | null;
  lead_lady_locations: Array<{
    location: { id: string; name_en: string; name_gu: string } | null;
  }>;
}

export default async function LeadLadiesPage({
  searchParams,
}: {
  searchParams: { deleted?: string };
}) {
  const user = await requireAppUser();
  const showDeleted = searchParams.deleted === '1' && user.role === 'super_admin';
  const locale = getServerLocale();
  const supabase = createClient();

  let query = supabase
    .from('lead_ladies')
    .select(
      'id, full_name, mobile, is_active, deleted_at, lead_lady_locations(location:locations(id, name_en, name_gu))',
    )
    .order('full_name', { ascending: true });

  query = showDeleted ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null);

  const { data: rows } = await query;
  const leadLadies = (rows ?? []) as unknown as LeadLadyRow[];

  const canWrite = user.role === 'super_admin' || user.role === 'supervisor';
  const canSeeDeletedToggle = user.role === 'super_admin';

  return (
    <LeadLadiesView
      rows={leadLadies}
      canWrite={canWrite}
      canSeeDeletedToggle={canSeeDeletedToggle}
      showDeleted={showDeleted}
      locale={locale}
    />
  );
}

function LeadLadiesView({
  rows,
  canWrite,
  canSeeDeletedToggle,
  showDeleted,
  locale,
}: {
  rows: LeadLadyRow[];
  canWrite: boolean;
  canSeeDeletedToggle: boolean;
  showDeleted: boolean;
  locale: 'gu' | 'en';
}) {
  const t = useTranslations('masterData.leadLadies');
  const tCommon = useTranslations('common.actions');
  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          canWrite ? (
            <Link href="/master-data/lead-ladies/new" className="btn-primary !w-auto px-4">
              {t('newButton')}
            </Link>
          ) : null
        }
      />
      {canSeeDeletedToggle ? (
        <div className="mb-3">
          <Link
            href={showDeleted ? '/master-data/lead-ladies' : '/master-data/lead-ladies?deleted=1'}
            className="btn-ghost border border-neutral-300 text-sm"
          >
            {showDeleted ? tCommon('hideDeleted') : tCommon('showDeleted')}
          </Link>
        </div>
      ) : null}
      <ul className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {rows.map((row) => {
          const isDeleted = !!row.deleted_at;
          const locationNames = row.lead_lady_locations
            .map((l) =>
              l.location ? pickLocalised(locale, l.location.name_en, l.location.name_gu) : null,
            )
            .filter((s): s is string => !!s);
          return (
            <li key={row.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-neutral-900">{row.full_name}</span>
                  <StatusBadge isActive={row.is_active} isDeleted={isDeleted} />
                </div>
                <div className="text-sm text-neutral-700">{row.mobile}</div>
                {locationNames.length > 0 ? (
                  <div className="truncate text-xs text-neutral-500">
                    {locationNames.join(' · ')}
                  </div>
                ) : null}
              </div>
              {canWrite ? (
                <Link
                  href={`/master-data/lead-ladies/${row.id}`}
                  className="btn-ghost border border-neutral-300"
                >
                  {tCommon('edit')}
                </Link>
              ) : null}
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
