import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { indianAmountInWords } from '@/lib/format/amount-words';
import { PrintToolbar } from './print-toolbar';

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

interface SellerInfo {
  legal_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstin: string | null;
  pan: string | null;
  mobile: string | null;
  email: string | null;
}

interface FeedEntry {
  date: string;
  kind: 'invoice' | 'payment' | 'credit_note';
  number: string | null;
  meta: string | null;
  debit: number;
  credit: number;
  running: number;
}

function daysBetween(from: string, today: Date): number {
  const d = new Date(from);
  const a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const b = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.floor((b - a) / (24 * 60 * 60 * 1000)));
}

export default async function CustomerStatementPrintPage({ params }: { params: { id: string } }) {
  await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const [
    { data: cust },
    { data: company },
    { data: invs },
    { data: pays },
    { data: cns },
    { data: balances },
  ] = await Promise.all([
    supabase
      .from('billing_customers')
      .select(
        'id, full_name, business_name, mobile, email, gstin, address_line1, address_line2, city, state, pincode',
      )
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('company_info')
      .select(
        'legal_name, address_line1, address_line2, city, state, pincode, gstin, pan, mobile, email',
      )
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
      .select('invoice_id, balance_due')
      .eq('customer_id', params.id),
  ]);

  if (!cust) notFound();
  const customer = cust as unknown as CustomerRow;
  const seller = (company ?? null) as SellerInfo | null;
  const invoices = (invs ?? []) as Array<{
    id: string;
    invoice_number: string | null;
    invoice_date: string;
    business_line: 'rakhi' | 'kite';
    grand_total: number;
    status: 'issued' | 'cancelled';
  }>;
  const payments = (pays ?? []) as Array<{
    id: string;
    payment_number: string | null;
    payment_date: string;
    payment_method: 'cash' | 'upi' | 'bank_transfer';
    amount: number;
    reference_no: string | null;
    status: 'received' | 'cancelled';
  }>;
  const creditNotes = (cns ?? []) as unknown as Array<{
    id: string;
    credit_note_number: string | null;
    return_date: string;
    grand_total: number;
    status: 'issued' | 'cancelled';
    invoice: { invoice_number: string | null } | null;
  }>;
  const balanceByInvoice = new Map<string, number>();
  for (const b of (balances ?? []) as Array<{ invoice_id: string; balance_due: number }>) {
    balanceByInvoice.set(b.invoice_id, Number(b.balance_due));
  }

  const today = new Date();
  const buckets = { b0_30: 0, b31_60: 0, b61_90: 0, b90_plus: 0 };
  let totalDue = 0;
  for (const inv of invoices) {
    if (inv.status !== 'issued') continue;
    const due = balanceByInvoice.get(inv.id) ?? 0;
    if (due <= 0.005) continue;
    totalDue += due;
    const age = daysBetween(inv.invoice_date, today);
    if (age <= 30) buckets.b0_30 += due;
    else if (age <= 60) buckets.b31_60 += due;
    else if (age <= 90) buckets.b61_90 += due;
    else buckets.b90_plus += due;
  }

  const feed: Array<Omit<FeedEntry, 'running'>> = [];
  for (const inv of invoices) {
    const cancelled = inv.status === 'cancelled';
    feed.push({
      date: inv.invoice_date,
      kind: 'invoice',
      number: inv.invoice_number,
      meta: cancelled ? 'CANCELLED' : null,
      debit: cancelled ? 0 : Number(inv.grand_total),
      credit: 0,
    });
  }
  for (const p of payments) {
    const cancelled = p.status === 'cancelled';
    feed.push({
      date: p.payment_date,
      kind: 'payment',
      number: p.payment_number,
      meta: cancelled
        ? 'CANCELLED'
        : `${p.payment_method.toUpperCase()}${p.reference_no ? ` · ${p.reference_no}` : ''}`,
      debit: 0,
      credit: cancelled ? 0 : Number(p.amount),
    });
  }
  for (const cn of creditNotes) {
    const cancelled = cn.status === 'cancelled';
    feed.push({
      date: cn.return_date,
      kind: 'credit_note',
      number: cn.credit_note_number,
      meta: cancelled
        ? 'CANCELLED'
        : cn.invoice?.invoice_number
          ? `against ${cn.invoice.invoice_number}`
          : null,
      debit: 0,
      credit: cancelled ? 0 : Number(cn.grand_total),
    });
  }
  const KIND_ORDER: Record<FeedEntry['kind'], number> = {
    invoice: 0,
    credit_note: 1,
    payment: 2,
  };
  feed.sort((a, b) =>
    a.date === b.date ? KIND_ORDER[a.kind] - KIND_ORDER[b.kind] : a.date.localeCompare(b.date),
  );

  let running = 0;
  const feedWithRunning: FeedEntry[] = feed.map((e) => {
    running = Math.round((running + e.debit - e.credit) * 100) / 100;
    return { ...e, running };
  });

  return (
    <StatementPrintView
      customer={customer}
      seller={seller}
      feed={feedWithRunning}
      totalDue={totalDue}
      buckets={buckets}
      locale={locale}
    />
  );
}

