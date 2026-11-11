import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/badges';
import { NewCustomerShortcut } from './new-customer-shortcut';

export const dynamic = 'force-dynamic';

interface CustomerRow {
  id: string;
  full_name: string;
  business_name: string | null;
  mobile: string;
  gstin: string | null;
  city: string | null;
  is_active: boolean;
  deleted_at: string | null;
  group: { id: string; name: string; city: string } | null;
}

interface GroupOption {
  id: string;
  name: string;
  city: string;
}

const NO_GROUP = '__none__';

export default async function BillingCustomersPage({
  searchParams,
}: {
  searchParams: { q?: string; deleted?: string; group?: string };
}) {
  const user = await requireAppUser();
  const q = (searchParams.q ?? '').trim();
  const showDeleted = searchParams.deleted === '1' && user.role === 'super_admin';
  const groupFilter = (searchParams.group ?? '').trim();
  const supabase = createClient();

  let query = supabase
    .from('billing_customers')
    .select(
      'id, full_name, business_name, mobile, gstin, city, is_active, deleted_at, group:customer_groups(id, name, city)',
    )
    .order('full_name', { ascending: true });

  query = showDeleted ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null);

  if (q.length > 0) {
    const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
    query = query.or(
      `full_name.ilike.${like},business_name.ilike.${like},mobile.ilike.${like},gstin.ilike.${like}`,
    );
  }

  if (groupFilter === NO_GROUP) {
    query = query.is('group_id', null);
  } else if (groupFilter.length > 0) {
    query = query.eq('group_id', groupFilter);
  }

  const { data: rows } = await query;
  const customers = (rows ?? []) as unknown as CustomerRow[];

  const { data: gs } = await supabase
    .from('customer_groups')
    .select('id, name, city')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('city', { ascending: true })
    .order('name', { ascending: true });

  const groups: GroupOption[] = (gs ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    city: g.city,
  }));

  const canWrite = user.role === 'super_admin' || user.role === 'supervisor';
  const canSeeDeletedToggle = user.role === 'super_admin';

  return (
    <CustomersView
      rows={customers}
      groups={groups}
      query={q}
      groupFilter={groupFilter}
      canWrite={canWrite}
      canSeeDeletedToggle={canSeeDeletedToggle}
      showDeleted={showDeleted}
    />
  );
}

function CustomersView({
  rows,
  groups,
  query,
  groupFilter,
  canWrite,
  canSeeDeletedToggle,
  showDeleted,
}: {
  rows: CustomerRow[];
  groups: GroupOption[];
  query: string;
  groupFilter: string;
  canWrite: boolean;
  canSeeDeletedToggle: boolean;
  showDeleted: boolean;
}) {
  const t = useTranslations('billing.customers');
  const tCommon = useTranslations('common.actions');
  const hasQuery = query.length > 0 || groupFilter.length > 0;

  return (
    <>
      {canWrite ? <NewCustomerShortcut /> : null}
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          canWrite ? (
            <Link
              href="/billing/customers/new"
              title={t('newShortcutHint')}
              className="btn-primary !w-auto px-4"
            >
              {t('newButton')}
              <kbd className="ml-2 hidden rounded border border-white/40 px-1.5 py-0.5 font-mono text-[10px] text-white/90 sm:inline">
                Ctrl + A
              </kbd>
            </Link>
          ) : null
        }
      />

      <form method="get" className="mb-3 flex flex-wrap items-center gap-2">
        <label htmlFor="q" className="sr-only">
          {t('searchLabel')}
        </label>
        <input
          id="q"
          name="q"
          defaultValue={query}
          placeholder={t('searchPlaceholder')}
          className="input-base !w-auto min-w-[16rem] flex-1"
        />
        <label htmlFor="group" className="sr-only">
          {t('filterByGroupLabel')}
        </label>
        <select id="group" name="group" defaultValue={groupFilter} className="input-base !w-auto">
          <option value="">{t('filterByGroupAll')}</option>
          <option value={NO_GROUP}>{t('filterByGroupNone')}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.city} — {g.name}
            </option>
          ))}
        </select>
        {showDeleted ? <input type="hidden" name="deleted" value="1" /> : null}
        <button type="submit" className="btn-ghost border border-neutral-300">
          {t('searchLabel')}
        </button>
        {canSeeDeletedToggle ? (
          <Link
            href={showDeleted ? '/billing/customers' : '/billing/customers?deleted=1'}
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
                {row.group ? (
                  <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-900">
                    <span className="font-medium">{t('groupChipLabel')}:</span>
                    <span>
                      {row.group.city} — {row.group.name}
                    </span>
                  </div>
                ) : null}
                {row.gstin ? (
                  <div className="font-mono text-xs text-neutral-500">{row.gstin}</div>
                ) : null}
              </div>
              {canWrite ? (
                <Link
                  href={`/billing/customers/${row.id}`}
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
