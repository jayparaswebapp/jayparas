import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader } from '@/components/page-header';

export const dynamic = 'force-dynamic';

interface CustomerRow {
  id: string;
  full_name: string;
  business_name: string | null;
  mobile: string | null;
  email: string | null;
  gstin: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  business_line: 'rakhi' | 'kite';
  grand_total: number;
  status: 'issued' | 'cancelled';
}

interface PaymentRow {
  id: string;
  payment_number: string | null;
  payment_date: string;
  payment_method: 'cash' | 'upi' | 'bank_transfer';
  amount: number;
  reference_no: string | null;
  status: 'received' | 'cancelled';
}

interface CreditNoteRow {
  id: string;
  credit_note_number: string | null;
  return_date: string;
  invoice_id: string;
  grand_total: number;
  status: 'issued' | 'cancelled';
  invoice: { invoice_number: string | null } | null;
}

interface BalanceRow {
  invoice_id: string;
  balance_due: number;
  amount_paid: number;
  amount_credited: number;
}

interface FeedEntry {
  date: string;
  kind: 'invoice' | 'payment' | 'credit_note';
  number: string | null;
  label: string;
  debit: number;
  credit: number;
  href: string;
  ageDays?: number;
  meta?: string;
}

function daysBetween(from: string, today: Date): number {
  const d = new Date(from);
  const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const b = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.floor((b - a) / (24 * 60 * 60 * 1000)));
}

const METHOD_LABEL: Record<PaymentRow['payment_method'], string> = {
  cash: 'methodCash',
  upi: 'methodUpi',
  bank_transfer: 'methodBankTransfer',
};

