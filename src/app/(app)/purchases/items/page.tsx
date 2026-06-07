import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, formatRupees } from '@/lib/format/locale';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/badges';
import type { Locale } from '@/lib/i18n/config';

export const dynamic = 'force-dynamic';

interface ItemRow {
  id: string;
  item_code: string;
  name: string;
  name_gu: string | null;
  uom: string;
  hsn_code: string | null;
  default_rate: number;
  default_gst_pct: number;
  is_active: boolean;
  deleted_at: string | null;
}

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: { q?: string; deleted?: string };
}) {
  const user = await requireAppUser();
  const locale = getServerLocale();
  const q = (searchParams.q ?? '').trim();
  const showDeleted = searchParams.deleted === '1' && user.role === 'super_admin';
  const supabase = createClient();

  let query = supabase
    .from('purchase_items')
    .select(
      'id, item_code, name, name_gu, uom, hsn_code, default_rate, default_gst_pct, is_active, deleted_at',
    )
    .order('item_code', { ascending: true });

  query = showDeleted ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null);

  if (q.length > 0) {
    const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
    query = query.or(`item_code.ilike.${like},name.ilike.${like}`);
  }

  const { data: rows } = await query;
  const items = (rows ?? []) as ItemRow[];

  const canWrite = user.role === 'super_admin' || user.role === 'supervisor';
  const canSeeDeletedToggle = user.role === 'super_admin';

  return (
    <ItemsView
      rows={items}
      query={q}
      canWrite={canWrite}
      canSeeDeletedToggle={canSeeDeletedToggle}
      showDeleted={showDeleted}
      locale={locale}
    />
  );
}

function ItemsView({
  rows,
  query,
  canWrite,
  canSeeDeletedToggle,
  showDeleted,
  locale,
}: {
  rows: ItemRow[];
  query: string;
  canWrite: boolean;
  canSeeDeletedToggle: boolean;
  showDeleted: boolean;
  locale: Locale;
}) {
  const t = useTranslations('purchases.items');
  const tCommon = useTranslations('common.actions');
  const hasQuery = query.length > 0;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          canWrite ? (
            <Link href="/purchases/items/new" className="btn-primary !w-auto px-4">
              {t('newButton')}
            </Link>
          ) : null
        }
      />

      <form method="get" className="mb-3 flex flex-wrap items-center gap-2">
        <input
          id="q"
          name="q"
          defaultValue={query}
          placeholder={t('searchPlaceholder')}
          className="input-base !w-auto min-w-[16rem] flex-1"
        />
        {showDeleted ? <input type="hidden" name="deleted" value="1" /> : null}
        <button type="submit" className="btn-ghost border border-neutral-300">
          {tCommon('edit')}
        </button>
        {canSeeDeletedToggle ? (
          <Link
            href={showDeleted ? '/purchases/items' : '/purchases/items?deleted=1'}
            className="btn-ghost border border-neutral-300 text-sm"
          >
            {showDeleted ? tCommon('hideDeleted') : tCommon('showDeleted')}
          </Link>
        ) : null}
      </form>

      <ul className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {rows.map((row) => {
          const isDeleted = !!row.deleted_at;
          return (
            <li key={row.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-neutral-900">
                    {row.item_code}
                  </span>
                  <StatusBadge isActive={row.is_active} isDeleted={isDeleted} />
                </div>
                <div className="text-sm text-neutral-900">{row.name}</div>
                {row.name_gu ? (
                  <div className="text-xs text-neutral-500" lang="gu">
                    {row.name_gu}
                  </div>
                ) : null}
                <div className="mt-0.5 text-xs text-neutral-500">
                  {formatRupees(Number(row.default_rate), locale)} / {row.uom}
                  {Number(row.default_gst_pct) > 0 ? ` · GST ${row.default_gst_pct}%` : ''}
                  {row.hsn_code ? ` · HSN ${row.hsn_code}` : ''}
                </div>
              </div>
              {canWrite ? (
                <Link
                  href={`/purchases/items/${row.id}`}
                  className="btn-ghost border border-neutral-300"
                >
                  {tCommon('edit')}
                </Link>
              ) : null}
            </li>
          );
        })}
        {rows.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-neutral-500">
            {hasQuery ? t('noMatches') : t('empty')}
          </li>
        ) : null}
      </ul>
    </>
  );
}
