import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { indianAmountInWords } from '@/lib/format/amount-words';
import { PrintToolbar } from './print-toolbar';

export const dynamic = 'force-dynamic';

interface ReturnRow {
  id: string;
  credit_note_number: string | null;
  business_line: 'rakhi' | 'kite';
  status: 'draft' | 'issued' | 'cancelled';
  return_date: string;
  invoice_id: string;
  place_of_supply: string | null;
  intra_state: boolean | null;
  reason: string | null;
  notes: string | null;
  subtotal: number;
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

export default async function ReturnPrintPage({ params }: { params: { id: string } }) {
  await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const { data: ret } = await supabase
    .from('sales_returns')
    .select(
      'id, credit_note_number, business_line, status, return_date, invoice_id, place_of_supply, intra_state, reason, notes, subtotal, cgst_total, sgst_total, igst_total, round_off, grand_total, customer_snapshot, seller_snapshot',
    )
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!ret) notFound();
  const r = ret as unknown as ReturnRow;

  const { data: ls } = await supabase
    .from('sales_return_lines')
    .select(
      'id, line_no, description, hsn_code, qty, uom, rate, discount_pct, gst_pct, line_subtotal, line_total',
    )
    .eq('sales_return_id', params.id)
    .order('line_no', { ascending: true });
  const lines = (ls ?? []) as unknown as LineRow[];

  const { data: inv } = await supabase
    .from('invoices')
    .select('invoice_number')
    .eq('id', r.invoice_id)
    .maybeSingle();
  const invoiceNumber = (inv as { invoice_number: string | null } | null)?.invoice_number ?? null;

