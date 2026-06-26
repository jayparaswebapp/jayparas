import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader } from '@/components/page-header';

export const dynamic = 'force-dynamic';

type Status = 'open' | 'closed' | 'cancelled';

interface OrderRow {
  id: string;
  job_order_number: string | null;
  issue_date: string;
  expected_return_date: string | null;
  status: Status;
  lead_lady: { id: string; full_name: string } | null;
  location: { id: string; name_en: string | null; name_gu: string | null } | null;
}

interface ItemRow {
  job_order_id: string;
  qty_issued: number;
}
interface BalanceRow {
  job_order_id: string;
  qty_accepted: number;
  qty_rejected: number;
  qty_at_ll: number;
  qty_at_labourer: number;
}

interface LeadLadyRow {
  id: string;
  full_name: string;
}

const STATUS_KEYS: Record<Status, string> = {
  open: 'statusOpen',
  closed: 'statusClosed',
  cancelled: 'statusCancelled',
};

export default async function JobWorkListPage({
  searchParams,
}: {
  searchParams: { ll?: string; status?: string; from?: string; to?: string };
}) {
  const user = await requireAppUser();
  const locale = getServerLocale();
  const ll = (searchParams.ll ?? '').trim();
  const status = (searchParams.status ?? '').trim();
  const from = (searchParams.from ?? '').trim();
  const to = (searchParams.to ?? '').trim();
  const supabase = createClient();

  let q = supabase
    .from('job_orders')
    .select(
      'id, job_order_number, issue_date, expected_return_date, status, lead_lady:lead_ladies(id, full_name), location:locations(id, name_en, name_gu)',
    )
    .is('deleted_at', null)
    .order('issue_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (ll) q = q.eq('lead_lady_id', ll);
  if (status === 'open' || status === 'closed' || status === 'cancelled')
    q = q.eq('status', status);
  if (from) q = q.gte('issue_date', from);
  if (to) q = q.lte('issue_date', to);

  const [{ data: rows }, { data: lls }] = await Promise.all([
    q,
    supabase
      .from('lead_ladies')
      .select('id, full_name')
      .is('deleted_at', null)
      .order('full_name', { ascending: true }),
  ]);
  const orders = (rows ?? []) as unknown as OrderRow[];
  const leadLadies = (lls ?? []) as LeadLadyRow[];

  // Per-order roll-up of qty_issued + balance buckets so the list row can
  // show "150 issued · 60 at home · 90 at labourer".
  const orderIds = orders.map((o) => o.id);
  let qtyByOrder = new Map<string, number>();
  let balanceByOrder = new Map<
    string,
    { accepted: number; rejected: number; atLl: number; atLabourer: number }
  >();
  if (orderIds.length > 0) {
    const [{ data: items }, { data: balances }] = await Promise.all([
      supabase
        .from('job_order_items')
        .select('job_order_id, qty_issued')
        .in('job_order_id', orderIds),
      supabase
        .from('job_order_item_balances')
        .select('job_order_id, qty_accepted, qty_rejected, qty_at_ll, qty_at_labourer')
        .in('job_order_id', orderIds),
    ]);
    qtyByOrder = (items ?? ([] as ItemRow[])).reduce((acc, i) => {
      acc.set(i.job_order_id, (acc.get(i.job_order_id) ?? 0) + Number(i.qty_issued));
      return acc;
    }, new Map<string, number>());
    balanceByOrder = (balances ?? ([] as BalanceRow[])).reduce((acc, b) => {
      const cur = acc.get(b.job_order_id) ?? {
        accepted: 0,
        rejected: 0,
        atLl: 0,
        atLabourer: 0,
      };
      cur.accepted += Number(b.qty_accepted);
      cur.rejected += Number(b.qty_rejected);
      cur.atLl += Number(b.qty_at_ll);
      cur.atLabourer += Number(b.qty_at_labourer);
      acc.set(b.job_order_id, cur);
      return acc;
    }, new Map<string, typeof balanceByOrder extends Map<string, infer V> ? V : never>());
  }

  const canWrite = user.role === 'super_admin' || user.role === 'supervisor';

  return (
    <JobWorkView
      orders={orders}
      qtyByOrder={qtyByOrder}
      balanceByOrder={balanceByOrder}
      leadLadies={leadLadies}
      canWrite={canWrite}
      filters={{ ll, status, from, to }}
      locale={locale}
    />
  );
}

function JobWorkView({
  orders,
  qtyByOrder,
  balanceByOrder,
  leadLadies,
  canWrite,
  filters,
  locale,
}: {
  orders: OrderRow[];
  qtyByOrder: Map<string, number>;
  balanceByOrder: Map<
    string,
    { accepted: number; rejected: number; atLl: number; atLabourer: number }
  >;
  leadLadies: LeadLadyRow[];
  canWrite: boolean;
  filters: { ll: string; status: string; from: string; to: string };
  locale: Locale;
}) {
  const t = useTranslations('jobWork');
  const hasFilter =
    filters.ll.length > 0 ||
    filters.status.length > 0 ||
    filters.from.length > 0 ||
    filters.to.length > 0;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          canWrite ? (
            <Link href="/job-work/new" className="btn-primary !w-auto px-4">
              {t('newButton')}
            </Link>
          ) : null
        }
      />

      <form
        method="get"
        className="mb-3 grid grid-cols-1 gap-2 rounded-md border border-neutral-200 bg-white p-3 sm:grid-cols-5"
      >
        <select name="ll" defaultValue={filters.ll} className="input-base sm:col-span-2">
          <option value="">{t('allLeadLadies')}</option>
          {leadLadies.map((l) => (
            <option key={l.id} value={l.id}>
              {l.full_name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={filters.status} className="input-base">
          <option value="">{t('allStatuses')}</option>
          <option value="open">{t('statusOpen')}</option>
          <option value="closed">{t('statusClosed')}</option>
          <option value="cancelled">{t('statusCancelled')}</option>
        </select>
        <input type="date" name="from" defaultValue={filters.from} className="input-base" />
        <input type="date" name="to" defaultValue={filters.to} className="input-base" />
        <div className="flex items-center gap-2 sm:col-span-5">
          <button type="submit" className="btn-ghost border border-neutral-300">
            {t('applyButton')}
          </button>
          {hasFilter ? (
            <Link href="/job-work" className="btn-ghost border border-neutral-300 text-sm">
              {t('clearButton')}
            </Link>
          ) : null}
        </div>
      </form>

      <ul className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {orders.map((row) => {
          const dateStr = new Intl.DateTimeFormat(locale === 'gu' ? 'gu-IN' : 'en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          }).format(new Date(row.issue_date));
          const llName = row.lead_lady?.full_name ?? '—';
          const totalIssued = qtyByOrder.get(row.id) ?? 0;
          const bal = balanceByOrder.get(row.id) ?? {
            accepted: 0,
            rejected: 0,
            atLl: 0,
            atLabourer: 0,
          };
          return (
            <li key={row.id}>
              <Link
                href={`/job-work/${row.id}`}
                className="block px-4 py-3 transition hover:bg-neutral-50"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-neutral-900">
                    {row.job_order_number ?? '—'}
                  </span>
                  <StatusPill status={row.status} />
                  <span className="ml-auto text-xs text-neutral-500">{dateStr}</span>
                </div>
                <div className="mt-0.5 text-sm text-neutral-700">{llName}</div>
                <div className="mt-1 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <Stat label={t('issuedLabel')} value={totalIssued} accent="brand" />
                  <Stat label={t('atLlLabel')} value={bal.atLl} />
                  <Stat label={t('atLabourerLabel')} value={bal.atLabourer} />
                  <Stat label={t('acceptedLabel')} value={bal.accepted} accent="emerald" />
                </div>
              </Link>
            </li>
          );
        })}
        {orders.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-neutral-500">
            {hasFilter ? t('noMatches') : t('empty')}
          </li>
        ) : null}
      </ul>
    </>
  );
}

function StatusPill({ status }: { status: Status }) {
  const t = useTranslations('jobWork');
  const cls =
    status === 'open'
      ? 'bg-emerald-100 text-emerald-900'
      : status === 'cancelled'
        ? 'bg-red-100 text-red-900'
        : 'bg-neutral-200 text-neutral-700';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{t(STATUS_KEYS[status])}</span>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'brand' | 'emerald';
}) {
  const cls =
    accent === 'brand'
      ? 'border-brand-200 bg-brand-50 text-brand-900'
      : accent === 'emerald'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
        : 'border-neutral-200 bg-white text-neutral-700';
  return (
    <div className={`rounded border px-2 py-1 ${cls}`}>
      <div className="text-[9px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="font-semibold tabular-nums">{Number(value).toFixed(0)}</div>
    </div>
  );
}
