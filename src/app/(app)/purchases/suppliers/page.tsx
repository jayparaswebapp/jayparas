import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/badges';

export const dynamic = 'force-dynamic';

interface SupplierRow {
  id: string;
  full_name: string;
  business_name: string | null;
  mobile: string;
  gstin: string | null;
  city: string | null;
  is_active: boolean;
  deleted_at: string | null;
}

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: { q?: string; deleted?: string };
}) {
  const user = await requireAppUser();
  const q = (searchParams.q ?? '').trim();
  const showDeleted = searchParams.deleted === '1' && user.role === 'super_admin';
  const supabase = createClient();

  let query = supabase
    .from('suppliers')
    .select('id, full_name, business_name, mobile, gstin, city, is_active, deleted_at')
    .order('full_name', { ascending: true });

  query = showDeleted ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null);

  if (q.length > 0) {
    const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
    query = query.or(
      `full_name.ilike.${like},business_name.ilike.${like},mobile.ilike.${like},gstin.ilike.${like}`,
    );
  }

  const { data: rows } = await query;
  const suppliers = (rows ?? []) as SupplierRow[];

  const canWrite = user.role === 'super_admin' || user.role === 'supervisor';
  const canSeeDeletedToggle = user.role === 'super_admin';

  return (
    <SuppliersView
      rows={suppliers}
      query={q}
      canWrite={canWrite}
      canSeeDeletedToggle={canSeeDeletedToggle}
      showDeleted={showDeleted}
    />
  );
}

function SuppliersView({
  rows,
  query,
  canWrite,
  canSeeDeletedToggle,
  showDeleted,
}: {
  rows: SupplierRow[];
  query: string;
  canWrite: boolean;
  canSeeDeletedToggle: boolean;
  showDeleted: boolean;
}) {
  const t = useTranslations('purchases.suppliers');
  const tCommon = useTranslations('common.actions');
  const hasQuery = query.length > 0;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          canWrite ? (
            <Link href="/purchases/suppliers/new" className="btn-primary !w-auto px-4">
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
            href={showDeleted ? '/purchases/suppliers' : '/purchases/suppliers?deleted=1'}
            className="btn-ghost border border-neutral-300 text-sm"
          >
            {showDeleted ? tCommon('hideDeleted') : tCommon('showDeleted')}
          </Link>
        ) : null}
      </form>

      <ul className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {rows.map((row) => {
          const isDeleted = !!row.deleted_at;
          const secondary = [row.business_name, row.city].filter(Boolean).join(' · ');
          return (
            <li key={row.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-neutral-900">{row.full_name}</span>
                  <StatusBadge isActive={row.is_active} isDeleted={isDeleted} />
                </div>
                <div className="text-sm text-neutral-700">{row.mobile}</div>
                {secondary ? (
                  <div className="truncate text-xs text-neutral-500">{secondary}</div>
                ) : null}
                {row.gstin ? (
                  <div className="font-mono text-xs text-neutral-500">{row.gstin}</div>
                ) : null}
              </div>
              {canWrite ? (
                <Link
                  href={`/purchases/suppliers/${row.id}`}
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
