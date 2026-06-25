import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader } from '@/components/page-header';

export const dynamic = 'force-dynamic';

interface GroupRow {
  id: string;
  name: string;
  city: string | null;
}

interface CustomerRow {
  id: string;
  full_name: string;
  business_name: string | null;
  mobile: string | null;
  city: string | null;
  group_id: string | null;
}

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

interface CustomerBundle {
  customer: CustomerRow;
  totalDue: number;
  oldestAgeDays: number;
  buckets: { b0_30: number; b31_60: number; b61_90: number; b90_plus: number };
  invoices: BalanceRow[];
}

function daysBetween(from: string, today: Date): number {
  const d = new Date(from);
  const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const b = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.floor((b - a) / (24 * 60 * 60 * 1000)));
}

export default async function GroupLedgerPage({ params }: { params: { id: string } }) {
  await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const [{ data: group }, { data: customers }, { data: balances }] = await Promise.all([
    supabase
      .from('customer_groups')
      .select('id, name, city')
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('billing_customers')
      .select('id, full_name, business_name, mobile, city, group_id')
      .eq('group_id', params.id)
      .is('deleted_at', null),
    supabase
      .from('invoice_balances')
      .select(
        'invoice_id, invoice_number, customer_id, invoice_date, business_line, grand_total, amount_paid, amount_credited, balance_due',
      )
      .gt('balance_due', 0),
  ]);

  if (!group) notFound();
  const g = group as unknown as GroupRow;
  const groupCustomers = (customers ?? []) as unknown as CustomerRow[];
  const balanceRows = (balances ?? []) as unknown as BalanceRow[];

  // Build per-customer bundle for every customer in this group that has at
  // least one balance row.
  const today = new Date();
  const customerById = new Map<string, CustomerRow>();
  for (const c of groupCustomers) customerById.set(c.id, c);

  const bundles = new Map<string, CustomerBundle>();
  for (const b of balanceRows) {
    const c = customerById.get(b.customer_id);
    if (!c) continue; // belongs to a different group
    let bundle = bundles.get(b.customer_id);
    if (!bundle) {
      bundle = {
        customer: c,
        totalDue: 0,
        oldestAgeDays: 0,
        buckets: { b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0 },
        invoices: [],
      };
      bundles.set(b.customer_id, bundle);
    }
    const due = Number(b.balance_due);
    bundle.totalDue += due;
    bundle.invoices.push(b);
    const age = daysBetween(b.invoice_date, today);
    if (age > bundle.oldestAgeDays) bundle.oldestAgeDays = age;
    if (age <= 30) bundle.buckets.b0_30 += due;
    else if (age <= 60) bundle.buckets.b31_60 += due;
    else if (age <= 90) bundle.buckets.b61_90 += due;
    else bundle.buckets.b90_plus += due;
  }

  // Sort customer bundles by oldest-first by default — the route is more
  // useful when the most overdue buyers float to the top.
  const sortedBundles = Array.from(bundles.values()).sort(
    (a, b) => b.oldestAgeDays - a.oldestAgeDays,
  );
  for (const bundle of sortedBundles) {
    bundle.invoices.sort((x, y) => x.invoice_date.localeCompare(y.invoice_date));
  }

  const grandTotal = sortedBundles.reduce((acc, b) => acc + b.totalDue, 0);
  const bucketTotals = sortedBundles.reduce(
    (acc, b) => {
      acc.b0_30 += b.buckets.b0_30;
      acc.b31_60 += b.buckets.b31_60;
      acc.b61_90 += b.buckets.b61_90;
      acc.b90_plus += b.buckets.b90_plus;
      return acc;
    },
    { b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0 },
  );

  return (
    <GroupLedgerView
      group={g}
      bundles={sortedBundles}
      grandTotal={grandTotal}
      bucketTotals={bucketTotals}
      locale={locale}
    />
  );
}

