import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { indianAmountInWords } from '@/lib/format/amount-words';
import { PrintToolbar } from './print-toolbar';

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

export default async function GroupStatementPrintPage({ params }: { params: { id: string } }) {
  await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const [{ data: group }, { data: company }, { data: customers }, { data: balances }] =
    await Promise.all([
      supabase
        .from('customer_groups')
        .select('id, name, city')
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
        .from('billing_customers')
        .select(
          'id, full_name, business_name, mobile, gstin, address_line1, address_line2, city, state, pincode',
        )
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
  const seller = (company ?? null) as SellerInfo | null;
  const groupCustomers = (customers ?? []) as unknown as CustomerRow[];
  const balanceRows = (balances ?? []) as unknown as BalanceRow[];

  const customerById = new Map<string, CustomerRow>();
  for (const c of groupCustomers) customerById.set(c.id, c);

  const today = new Date();
  const bundles = new Map<string, CustomerBundle>();
  for (const b of balanceRows) {
    const c = customerById.get(b.customer_id);
    if (!c) continue;
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
    <GroupStatementView
      group={g}
      seller={seller}
      bundles={sortedBundles}
      grandTotal={grandTotal}
      bucketTotals={bucketTotals}
      locale={locale}
    />
  );
}

function GroupStatementView({
  group,
  seller,
  bundles,
  grandTotal,
  bucketTotals,
  locale,
}: {
  group: GroupRow;
  seller: SellerInfo | null;
  bundles: CustomerBundle[];
  grandTotal: number;
  bucketTotals: { b0_30: number; b31_60: number; b61_90: number; b90_plus: number };
  locale: Locale;
}) {
  const t = useTranslations('billing.ledger.group.print');
  const today = new Date();

  const numericFont: React.CSSProperties = {
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    fontVariantNumeric: 'tabular-nums',
  };

  const sellerAddr = seller
    ? [seller.address_line1, seller.address_line2, seller.city, seller.state]
        .filter(Boolean)
        .join(', ')
    : '';
  const sellerPincode = seller?.pincode ?? '';

  const statementDate = new Intl.DateTimeFormat(locale === 'gu' ? 'gu-IN' : 'en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date());

  const grandTotalWords = indianAmountInWords(Math.abs(grandTotal));

  return (
    <div className="print-clean min-h-screen bg-neutral-100 print:bg-white">
      <PrintToolbar groupId={group.id} />

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

        {/* GROUP META */}
        <div className="mt-3 grid grid-cols-2 border border-black text-xs">
          <div className="border-r border-black p-2">
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">
              {t('groupLabel')}
            </div>
            <div className="font-bold">{group.name}</div>
            {group.city ? <div className="text-neutral-700">{group.city}</div> : null}
            <div className="mt-1 text-neutral-700">
              {t('partyCount', { count: bundles.length })}
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
                    : {formatRupees(grandTotal, locale)}
                  </td>
                </tr>
                <tr>
                  <td className="py-0.5 text-neutral-600">{t('inWords')}</td>
                  <td className="py-0.5 italic">: {grandTotalWords}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* AGEING summary */}
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
                {bucketTotals.b0_30.toFixed(2)}
              </td>
              <td className="border border-black p-1 text-right" style={numericFont}>
                {bucketTotals.b31_60.toFixed(2)}
              </td>
              <td className="border border-black p-1 text-right" style={numericFont}>
                {bucketTotals.b61_90.toFixed(2)}
              </td>
              <td className="border border-black p-1 text-right" style={numericFont}>
                {bucketTotals.b90_plus.toFixed(2)}
              </td>
              <td className="border border-black p-1 text-right font-semibold" style={numericFont}>
                {grandTotal.toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* PER-CUSTOMER blocks */}
        {bundles.length === 0 ? (
          <div className="mt-3 border border-black p-4 text-center text-sm italic text-neutral-600">
            {t('noOutstanding')}
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {bundles.map((bundle, idx) => {
              const c = bundle.customer;
              const customerLabel = c.business_name
                ? `${c.business_name} (${c.full_name})`
                : c.full_name;
              const addrParts = [
                c.address_line1,
                c.address_line2,
                [c.city, c.state, c.pincode].filter(Boolean).join(', '),
              ].filter(Boolean);
              return (
                <section key={c.id} className="border border-black">
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-black bg-neutral-100 p-2">
                    <div>
                      <div className="font-bold">
                        {idx + 1}. {customerLabel}
                      </div>
                      {addrParts.map((p, i) => (
                        <div key={i} className="text-[11px] text-neutral-700">
                          {p}
                        </div>
                      ))}
                      <div className="text-[11px] text-neutral-700">
                        {c.mobile ? `+91 ${c.mobile}` : null}
                        {c.gstin ? ` · GSTIN: ${c.gstin}` : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wide text-neutral-600">
                        {t('outstandingLabel')}
                      </div>
                      <div className="text-base font-bold" style={numericFont}>
                        {formatRupees(bundle.totalDue, locale)}
                      </div>
                    </div>
                  </header>

                  <table className="w-full border-collapse text-xs">
                    <thead className="bg-neutral-50">
                      <tr>
                        <th className="border-t border-black p-1">{t('snoLabel')}</th>
                        <th className="border-t border-black p-1 text-left">
                          {t('invoiceColumn')}
                        </th>
                        <th className="border-t border-black p-1">{t('dateColumn')}</th>
                        <th className="border-t border-black p-1 text-right">{t('totalColumn')}</th>
                        <th className="border-t border-black p-1 text-right">{t('paidColumn')}</th>
                        <th className="border-t border-black p-1 text-right">
                          {t('balanceColumn')}
                        </th>
                        <th className="border-t border-black p-1 text-right">{t('ageColumn')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bundle.invoices.map((inv, i) => {
                        const age = daysBetween(inv.invoice_date, today);
                        return (
                          <tr key={inv.invoice_id}>
                            <td
                              className="border-t border-black p-1 text-center"
                              style={numericFont}
                            >
                              {i + 1}
                            </td>
                            <td className="border-t border-black p-1 font-mono">
                              {inv.invoice_number ?? '—'}
                            </td>
                            <td
                              className="border-t border-black p-1 text-center"
                              style={numericFont}
                            >
                              {fmtDate(inv.invoice_date, locale)}
                            </td>
                            <td
                              className="border-t border-black p-1 text-right"
                              style={numericFont}
                            >
                              {Number(inv.grand_total).toFixed(2)}
                            </td>
                            <td
                              className="border-t border-black p-1 text-right"
                              style={numericFont}
                            >
                              {(Number(inv.amount_paid) + Number(inv.amount_credited)).toFixed(2)}
                            </td>
                            <td
                              className="border-t border-black p-1 text-right font-semibold"
                              style={numericFont}
                            >
                              {Number(inv.balance_due).toFixed(2)}
                            </td>
                            <td
                              className={`border-t border-black p-1 text-right ${age > 90 ? 'font-semibold text-red-700' : ''}`}
                              style={numericFont}
                            >
                              {age}d
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="bg-neutral-50">
                        <td
                          colSpan={5}
                          className="border-t border-black p-1 text-right text-xs font-semibold"
                        >
                          {t('subtotalLabel')}
                        </td>
                        <td
                          className="border-t border-black p-1 text-right text-xs font-bold"
                          style={numericFont}
                        >
                          {bundle.totalDue.toFixed(2)}
                        </td>
                        <td className="border-t border-black p-1" />
                      </tr>
                    </tbody>
                  </table>
                  {/* Signature strip — staff & customer can sign once cash is
                      handed over during the collection round. */}
                  <div className="grid grid-cols-3 gap-2 border-t border-black p-2 text-[10px]">
                    <div>
                      <div className="text-neutral-500">{t('paidNowLabel')}</div>
                      <div className="mt-3 border-b border-black"></div>
                    </div>
                    <div>
                      <div className="text-neutral-500">{t('remarksLabel')}</div>
                      <div className="mt-3 border-b border-black"></div>
                    </div>
                    <div>
                      <div className="text-neutral-500">{t('customerSignatureLabel')}</div>
                      <div className="mt-3 border-b border-black"></div>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {/* GRAND TOTAL */}
        {bundles.length > 0 ? (
          <div className="ml-auto mt-4 max-w-sm border border-black">
            <div className="flex items-center justify-between border-b border-black bg-neutral-100 p-2 text-sm">
              <span className="font-semibold">{t('grandTotalLabel')}</span>
              <span className="font-bold" style={numericFont}>
                {formatRupees(grandTotal, locale)}
              </span>
            </div>
            <div className="p-2 text-[11px] italic">{grandTotalWords}</div>
          </div>
        ) : null}

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
