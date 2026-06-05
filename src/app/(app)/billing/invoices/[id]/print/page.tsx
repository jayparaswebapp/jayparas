import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PrintToolbar } from './print-toolbar';

export const dynamic = 'force-dynamic';

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  business_line: 'rakhi' | 'kite';
  status: 'draft' | 'issued' | 'cancelled';
  invoice_date: string;
  due_date: string | null;
  place_of_supply: string | null;
  intra_state: boolean | null;
  notes: string | null;
  terms: string | null;
  subtotal: number;
  discount_total: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  round_off: number;
  grand_total: number;
  customer_snapshot: Record<string, string | null> | null;
  seller_snapshot: Record<string, string | null> | null;
}

interface LineRow {
  id: string;
  line_no: number;
  description: string;
  hsn_code: string | null;
  qty: number;
  uom: string;
  rate: number;
  discount_pct: number;
  gst_pct: number;
  line_subtotal: number;
  line_total: number;
}

export default async function InvoicePrintPage({ params }: { params: { id: string } }) {
  await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const { data: inv } = await supabase
    .from('invoices')
    .select(
      'id, invoice_number, business_line, status, invoice_date, due_date, place_of_supply, intra_state, notes, terms, subtotal, discount_total, cgst_total, sgst_total, igst_total, round_off, grand_total, customer_snapshot, seller_snapshot',
    )
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!inv) notFound();
  const invoice = inv as unknown as InvoiceRow;

  const { data: ls } = await supabase
    .from('invoice_lines')
    .select(
      'id, line_no, description, hsn_code, qty, uom, rate, discount_pct, gst_pct, line_subtotal, line_total',
    )
    .eq('invoice_id', params.id)
    .order('line_no', { ascending: true });
  const lines = (ls ?? []) as unknown as LineRow[];

  return <PrintView invoice={invoice} lines={lines} locale={locale} />;
}