export default async function CustomerLedgerPage({ params }: { params: { id: string } }) {
  await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const [{ data: cust }, { data: invs }, { data: pays }, { data: cns }, { data: balances }] =
    await Promise.all([
      supabase
        .from('billing_customers')
        .select(
          'id, full_name, business_name, mobile, email, gstin, address_line1, address_line2, city, state, pincode',
        )
        .eq('id', params.id)
        .is('deleted_at', null)
        .maybeSingle(),
      supabase
        .from('invoices')
        .select('id, invoice_number, invoice_date, business_line, grand_total, status')
        .eq('customer_id', params.id)
        .is('deleted_at', null)
        .in('status', ['issued', 'cancelled'])
        .order('invoice_date', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('payments')
        .select('id, payment_number, payment_date, payment_method, amount, reference_no, status')
        .eq('customer_id', params.id)
        .is('deleted_at', null)
        .order('payment_date', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('sales_returns')
        .select(
          'id, credit_note_number, return_date, invoice_id, grand_total, status, invoice:invoices(invoice_number)',
        )
        .eq('customer_id', params.id)
        .is('deleted_at', null)
        .neq('status', 'draft')
        .order('return_date', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('invoice_balances')
        .select('invoice_id, balance_due, amount_paid, amount_credited')
        .eq('customer_id', params.id),
    ]);

  if (!cust) notFound();
  const customer = cust as unknown as CustomerRow;
  const invoices = (invs ?? []) as unknown as InvoiceRow[];
  const payments = (pays ?? []) as unknown as PaymentRow[];
  const creditNotes = (cns ?? []) as unknown as CreditNoteRow[];
  const balanceByInvoice = new Map<string, BalanceRow>();
  for (const b of (balances ?? []) as BalanceRow[]) balanceByInvoice.set(b.invoice_id, b);

  // Ageing snapshot — buckets over CURRENTLY unsettled invoices only.
  const today = new Date();
  const buckets = { b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0 };
  let totalDue = 0;
  for (const inv of invoices) {
    if (inv.status !== 'issued') continue;
    const bal = balanceByInvoice.get(inv.id);
    const due = Number(bal?.balance_due ?? 0);
    if (due <= 0.005) continue;
    totalDue += due;
    const age = daysBetween(inv.invoice_date, today);
    if (age <= 30) buckets.b0_30 += due;
    else if (age <= 60) buckets.b31_60 += due;
    else if (age <= 90) buckets.b61_90 += due;
    else buckets.b90_plus += due;
  }

  // Chronological mixed feed with running balance — debit when an invoice
  // gets billed (customer owes us more) and credit when a payment lands or a
  // credit note is issued (customer's outstanding drops). Cancelled rows are
  // shown but contribute 0 to the running balance so the ledger still
  // reflects audit history.
  const feed: FeedEntry[] = [];
  for (const inv of invoices) {
    const cancelled = inv.status === 'cancelled';
    feed.push({
      date: inv.invoice_date,
      kind: 'invoice',
      number: inv.invoice_number,
      label: 'invoiceLine',
      debit: cancelled ? 0 : Number(inv.grand_total),
      credit: 0,
      href: `/billing/invoices/${inv.id}`,
      ageDays: daysBetween(inv.invoice_date, today),
      meta: cancelled ? 'cancelled' : undefined,
    });
  }
  for (const p of payments) {
    const cancelled = p.status === 'cancelled';
    feed.push({
      date: p.payment_date,
      kind: 'payment',
      number: p.payment_number,
      label: METHOD_LABEL[p.payment_method],
      debit: 0,
      credit: cancelled ? 0 : Number(p.amount),
      href: `/billing/payments/${p.id}`,
      meta: cancelled ? 'cancelled' : (p.reference_no ?? undefined),
    });
  }
  for (const cn of creditNotes) {
    const cancelled = cn.status === 'cancelled';
    feed.push({
      date: cn.return_date,
      kind: 'credit_note',
      number: cn.credit_note_number,
      label: 'creditNoteLine',
      debit: 0,
      credit: cancelled ? 0 : Number(cn.grand_total),
      href: `/billing/returns/${cn.id}`,
      meta: cn.invoice?.invoice_number
        ? cancelled
          ? `cancelledAgainst:${cn.invoice.invoice_number}`
          : `against:${cn.invoice.invoice_number}`
        : cancelled
          ? 'cancelled'
          : undefined,
    });
  }
  // Stable chronological order — by date, with invoices ahead of payments on
  // the same day (a payment made on the bill date is read as settling that
  // day's invoice, not a pre-payment).
  const KIND_ORDER: Record<FeedEntry['kind'], number> = {
    invoice: 0,
    credit_note: 1,
    payment: 2,
  };
  feed.sort((a, b) =>
    a.date === b.date ? KIND_ORDER[a.kind] - KIND_ORDER[b.kind] : a.date.localeCompare(b.date),
  );

  let running = 0;
  const feedWithRunning = feed.map((e) => {
    running = Math.round((running + e.debit - e.credit) * 100) / 100;
    return { ...e, running };
  });

  return (
    <CustomerLedgerView
      customer={customer}
      feed={feedWithRunning}
      totalDue={totalDue}
      buckets={buckets}
      locale={locale}
    />
  );
}

function CustomerLedgerView({
  customer,
  feed,
  totalDue,
  buckets,
  locale,
}: {
  customer: CustomerRow;
  feed: Array<FeedEntry & { running: number }>;
  totalDue: number;
  buckets: { b0_30: number; b31_60: number; b61_90: number; b90_plus: number };
  locale: Locale;
}) {
  const t = useTranslations('billing.ledger');
  const tPay = useTranslations('billing.payments');

  const customerLabel = customer.business_name
    ? `${customer.business_name} (${customer.full_name})`
    : customer.full_name;
  const addrParts = [
    customer.address_line1,
    customer.address_line2,
    [customer.city, customer.state, customer.pincode].filter(Boolean).join(', '),
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        title={customerLabel}
        subtitle={t('customerLedgerSubtitle')}
        action={
          <div className="flex items-center gap-2">
            <Link
              href={`/billing/customers/${customer.id}/ledger/print`}
              className="btn-primary !w-auto px-4"
            >
              {t('printStatementButton')}
            </Link>
            <Link
              href={`/billing/customers/${customer.id}`}
              className="btn-ghost border border-neutral-300"
            >
              {t('viewProfileButton')}
            </Link>
          </div>
        }
      />

      {/* Customer block + ageing summary */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-neutral-200 bg-white p-3 text-sm sm:col-span-1">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">
            {t('customerLabel')}
          </div>
          <div className="mt-1 font-semibold">{customerLabel}</div>
          {addrParts.map((p, i) => (
            <div key={i} className="text-neutral-700">
              {p}
            </div>
          ))}
          {customer.mobile ? (
            <div className="mt-1 text-neutral-700">+91 {customer.mobile}</div>
          ) : null}
          {customer.gstin ? <div className="text-neutral-700">GSTIN: {customer.gstin}</div> : null}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:col-span-2">
          <SummaryTile
            label={t('totalOutstanding')}
            value={formatRupees(totalDue, locale)}
            accent="brand"
          />
          <SummaryTile label={t('bucket0_30')} value={formatRupees(buckets.b0_30, locale)} />
          <SummaryTile label={t('bucket31_60')} value={formatRupees(buckets.b31_60, locale)} />
          <SummaryTile label={t('bucket61_90')} value={formatRupees(buckets.b61_90, locale)} />
          <SummaryTile
            label={t('bucket90_plus')}
            value={formatRupees(buckets.b90_plus, locale)}
            accent="red"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">{t('dateColumn')}</th>
              <th className="px-3 py-2">{t('descriptionColumn')}</th>
              <th className="px-3 py-2 text-right">{t('debitColumn')}</th>
              <th className="px-3 py-2 text-right">{t('creditColumn')}</th>
              <th className="px-3 py-2 text-right">{t('balanceColumn')}</th>
            </tr>
          </thead>
          <tbody>
            {feed.map((e, idx) => {
              const dateStr = new Intl.DateTimeFormat(locale === 'gu' ? 'gu-IN' : 'en-IN', {
                day: '2-digit',
                month: 'short',
                year: '2-digit',
              }).format(new Date(e.date));
              const isCancelled = e.meta === 'cancelled' || e.meta?.startsWith('cancelledAgainst:');
              return (
                <tr
                  key={idx}
                  className={`border-t border-neutral-100 ${isCancelled ? 'text-neutral-400 line-through' : ''}`}
                >
                  <td className="px-3 py-2 text-xs">{dateStr}</td>
                  <td className="px-3 py-2">
                    <Link href={e.href} className="text-brand-700 hover:underline">
                      <span className="font-mono text-xs">{e.number ?? '—'}</span>
                    </Link>{' '}
                    <span className="text-xs text-neutral-600">
                      {e.kind === 'invoice'
                        ? t('invoiceLine')
                        : e.kind === 'credit_note'
                          ? t('creditNoteLine')
                          : tPay(e.label)}
                    </span>
                    {e.meta && !isCancelled ? (
                      <span className="ml-1 text-xs text-neutral-500">
                        (
                        {e.meta.startsWith('against:')
                          ? `${t('againstLabel')}: ${e.meta.slice('against:'.length)}`
                          : e.meta}
                        )
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {e.debit > 0 ? formatRupees(e.debit, locale) : ''}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {e.credit > 0 ? formatRupees(e.credit, locale) : ''}
                  </td>
                  <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums">
                    {formatRupees(e.running, locale)}
                  </td>
                </tr>
              );
            })}
            {feed.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-neutral-500">
                  {t('noActivity')}
                </td>
              </tr>
            ) : null}
          </tbody>
          {feed.length > 0 ? (
            <tfoot className="bg-neutral-50">
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right text-sm font-semibold">
                  {t('closingBalance')}
                </td>
                <td className="px-3 py-2 text-right text-sm font-bold tabular-nums">
                  {formatRupees(feed[feed.length - 1]?.running ?? 0, locale)}
                </td>
              </tr>
            </tfoot>
          ) : null}
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
