import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader } from '@/components/page-header';

export const dynamic = 'force-dynamic';

interface BalanceRow {
  invoice_id: string;
  invoice_number: string | null;
  customer_id: string;
  invoice_date: string;
  business_line: 'rakhi' | 'kite';
  grand_total: number;
  amount_paid: number;
  amount_credited: number;
  balance_due: number;
}

interface CustomerRow {
  id: string;
  full_name: string;
  business_name: string | null;
  city: string | null;
  group_id: string | null;
}

interface GroupRow {
  id: string;
  name: string;
}

interface CustomerLedgerRow {
  customer: CustomerRow;
  groupId: string | null;
  groupName: string | null;
  totalDue: number;
  invoiceCount: number;
  oldestInvoiceDate: string;
  oldestAgeDays: number;
  buckets: { b0_30: number; b31_60: number; b61_90: number; b90_plus: number };
}

function daysBetween(from: string, today: Date): number {
  const d = new Date(from);
  // Strip time to count whole days regardless of timezone — we use the
  // YYYY-MM-DD date stored in Postgres and today's local date.
  const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const b = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.floor((b - a) / (24 * 60 * 60 * 1000)));
}

export default async function LedgerOverviewPage({
  searchParams,
}: {
  searchParams: { q?: string; group?: string; city?: string; sort?: string };
}) {
  await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const q = (searchParams.q ?? '').trim();
  const groupFilter = (searchParams.group ?? '').trim();
  const cityFilter = (searchParams.city ?? '').trim();
  const sortKey = (searchParams.sort ?? 'amount').trim();

  const [{ data: balances }, { data: customers }, { data: groups }] = await Promise.all([
    supabase
      .from('invoice_balances')
      .select(
        'invoice_id, invoice_number, customer_id, invoice_date, business_line, grand_total, amount_paid, amount_credited, balance_due',
      )
      .gt('balance_due', 0),
    supabase
      .from('billing_customers')
      .select('id, full_name, business_name, city, group_id')
      .is('deleted_at', null),
    supabase
      .from('customer_groups')
      .select('id, name')
      .is('deleted_at', null)
      .order('name', { ascending: true }),
  ]);

  const customerById = new Map<string, CustomerRow>();
  for (const c of (customers ?? []) as CustomerRow[]) customerById.set(c.id, c);
  const groupById = new Map<string, GroupRow>();
  for (const g of (groups ?? []) as GroupRow[]) groupById.set(g.id, g);

  // Aggregate balances by customer + compute ageing buckets and oldest age.
  const today = new Date();
  const aggregated = new Map<string, CustomerLedgerRow>();
  for (const b of (balances ?? []) as BalanceRow[]) {
    const customer = customerById.get(b.customer_id);
    if (!customer) continue;
    const age = daysBetween(b.invoice_date, today);
    let entry = aggregated.get(b.customer_id);
    if (!entry) {
      entry = {
        customer,
        groupId: customer.group_id ?? null,
        groupName: customer.group_id ? (groupById.get(customer.group_id)?.name ?? null) : null,
        totalDue: 0,
        invoiceCount: 0,
        oldestInvoiceDate: b.invoice_date,
        oldestAgeDays: age,
        buckets: { b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0 },
      };
      aggregated.set(b.customer_id, entry);
    }
    entry.totalDue += Number(b.balance_due);
    entry.invoiceCount += 1;
    if (b.invoice_date < entry.oldestInvoiceDate) {
      entry.oldestInvoiceDate = b.invoice_date;
      entry.oldestAgeDays = age;
    }
    const amt = Number(b.balance_due);
    if (age <= 30) entry.buckets.b0_30 += amt;
    else if (age <= 60) entry.buckets.b31_60 += amt;
    else if (age <= 90) entry.buckets.b61_90 += amt;
    else entry.buckets.b90_plus += amt;
  }

  let rows = Array.from(aggregated.values());

  if (q.length > 0) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.customer.full_name.toLowerCase().includes(needle) ||
        (r.customer.business_name?.toLowerCase().includes(needle) ?? false),
    );
  }
  if (cityFilter) rows = rows.filter((r) => (r.customer.city ?? '') === cityFilter);
  if (groupFilter) {
    if (groupFilter === '__none__') rows = rows.filter((r) => !r.customer.group_id);
    else rows = rows.filter((r) => r.customer.group_id === groupFilter);
  }

  if (sortKey === 'oldest') {
    rows.sort((a, b) => b.oldestAgeDays - a.oldestAgeDays);
  } else if (sortKey === 'name') {
    rows.sort((a, b) =>
      (a.customer.business_name ?? a.customer.full_name).localeCompare(
        b.customer.business_name ?? b.customer.full_name,
      ),
    );
  } else {
    rows.sort((a, b) => b.totalDue - a.totalDue);
  }

  const cities = Array.from(
    new Set(
      Array.from(aggregated.values())
        .map((r) => r.customer.city)
        .filter((c): c is string => Boolean(c)),
    ),
  ).sort();

  const grandTotal = rows.reduce((acc, r) => acc + r.totalDue, 0);
  const bucketTotals = rows.reduce(
    (acc, r) => {
      acc.b0_30 += r.buckets.b0_30;
      acc.b31_60 += r.buckets.b31_60;
      acc.b61_90 += r.buckets.b61_90;
      acc.b90_plus += r.buckets.b90_plus;
      return acc;
    },
    { b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0 },
  );

  return (
    <LedgerView
      rows={rows}
      cities={cities}
      groups={(groups ?? []) as GroupRow[]}
      filters={{ q, group: groupFilter, city: cityFilter, sort: sortKey }}
      grandTotal={grandTotal}
      bucketTotals={bucketTotals}
      locale={locale}
    />
  );
}