function fmtDate(s: string | null, locale: Locale): string {
  if (!s) return '';
  return new Intl.DateTimeFormat(locale === 'gu' ? 'gu-IN' : 'en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(s));
}

function PrintView({
  invoice,
  lines,
  locale,
}: {
  invoice: InvoiceRow;
  lines: LineRow[];
  locale: Locale;
}) {
  const t = useTranslations('billing.invoices.print');
  const seller = invoice.seller_snapshot ?? {};
  const customer = invoice.customer_snapshot ?? {};
  const showGst = invoice.business_line === 'kite';

  return (
    <div className="print-clean min-h-screen bg-neutral-100 print:bg-white">
      <PrintToolbar invoiceId={invoice.id} />

      <div className="mx-auto my-6 max-w-4xl bg-white p-8 shadow print:my-0 print:max-w-none print:shadow-none">
        {invoice.status === 'draft' ? (
          <div className="mb-4 rounded border-2 border-dashed border-amber-400 bg-amber-50 p-2 text-center text-sm font-semibold text-amber-800">
            {t('draftWatermark')}
          </div>
        ) : null}

        <header className="mb-6 flex items-start justify-between gap-6 border-b border-neutral-900 pb-4">
          <div>
            <div className="text-xl font-bold text-neutral-900">{seller.legal_name ?? '—'}</div>
            <div className="mt-1 text-sm text-neutral-700">
              {[seller.address_line1, seller.address_line2].filter(Boolean).join(', ')}
            </div>
            <div className="text-sm text-neutral-700">
              {[seller.city, seller.state, seller.pincode].filter(Boolean).join(', ')}
            </div>
            <div className="mt-1 text-sm text-neutral-700">
              {seller.mobile ? `${seller.mobile}` : null}
              {seller.email ? ` · ${seller.email}` : null}
            </div>
            {seller.gstin ? (
              <div className="mt-1 text-sm">
                <span className="text-neutral-500">{t('gstinLabel')}: </span>
                <span className="font-mono">{seller.gstin}</span>
              </div>
            ) : null}
            {seller.pan ? (
              <div className="text-sm">
                <span className="text-neutral-500">{t('panLabel')}: </span>
                <span className="font-mono">{seller.pan}</span>
              </div>
            ) : null}
          </div>
          <div className="text-right">
            <div className="text-lg font-bold uppercase tracking-wide text-neutral-900">
              {t('invoiceLabel')}
            </div>
            <div className="mt-2 text-sm">
              <span className="text-neutral-500">{t('numberLabel')}: </span>
              <span className="font-mono font-semibold">{invoice.invoice_number ?? '—'}</span>
            </div>
            <div className="text-sm">
              <span className="text-neutral-500">{t('dateLabel')}: </span>
              <span>{fmtDate(invoice.invoice_date, locale)}</span>
            </div>
            {invoice.due_date ? (
              <div className="text-sm">
                <span className="text-neutral-500">{t('dueDateLabel')}: </span>
                <span>{fmtDate(invoice.due_date, locale)}</span>
              </div>
            ) : null}
            {invoice.place_of_supply ? (
              <div className="text-sm">
                <span className="text-neutral-500">{t('placeOfSupplyLabel')}: </span>
                <span>{invoice.place_of_supply}</span>
              </div>
            ) : null}
          </div>
        </header>

        <section className="mb-5">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Billed to</div>
          <div className="mt-1 text-sm text-neutral-900">
            <div className="font-semibold">
              {customer.business_name ?? customer.full_name ?? '—'}
            </div>
            {customer.business_name && customer.full_name ? <div>{customer.full_name}</div> : null}
            <div className="text-neutral-700">
              {[customer.address_line1, customer.address_line2].filter(Boolean).join(', ')}
            </div>
            <div className="text-neutral-700">
              {[customer.city, customer.state, customer.pincode].filter(Boolean).join(', ')}
            </div>
            <div className="text-neutral-700">{customer.mobile}</div>
            {customer.gstin ? (
              <div className="mt-1">
                <span className="text-neutral-500">{t('gstinLabel')}: </span>
                <span className="font-mono">{customer.gstin}</span>
              </div>
            ) : null}
          </div>
        </section>

        <table className="mb-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-neutral-900 bg-neutral-50 text-left">
              <th className="px-2 py-2">{t('snoLabel')}</th>
              <th className="px-2 py-2">{t('descriptionLabel')}</th>
              {showGst ? <th className="px-2 py-2">{t('hsnLabel')}</th> : null}
              <th className="px-2 py-2 text-right">{t('qtyLabel')}</th>
              <th className="px-2 py-2 text-right">{t('rateLabel')}</th>
              <th className="px-2 py-2 text-right">{t('discountLabel')}</th>
              {showGst ? <th className="px-2 py-2 text-right">{t('gstLabel')}</th> : null}
              <th className="px-2 py-2 text-right">{t('amountLabel')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-neutral-200 align-top">
                <td className="px-2 py-2">{l.line_no}</td>
                <td className="px-2 py-2">{l.description}</td>
                {showGst ? (
                  <td className="px-2 py-2 font-mono text-xs">{l.hsn_code ?? ''}</td>
                ) : null}
                <td className="px-2 py-2 text-right">
                  {Number(l.qty)} {l.uom}
                </td>
                <td className="px-2 py-2 text-right">{formatRupees(Number(l.rate), locale)}</td>
                <td className="px-2 py-2 text-right">{Number(l.discount_pct)}%</td>
                {showGst ? <td className="px-2 py-2 text-right">{Number(l.gst_pct)}%</td> : null}
                <td className="px-2 py-2 text-right font-medium">
                  {formatRupees(Number(l.line_total), locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="mb-6 ml-auto max-w-sm text-sm">
          <Row label={t('subtotalLabel')} value={formatRupees(Number(invoice.subtotal), locale)} />
          {Number(invoice.discount_total) > 0 ? (
            <Row
              label="Discount"
              value={`− ${formatRupees(Number(invoice.discount_total), locale)}`}
            />
          ) : null}
          {Number(invoice.cgst_total) > 0 ? (
            <Row label={t('cgstLabel')} value={formatRupees(Number(invoice.cgst_total), locale)} />
          ) : null}
          {Number(invoice.sgst_total) > 0 ? (
            <Row label={t('sgstLabel')} value={formatRupees(Number(invoice.sgst_total), locale)} />
          ) : null}
          {Number(invoice.igst_total) > 0 ? (
            <Row label={t('igstLabel')} value={formatRupees(Number(invoice.igst_total), locale)} />
          ) : null}
          {Number(invoice.round_off) !== 0 ? (
            <Row
              label={t('roundOffLabel')}
              value={`${Number(invoice.round_off) > 0 ? '+ ' : '− '}${formatRupees(Math.abs(Number(invoice.round_off)), locale)}`}
            />
          ) : null}
          <div className="mt-1 flex items-center justify-between border-t-2 border-neutral-900 pt-1 text-base font-bold">
            <span>{t('grandTotalLabel')}</span>
            <span>{formatRupees(Number(invoice.grand_total), locale)}</span>
          </div>
        </section>

        {seller.bank_name || seller.bank_account_no || seller.bank_ifsc ? (
          <section className="mb-4 rounded border border-neutral-300 p-3 text-sm">
            <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
              {t('bankLabel')}
            </div>
            <div>
              <strong>{seller.bank_name}</strong>
            </div>
            {seller.bank_account_no ? (
              <div>
                {t('accountLabel')}: <span className="font-mono">{seller.bank_account_no}</span>
              </div>
            ) : null}
            {seller.bank_ifsc ? (
              <div>
                {t('ifscLabel')}: <span className="font-mono">{seller.bank_ifsc}</span>
              </div>
            ) : null}
          </section>
        ) : null}

        {invoice.notes ? <div className="mb-3 text-sm">{invoice.notes}</div> : null}
        {invoice.terms ? (
          <div className="border-t border-neutral-200 pt-3 text-xs text-neutral-600">
            {invoice.terms}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-neutral-600">{label}</span>
      <span>{value}</span>
    </div>
  );
}