  return <PrintView ret={r} lines={lines} invoiceNumber={invoiceNumber} locale={locale} />;
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

function PrintView({
  ret,
  lines,
  invoiceNumber,
  locale,
}: {
  ret: ReturnRow;
  lines: LineRow[];
  invoiceNumber: string | null;
  locale: Locale;
}) {
  const t = useTranslations('billing.returns.print');
  const seller = ret.seller_snapshot ?? {};
  const customer = ret.customer_snapshot ?? {};
  const isTax = ret.business_line === 'kite';
  const showHsn = isTax;
  const showGst = isTax;

  const numericFont: React.CSSProperties = {
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    fontVariantNumeric: 'tabular-nums',
  };

  const sellerAddr = [seller.address_line1, seller.address_line2, seller.city, seller.state]
    .filter(Boolean)
    .join(', ');
  const sellerPincode = seller.pincode ?? '';
  const customerAddr = [
    customer.address_line1,
    customer.address_line2,
    customer.city,
    customer.state,
    customer.pincode,
  ]
    .filter(Boolean)
    .join(', ');

  const amountWords = indianAmountInWords(Number(ret.grand_total));

  return (
    <div className="print-clean min-h-screen bg-neutral-100 print:bg-white">
      <PrintToolbar returnId={ret.id} />

      <div
        className="relative mx-auto my-6 max-w-4xl bg-white p-8 text-[12px] text-neutral-900 shadow print:my-0 print:max-w-none print:p-6 print:shadow-none"
        style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
      >
        {ret.status === 'cancelled' ? (
          <div className="mb-3 rounded border-2 border-dashed border-red-400 bg-red-50 p-2 text-center text-sm font-semibold text-red-800">
            {t('cancelledWatermark')}
          </div>
        ) : null}

        <div className="mb-1 text-right text-[10px] text-neutral-600">{t('pageLabel')}</div>

        <div className="relative border-b-2 border-black pb-2 text-center">
          <div className="text-2xl font-bold tracking-widest">{t('docTitle')}</div>
          <div className="absolute right-0 top-0 border border-black px-2 py-0.5 text-[10px] tracking-widest">
            {t('originalCopy')}
          </div>
        </div>

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

        <div className="mt-3 grid grid-cols-2 border border-black text-xs">
          <div className="border-r border-black p-2">
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">
              {t('billedToLabel')}
            </div>
            <div className="font-bold">{customer.business_name ?? customer.full_name ?? '—'}</div>
            {customer.business_name && customer.full_name ? (
              <div className="text-neutral-700">{customer.full_name}</div>
            ) : null}
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
                  <td className="py-0.5 text-neutral-600">{t('numberLabel')}</td>
                  <td className="py-0.5 font-mono font-semibold">
                    : {ret.credit_note_number ?? '—'}
                  </td>
                </tr>
                <tr>
                  <td className="py-0.5 text-neutral-600">{t('dateLabel')}</td>
                  <td className="py-0.5">: {fmtDate(ret.return_date, locale)}</td>
                </tr>
                <tr>
                  <td className="py-0.5 text-neutral-600">{t('againstInvoiceLabel')}</td>
                  <td className="py-0.5 font-mono">: {invoiceNumber ?? '—'}</td>
                </tr>
                {ret.place_of_supply ? (
                  <tr>
                    <td className="py-0.5 text-neutral-600">{t('placeOfSupplyLabel')}</td>
                    <td className="py-0.5">: {ret.place_of_supply}</td>
                  </tr>
                ) : null}
                {ret.reason ? (
                  <tr>
                    <td className="py-0.5 text-neutral-600">{t('reasonLabel')}</td>
                    <td className="py-0.5">: {ret.reason}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <table className="mt-2 w-full border-collapse border border-black text-xs">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border border-black p-1">{t('snoLabel')}</th>
              <th className="border border-black p-1 text-left">{t('itemDescriptionLabel')}</th>
              {showHsn ? <th className="border border-black p-1">{t('hsnLabel')}</th> : null}
              <th className="border border-black p-1">{t('qtyLabel')}</th>
              <th className="border border-black p-1">{t('unitLabel')}</th>
              <th className="border border-black p-1 text-right">{t('rateLabel')}</th>
              <th className="border border-black p-1 text-right">{t('discountLabel')}</th>
              {showGst ? (
                <th className="border border-black p-1 text-right">{t('gstLabel')}</th>
              ) : null}
              <th className="border border-black p-1 text-right">{t('amountLabel')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => {
              const list = Number(l.rate);
              const disc = Number(l.discount_pct);
              const actual = Math.round(list * (1 - disc / 100) * 100) / 100;
              return (
                <tr key={l.id} className="align-top">
                  <td className="border border-black p-1 text-center" style={numericFont}>
                    {idx + 1}
                  </td>
                  <td className="border border-black p-1">{l.description}</td>
                  {showHsn ? (
                    <td
                      className="border border-black p-1 text-center font-mono"
                      style={numericFont}
                    >
                      {l.hsn_code ?? ''}
                    </td>
                  ) : null}
                  <td className="border border-black p-1 text-right" style={numericFont}>
                    {Number(l.qty).toFixed(2)}
                  </td>
                  <td className="border border-black p-1 text-center">{l.uom}</td>
                  <td className="border border-black p-1 text-right" style={numericFont}>
                    {actual.toFixed(2)}
                  </td>
                  <td className="border border-black p-1 text-right" style={numericFont}>
                    {disc > 0 ? `${disc} (%)` : 'N.A.'}
                  </td>
                  {showGst ? (
                    <td className="border border-black p-1 text-right" style={numericFont}>
                      {Number(l.gst_pct) > 0 ? `${Number(l.gst_pct)} (%)` : '—'}
                    </td>
                  ) : null}
                  <td
                    className="border border-black p-1 text-right font-semibold"
                    style={numericFont}
                  >
                    {Number(l.line_total).toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="ml-auto mt-2 max-w-md text-xs">
          {showGst && Number(ret.cgst_total) > 0 ? (
            <Row
              label={t('cgstLabel')}
              value={Number(ret.cgst_total).toFixed(2)}
              valueStyle={numericFont}
            />
          ) : null}
          {showGst && Number(ret.sgst_total) > 0 ? (
            <Row
              label={t('sgstLabel')}
              value={Number(ret.sgst_total).toFixed(2)}
              valueStyle={numericFont}
            />
          ) : null}
          {showGst && Number(ret.igst_total) > 0 ? (
            <Row
              label={t('igstLabel')}
              value={Number(ret.igst_total).toFixed(2)}
              valueStyle={numericFont}
            />
          ) : null}
          {Number(ret.round_off) !== 0 ? (
            <Row
              label={t('roundOffLabel')}
              value={`${Number(ret.round_off) > 0 ? '+ ' : '− '}${Math.abs(Number(ret.round_off)).toFixed(2)}`}
              valueStyle={numericFont}
            />
          ) : null}
          <div className="mt-1 flex items-center justify-between border-y-2 border-black py-1 text-sm font-bold">
            <span>{t('totalLabel')}</span>
            <span style={numericFont}>{Number(ret.grand_total).toFixed(0)}</span>
          </div>
          <div className="mt-1 italic text-neutral-700">{amountWords}</div>
          <div className="mt-2 border-t border-neutral-300 pt-1 text-[11px]">
            {t('creditAppliedHint')}
          </div>
        </div>

        {ret.notes ? (
          <div className="mt-3 border-t border-neutral-300 pt-2 text-xs">
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">
              {t('notesLabel')}
            </div>
            <div className="whitespace-pre-wrap">{ret.notes}</div>
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-2 border-t border-neutral-300 pt-3 text-xs">
          <div className="italic">{t('eoe')}</div>
          <div className="text-right">
            <div className="mb-10">
              {t('forLabel')} <strong>{seller.legal_name ?? '—'}</strong>
            </div>
            <div className="border-t border-black pt-1">{t('signatoryLabel')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: string;
  valueStyle?: React.CSSProperties;
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-neutral-700">{label}</span>
      <span style={valueStyle}>{value}</span>
    </div>
  );
}