function LedgerView({
  rows,
  cities,
  groups,
  filters,
  grandTotal,
  bucketTotals,
  locale,
}: {
  rows: CustomerLedgerRow[];
  cities: string[];
  groups: GroupRow[];
  filters: { q: string; group: string; city: string; sort: string };
  grandTotal: number;
  bucketTotals: { b0_30: number; b31_60: number; b61_90: number; b90_plus: number };
  locale: Locale;
}) {
  const t = useTranslations('billing.ledger');
  const tGroup = useTranslations('billing.ledger.group');
  const hasFilter = filters.q.length > 0 || filters.group.length > 0 || filters.city.length > 0;
  const activeGroupId =
    filters.group.length > 0 && filters.group !== '__none__' ? filters.group : null;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          activeGroupId ? (
            <Link
              href={`/billing/groups/${activeGroupId}/ledger`}
              className="btn-primary !w-auto px-4"
            >
              {tGroup('viewLedgerButton')}
            </Link>
          ) : null
        }
      />

      {/* Ageing summary across the filtered set */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <SummaryTile
          label={t('totalOutstanding')}
          value={formatRupees(grandTotal, locale)}
          accent="brand"
        />
        <SummaryTile label={t('bucket0_30')} value={formatRupees(bucketTotals.b0_30, locale)} />
        <SummaryTile label={t('bucket31_60')} value={formatRupees(bucketTotals.b31_60, locale)} />
        <SummaryTile label={t('bucket61_90')} value={formatRupees(bucketTotals.b61_90, locale)} />
        <SummaryTile
          label={t('bucket90_plus')}
          value={formatRupees(bucketTotals.b90_plus, locale)}
          accent="red"
        />
      </div>

      <form
        method="get"
        className="mb-3 grid grid-cols-1 gap-2 rounded-md border border-neutral-200 bg-white p-3 sm:grid-cols-5"
      >
        <input
          name="q"
          defaultValue={filters.q}
          placeholder={t('searchPlaceholder')}
          className="input-base sm:col-span-2"
        />
        <select name="group" defaultValue={filters.group} className="input-base">
          <option value="">{t('allGroups')}</option>
          <option value="__none__">{t('noGroup')}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select name="city" defaultValue={filters.city} className="input-base">
          <option value="">{t('allCities')}</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select name="sort" defaultValue={filters.sort} className="input-base">
          <option value="amount">{t('sortByAmount')}</option>
          <option value="oldest">{t('sortByOldest')}</option>
          <option value="name">{t('sortByName')}</option>
        </select>
        <div className="flex items-center gap-2 sm:col-span-5">
          <button type="submit" className="btn-ghost border border-neutral-300">
            {t('applyButton')}
          </button>
          {hasFilter ? (
            <Link href="/billing/ledger" className="btn-ghost border border-neutral-300 text-sm">
              {t('clearButton')}
            </Link>
          ) : null}
        </div>
      </form>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">{t('customerColumn')}</th>
              <th className="px-3 py-2">{t('groupColumn')}</th>
              <th className="px-3 py-2 text-right">{t('invoiceCountColumn')}</th>
              <th className="px-3 py-2 text-right">{t('oldestColumn')}</th>
              <th className="px-3 py-2 text-right">{t('totalDueColumn')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const label = r.customer.business_name
                ? `${r.customer.business_name} (${r.customer.full_name})`
                : r.customer.full_name;
              return (
                <tr key={r.customer.id} className="border-t border-neutral-100">
                  <td className="px-3 py-2">
                    <Link
                      href={`/billing/customers/${r.customer.id}/ledger`}
                      className="text-brand-700 hover:underline"
                    >
                      {label}
                    </Link>
                    {r.customer.city ? (
                      <div className="text-xs text-neutral-500">{r.customer.city}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-neutral-700">
                    {r.groupId && r.groupName ? (
                      <Link
                        href={`/billing/groups/${r.groupId}/ledger`}
                        className="text-brand-700 hover:underline"
                      >
                        {r.groupName}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.invoiceCount}</td>
                  <td className="px-3 py-2 text-right text-xs text-neutral-700">
                    {t('daysAgo', { days: r.oldestAgeDays })}
                  </td>
                  <td
                    className={`px-3 py-2 text-right text-sm font-semibold tabular-nums ${
                      r.oldestAgeDays > 90 ? 'text-red-700' : 'text-neutral-900'
                    }`}
                  >
                    {formatRupees(r.totalDue, locale)}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-neutral-500">
                  {hasFilter ? t('noMatches') : t('empty')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SummaryTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'brand' | 'red';
}) {
  const accentClass =
    accent === 'red'
      ? 'border-red-200 bg-red-50 text-red-900'
      : accent === 'brand'
        ? 'border-brand-200 bg-brand-50 text-brand-900'
        : 'border-neutral-200 bg-white text-neutral-900';
  return (
    <div className={`rounded-md border p-3 ${accentClass}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}
