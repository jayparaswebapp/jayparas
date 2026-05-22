import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, pickLocalised } from '@/lib/format/locale';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/badges';

export const dynamic = 'force-dynamic';

export default async function LocationsPage() {
  const user = await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const { data: rows } = await supabase
    .from('locations')
    .select('id, name_en, name_gu, is_active')
    .order('name_en', { ascending: true });

  return <LocationsView rows={rows ?? []} canEdit={user.role === 'super_admin'} locale={locale} />;
}

function LocationsView({
  rows,
  canEdit,
  locale,
}: {
  rows: Array<{ id: string; name_en: string; name_gu: string; is_active: boolean }>;
  canEdit: boolean;
  locale: 'gu' | 'en';
}) {
  const t = useTranslations('masterData.locations');
  const tCommon = useTranslations('common.actions');
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ul className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="font-medium text-neutral-900">
                {pickLocalised(locale, row.name_en, row.name_gu)}
              </div>
              <div
                className="truncate text-xs text-neutral-500"
                lang={locale === 'gu' ? 'en' : 'gu'}
              >
                {locale === 'gu' ? row.name_en : row.name_gu}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge isActive={row.is_active} />
              {canEdit ? (
                <Link
                  href={`/master-data/locations/${row.id}`}
                  className="btn-ghost border border-neutral-300"
                >
                  {tCommon('edit')}
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
