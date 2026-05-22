import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, formatRupees, pickLocalised } from '@/lib/format/locale';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/badges';
import { getDesignThumbnailUrl } from './actions';

export const dynamic = 'force-dynamic';

interface DesignRow {
  id: string;
  design_number: string;
  name_en: string | null;
  name_gu: string | null;
  current_rate_per_guss: number;
  image_path: string | null;
  is_active: boolean;
  deleted_at: string | null;
}

export default async function DesignsPage({
  searchParams,
}: {
  searchParams: { deleted?: string };
}) {
  const user = await requireAppUser();
  const showDeleted = searchParams.deleted === '1' && user.role === 'super_admin';
  const locale = getServerLocale();
  const supabase = createClient();

  let query = supabase
    .from('designs')
    .select(
      'id, design_number, name_en, name_gu, current_rate_per_guss, image_path, is_active, deleted_at',
    )
    .order('design_number', { ascending: true });

  query = showDeleted ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null);

  const { data: rows } = await query;
  const designs = (rows ?? []) as DesignRow[];

  const thumbnails: Record<string, string | null> = {};
  await Promise.all(
    designs
      .filter((d) => d.image_path)
      .map(async (d) => {
        thumbnails[d.id] = await getDesignThumbnailUrl(d.image_path);
      }),
  );

  const canWrite = user.role === 'super_admin' || user.role === 'supervisor';
  const canSeeDeletedToggle = user.role === 'super_admin';

  return (
    <DesignsView
      designs={designs}
      thumbnails={thumbnails}
      canWrite={canWrite}
      canSeeDeletedToggle={canSeeDeletedToggle}
      showDeleted={showDeleted}
      locale={locale}
    />
  );
}

function DesignsView({
  designs,
  thumbnails,
  canWrite,
  canSeeDeletedToggle,
  showDeleted,
  locale,
}: {
  designs: DesignRow[];
  thumbnails: Record<string, string | null>;
  canWrite: boolean;
  canSeeDeletedToggle: boolean;
  showDeleted: boolean;
  locale: 'gu' | 'en';
}) {
  const t = useTranslations('masterData.designs');
  const tCommon = useTranslations('common.actions');
  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          canWrite ? (
            <Link href="/master-data/designs/new" className="btn-primary !w-auto px-4">
              {t('newButton')}
            </Link>
          ) : null
        }
      />
      {canSeeDeletedToggle ? (
        <div className="mb-3">
          <Link
            href={showDeleted ? '/master-data/designs' : '/master-data/designs?deleted=1'}
            className="btn-ghost border border-neutral-300 text-sm"
          >
            {showDeleted ? tCommon('hideDeleted') : tCommon('showDeleted')}
          </Link>
        </div>
      ) : null}
      <ul className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {designs.map((d) => {
          const name = pickLocalised(locale, d.name_en, d.name_gu);
          const thumb = thumbnails[d.id];
          const isDeleted = !!d.deleted_at;
          return (
            <li key={d.id} className="flex items-center gap-3 px-4 py-3">
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-neutral-100 ring-1 ring-neutral-200">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-neutral-900">#{d.design_number}</span>
                  <StatusBadge isActive={d.is_active} isDeleted={isDeleted} />
                </div>
                {name ? <div className="truncate text-sm text-neutral-700">{name}</div> : null}
                <div className="text-xs text-neutral-500">
                  {formatRupees(Number(d.current_rate_per_guss), locale)} /{' '}
                  {t('table.rate').split('/')[1]?.trim() ?? 'guss'}
                </div>
              </div>
              {canWrite ? (
                <Link
                  href={`/master-data/designs/${d.id}`}
                  className="btn-ghost border border-neutral-300"
                >
                  {tCommon('edit')}
                </Link>
              ) : null}
            </li>
          );
        })}
        {designs.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-neutral-500">—</li>
        ) : null}
      </ul>
    </>
  );
}