function fmtDate(s: string | null, locale: Locale): string {
  if (!s) return '';
  return new Intl.DateTimeFormat(locale === 'gu' ? 'gu-IN' : 'en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  })
    .format(new Date(s))
    .replace(/ /g, '-');
}

function StatementPrintView({
  customer,
  seller,
  feed,
  totalDue,
  buckets,
  locale,
}: {
  customer: CustomerRow;
  seller: SellerInfo | null;
  feed: FeedEntry[];
  totalDue: number;
  buckets: { b0_30: number; b31_60: number; b61_90: number; b90_plus: number };
  locale: Locale;
}) {
  const t = useTranslations('billing.ledger.print');
  const sellerAddr = seller
    ? [seller.address_line1, seller.address_line2, seller.city, seller.state]
        .filter(Boolean)
        .join(', ')
    : '';
  const sellerPincode = seller?.pincode ?? '';
  const customerAddr = [
    customer.address_line1,
    customer.address_line2,
    customer.city,
    customer.state,
    customer.pincode,
  ]
    .filter(Boolean)
    .join(', ');
  const customerLabel = customer.business_name
    ? `${customer.business_name} (${customer.full_name})`
    : customer.full_name;
  const closingBalance = feed.length > 0 ? feed[feed.length - 1]!.running : 0;
  const amountWords = indianAmountInWords(Math.abs(totalDue));

  const numericFont: React.CSSProperties = {
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    fontVariantNumeric: 'tabular-nums',
  };

  const statementDate = new Intl.DateTimeFormat(locale === 'gu' ? 'gu-IN' : 'en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date());

  return (
    <div className="print-clean min-h-screen bg-neutral-100 print:bg-white">
      <PrintToolbar customerId={customer.id} />

      <div
        className="relative mx-auto my-6 max-w-4xl bg-white p-8 text-[12px] text-neutral-900 shadow print:my-0 print:max-w-none print:p-6 print:shadow-none"
        style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
      >
        <div className="mb-1 text-right text-[10px] text-neutral-600">{t('pageLabel')}</div>

        <div className="border-b-2 border-black pb-2 text-center">
          <div className="text-2xl font-bold tracking-widest">{t('docTitle')}</div>
        </div>

        {/* SELLER block */}
        {seller ? (
          <div className="mt-3 text-center">
            <div className="text-lg font-bold tracking-wide">{seller.legal_name ?? '—'}</div>
            <div className="text-xs text-neutral-700">
              {sellerAddr}
              {sellerPincode ? `-${sellerPincode}` : ''}
            </div>
            <div className="mt-0.5 text-xs text-neutral-700">
              {seller.mobile ? `${t('mobileLabel')}: +91 ${seller.mobile}` : null}
              {seller.email ? ` | ${t('emailLabel')}: ${seller.email}` : null}
            </div>
            <div className="text-xs text-neutral-700">
              {seller.gstin ? `${t('gstinLabel')} - ${seller.gstin}` : null}
              {seller.pan ? ` | ${t('panLabel')} - ${seller.pan}` : null}
            </div>
          </div>
        ) : null}

        {/* Customer + statement meta */}
        <div className="mt-3 grid grid-cols-2 border border-black text-xs">
          <div className="border-r border-black p-2">
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">
              {t('customerLabel')}
            </div>
            <div className="font-bold">{customerLabel}</div>
            <div className="text-neutral-700">{customerAddr || '—'}</div>
            <div className="mt-1 text-neutral-700">
              {customer.gstin ? `${t('gstinLabel')}: ${customer.gstin}` : ''}
              {customer.gstin && customer.mobile ? ' | ' : ''}
              {customer.mobile ? `${t('mobileLabel')}: +91 ${customer.mobile}` : ''}
            </div>
          </div>
          <div className="p-2">
            <table className="w-full text-xs">
              <tbody>
                <tr>
                  <td className="py-0.5 text-neutral-600">{t('statementDateLabel')}</td>
                  <td className="py-0.5">: {statementDate}</td>
                </tr>
                <tr>
                  <td className="py-0.5 text-neutral-600">{t('totalOutstanding')}</td>
                  <td className="py-0.5 font-semibold" style={numericFont}>
                    : {formatRupees(totalDue, locale)}
                  </td>
                </tr>
                <tr>
                  <td className="py-0.5 text-neutral-600">{t('inWords')}</td>
                  <td className="py-0.5 italic">: {amountWords}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Ageing buckets */}
        <table className="mt-2 w-full border-collapse border border-black text-xs">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border border-black p-1">{t('ageingLabel')}</th>
              <th className="border border-black p-1">{t('bucket0_30')}</th>
              <th className="border border-black p-1">{t('bucket31_60')}</th>
              <th className="border border-black p-1">{t('bucket61_90')}</th>
              <th className="border border-black p-1">{t('bucket90_plus')}</th>
              <th className="border border-black p-1">{t('totalLabel')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-black p-1 text-center font-semibold">
                {t('balanceDue')}
              </td>
              <td className="border border-black p-1 text-right" style={numericFont}>
                {buckets.b0_30.toFixed(2)}
              </td>
              <td className="border border-black p-1 text-right" style={numericFont}>
                {buckets.b31_60.toFixed(2)}
              </td>
              <td className="border border-black p-1 text-right" style={numericFont}>
                {buckets.b61_90.toFixed(2)}
              </td>
              <td className="border border-black p-1 text-right" style={numericFont}>
                {buckets.b90_plus.toFixed(2)}
              </td>
              <td className="border border-black p-1 text-right font-semibold" style={numericFont}>
                {totalDue.toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Full feed */}
        <table className="mt-2 w-full border-collapse border border-black text-xs">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border border-black p-1">{t('dateColumn')}</th>
              <th className="border border-black p-1">{t('refColumn')}</th>
              <th className="border border-black p-1 text-left">{t('descriptionColumn')}</th>
              <th className="border border-black p-1 text-right">{t('debitColumn')}</th>
              <th className="border border-black p-1 text-right">{t('creditColumn')}</th>
              <th className="border border-black p-1 text-right">{t('balanceColumn')}</th>
            </tr>
          </thead>
          <tbody>
            {feed.map((e, idx) => {
              const isCancelled = e.meta === 'CANCELLED';
              const desc =
                e.kind === 'invoice'
                  ? t('invoiceLine')
                  : e.kind === 'credit_note'
                    ? t('creditNoteLine')
                    : t('paymentLine');
              return (
                <tr key={idx} className={isCancelled ? 'text-neutral-400 line-through' : ''}>
                  <td className="border border-black p-1 text-center" style={numericFont}>
                    {fmtDate(e.date, locale)}
                  </td>
                  <td className="border border-black p-1 text-center font-mono">
                    {e.number ?? '—'}
                  </td>
                  <td className="border border-black p-1">
                    {desc}
                    {e.meta && !isCancelled ? (
                      <span className="ml-1 text-neutral-600">({e.meta})</span>
                    ) : null}
                  </td>
                  <td className="border border-black p-1 text-right" style={numericFont}>
                    {e.debit > 0 ? e.debit.toFixed(2) : ''}
                  </td>
                  <td className="border border-black p-1 text-right" style={numericFont}>
                    {e.credit > 0 ? e.credit.toFixed(2) : ''}
                  </td>
                  <td
                    className="border border-black p-1 text-right font-semibold"
                    style={numericFont}
                  >
                    {e.running.toFixed(2)}
                  </td>
                </tr>
              );
            })}
            {feed.length === 0 ? (
              <tr>
                <td colSpan={6} className="border border-black p-3 text-center text-neutral-500">
                  {t('noActivity')}
                </td>
              </tr>
            ) : null}
          </tbody>
          {feed.length > 0 ? (
            <tfoot>
              <tr className="bg-neutral-100">
                <td colSpan={5} className="border border-black p-1 text-right text-sm font-bold">
                  {t('closingBalance')}
                </td>
                <td
                  className="border border-black p-1 text-right text-sm font-bold"
                  style={numericFont}
                >
                  {closingBalance.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>

        <div className="mt-4 grid grid-cols-2 border-t border-neutral-300 pt-3 text-xs">
          <div className="italic">{t('eoe')}</div>
          <div className="text-right">
            <div className="mb-10">
              {t('forLabel')} <strong>{seller?.legal_name ?? '—'}</strong>
            </div>
            <div className="border-t border-black pt-1">{t('signatoryLabel')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
