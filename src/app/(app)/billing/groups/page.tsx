import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/badges';

export const dynamic = 'force-dynamic';

interface GroupRow {
  id: string;
  name: string;
  city: string;
  notes: string | null;
  is_active: boolean;
  deleted_at: string | null;
  customer_count: number;
}

export default async function CustomerGroupsPage({
  searchParams,
}: {
  searchParams: { q?: string; deleted?: string };
}) {
  const user = await requireAppUser();
  const q = (searchParams.q ?? '').trim();
  const showDeleted = searchParams.deleted === '1' && user.role === 'super_admin';
  const supabase = createClient();

  let query = supabase
    .from('customer_groups')
    .select('id, name, city, notes, is_active, deleted_at')
    .order('city', { ascending: true })
    .order('name', { ascending: true });

  query = showDeleted ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null);

  if (q.length > 0) {
    const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
    query = query.or(`name.ilike.${like},city.ilike.${like}`);
  }

  const { data: rows } = await query;
  const groups = (rows ?? []) as Omit<GroupRow, 'customer_count'>[];

  let countsByGroup = new Map<string, number>();
  if (groups.length > 0) {
    const ids = groups.map((g) => g.id);
    const { data: countRows } = await supabase
      .from('billing_customers')
      .select('group_id')
      .in('group_id', ids)
      .is('deleted_at', null);
    for (const r of countRows ?? []) {
      if (!r.group_id) continue;
      countsByGroup.set(r.group_id, (countsByGroup.get(r.group_id) ?? 0) + 1);
    }
  }

  const rowsWithCount: GroupRow[] = groups.map((g) => ({
    ...g,
    customer_count: countsByGroup.get(g.id) ?? 0,
  }));

  const canWrite = user.role === 'super_admin' || user.role === 'supervisor';
  const canSeeDeletedToggle = user.role === 'super_admin';

  return (
    <GroupsView
      rows={rowsWithCount}
      query={q}
      canWrite={canWrite}
      canSeeDeletedToggle={canSeeDeletedToggle}
      showDeleted={showDeleted}
    />
  );
}

function GroupsView({
  rows,
  query,
  canWrite,
  canSeeDeletedToggle,
  showDeleted,
}: {
  rows: GroupRow[];
  query: string;
  canWrite: boolean;
  canSeeDeletedToggle: boolean;
  showDeleted: boolean;
}) {
  const t = useTranslations('billing.groups');
  const tCommon = useTranslations('common.actions');
  const hasQuery = query.length > 0;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          canWrite ? (
            <Link href="/billing/groups/new" className="btn-primary !w-auto px-4">
              {t('newButton')}
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
        {showDeleted ? <input type="hidden" name="deleted" value="1" /> : null}
        <button type="submit" className="btn-ghost border border-neutral-300">
          {t('searchLabel')}
        </button>
        {canSeeDeletedToggle ? (
          <Link
            href={showDeleted ? '/billing/groups' : '/billing/groups?deleted=1'}
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
                  <span className="font-medium text-neutral-900">{row.name}</span>
                  <StatusBadge isActive={row.is_active} isDeleted={isDeleted} />
                </div>
                <div className="text-sm text-neutral-700">{row.city}</div>
                <div className="mt-0.5 text-xs text-neutral-500">
                  {t('customersInGroup', { count: row.customer_count })}
                </div>
              </div>
              {canWrite ? (
                <Link
                  href={`/billing/groups/${row.id}`}
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