function GroupLedgerView({
  group,
  bundles,
  grandTotal,
  bucketTotals,
  locale,
}: {
  group: GroupRow;
  bundles: CustomerBundle[];
  grandTotal: number;
  bucketTotals: { b0_30: number; b31_60: number; b61_90: number; b90_plus: number };
  locale: Locale;
}) {
  const t = useTranslations('billing.ledger');
  const tGroup = useTranslations('billing.ledger.group');

  return (
    <>
      <PageHeader
        title={tGroup('title', { group: group.name })}
        subtitle={tGroup('subtitle')}
        action={
          <div className="flex items-center gap-2">
            <Link
              href={`/billing/groups/${group.id}/ledger/print`}
              className="btn-primary !w-auto px-4"
            >
              {tGroup('printRouteStatementButton')}
            </Link>
            <Link
              href={`/billing/groups/${group.id}`}
              className="btn-ghost border border-neutral-300"
            >
              {tGroup('viewGroupButton')}
            </Link>
          </div>
        }
      />

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

      {bundles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center text-sm text-neutral-500">
          {tGroup('noOutstanding')}
        </div>
      ) : (
        <div className="space-y-3">
          {bundles.map((bundle) => {
            const c = bundle.customer;
            const label = c.business_name ? `${c.business_name} (${c.full_name})` : c.full_name;
            return (
              <section
                key={c.id}
                className="overflow-hidden rounded-lg border border-neutral-200 bg-white"
              >
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2">
                  <div>
                    <Link
                      href={`/billing/customers/${c.id}/ledger`}
                      className="text-sm font-semibold text-brand-700 hover:underline"
                    >
                      {label}
                    </Link>
                    <div className="text-xs text-neutral-600">
                      {c.city ? `${c.city} · ` : ''}
                      {c.mobile ? `+91 ${c.mobile}` : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wide text-neutral-500">
                      {t('totalOutstanding')}
                    </div>
                    <div
                      className={`text-base font-bold tabular-nums ${
                        bundle.oldestAgeDays > 90 ? 'text-red-700' : 'text-neutral-900'
                      }`}
                    >
                      {formatRupees(bundle.totalDue, locale)}
                    </div>
                  </div>
                </header>
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wide text-neutral-500">
                    <tr>
                      <th className="px-3 py-1.5 text-left">{tGroup('invoiceColumn')}</th>
                      <th className="px-3 py-1.5 text-left">{tGroup('dateColumn')}</th>
                      <th className="px-3 py-1.5 text-right">{tGroup('totalColumn')}</th>
                      <th className="px-3 py-1.5 text-right">{tGroup('paidColumn')}</th>
                      <th className="px-3 py-1.5 text-right">{tGroup('balanceColumn')}</th>
                      <th className="px-3 py-1.5 text-right">{tGroup('ageColumn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bundle.invoices.map((inv) => {
                      const dateStr = new Intl.DateTimeFormat(locale === 'gu' ? 'gu-IN' : 'en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: '2-digit',
                      }).format(new Date(inv.invoice_date));
                      const age = daysBetween(inv.invoice_date, new Date());
                      return (
                        <tr key={inv.invoice_id} className="border-t border-neutral-100">
                          <td className="px-3 py-1.5 font-mono text-xs">
                            <Link
                              href={`/billing/invoices/${inv.invoice_id}`}
                              className="text-brand-700 hover:underline"
                            >
                              {inv.invoice_number ?? '—'}
                            </Link>
                          </td>
                          <td className="px-3 py-1.5 text-xs text-neutral-700">{dateStr}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {formatRupees(Number(inv.grand_total), locale)}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-neutral-600">
                            {formatRupees(
                              Number(inv.amount_paid) + Number(inv.amount_credited),
                              locale,
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
                            {formatRupees(Number(inv.balance_due), locale)}
                          </td>
                          <td
                            className={`px-3 py-1.5 text-right text-xs ${
                              age > 90 ? 'text-red-700' : 'text-neutral-600'
                            }`}
                          >
                            {t('daysAgo', { days: age })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            );
          })}
        </div>
      )}
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
