import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { indianAmountInWords } from '@/lib/format/amount-words';
import { PrintToolbar } from './print-toolbar';

export const dynamic = 'force-dynamic';

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  business_line: 'rakhi' | 'kite';
  status: 'draft' | 'issued' | 'cancelled';
  invoice_date: string;
  place_of_supply: string | null;
  intra_state: boolean | null;
  notes: string | null;
  terms: string | null;
  subtotal: number;
  discount_total: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  packing_charges: number;
  delivery_charges: number;
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
  /** Frozen-at-pick-time snapshot of the SKU. We read is_discountable from
   *  here (not from the live skus table) so changing a SKU's flag later
   *  doesn't re-group historical invoices. Manual lines have a null snapshot
   *  and fall into the non-discountable section. */
  sku_snapshot: { is_discountable?: boolean } | null;
}

export default async function InvoicePrintPage({ params }: { params: { id: string } }) {
  await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const { data: inv } = await supabase
    .from('invoices')
    .select(
      'id, invoice_number, business_line, status, invoice_date, place_of_supply, intra_state, notes, terms, subtotal, discount_total, cgst_total, sgst_total, igst_total, packing_charges, delivery_charges, round_off, grand_total, customer_snapshot, seller_snapshot',
    )
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!inv) notFound();
  const invoice = inv as unknown as InvoiceRow;

  const { data: ls } = await supabase
    .from('invoice_lines')
    .select(
      'id, line_no, description, hsn_code, qty, uom, rate, discount_pct, gst_pct, line_subtotal, line_total, sku_snapshot',
    )
    .eq('invoice_id', params.id)
    .order('line_no', { ascending: true });
  const lines = (ls ?? []) as unknown as LineRow[];

  // Fall back to current company info defaults for terms (when an issued
  // invoice didn't have terms text saved, or when previewing a draft).
  const { data: company } = await supabase
    .from('company_info')
    .select('default_terms')
    .maybeSingle();
  const terms = invoice.terms ?? company?.default_terms ?? null;

  return <PrintView invoice={invoice} lines={lines} terms={terms} locale={locale} />;
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
  invoice,
  lines,
  terms,
  locale,
}: {
  invoice: InvoiceRow;
  lines: LineRow[];
  terms: string | null;
  locale: Locale;
}) {
  const t = useTranslations('billing.invoices.print');
  const seller = invoice.seller_snapshot ?? {};
  const customer = invoice.customer_snapshot ?? {};
  const isTax = invoice.business_line === 'kite';
  const showHsn = isTax;
  const showGst = isTax;

  // Numeric cells (qty, rate, amounts, totals) switch to a sans-serif font
  // for readability — the body wraps in Georgia/Times for the formal look
  // but digits in a serif at 12pt are hard to scan. Tabular-nums also keeps
  // the columns aligned on per-line subtotal rows.
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

  const amountWords = indianAmountInWords(Number(invoice.grand_total));
  const balance = Number(invoice.grand_total); // no payments tracked yet
  const sellerCity = seller.city ?? 'Valsad';

  return (
    <div className="print-clean min-h-screen bg-neutral-100 print:bg-white">
      <PrintToolbar invoiceId={invoice.id} />

      <div
        className="relative mx-auto my-6 max-w-4xl bg-white p-8 text-[12px] text-neutral-900 shadow print:my-0 print:max-w-none print:p-6 print:shadow-none"
        style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
      >
        {invoice.status === 'draft' ? (
          <div className="mb-3 rounded border-2 border-dashed border-amber-400 bg-amber-50 p-2 text-center text-sm font-semibold text-amber-800">
            {t('draftWatermark')}
          </div>
        ) : null}

        <div className="mb-1 text-right text-[10px] text-neutral-600">{t('pageLabel')}</div>

        {/* TITLE + ORIGINAL COPY */}
        <div className="relative border-b-2 border-black pb-2 text-center">
          <div className="text-2xl font-bold tracking-widest">
            {isTax ? t('docTaxInvoice') : t('docBillOfSupply')}
          </div>
          <div className="absolute right-0 top-0 border border-black px-2 py-0.5 text-[10px] tracking-widest">
            {t('originalCopy')}
          </div>
        </div>

        {/* SELLER BLOCK */}
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

        {/* BILLING DETAILS + INVOICE NUMBER */}
        <div className="mt-3 grid grid-cols-2 border border-black text-xs">
          <div className="border-r border-black p-2">
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">
              {t('billingDetails')}
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
            {customer.email ? (
              <div className="text-neutral-700">
                {t('emailLabel')}: {customer.email}
              </div>
            ) : null}
          </div>
          <div className="p-2">
            <table className="w-full text-xs">
              <tbody>
                <tr>
                  <td className="py-0.5 text-neutral-600">{t('numberLabel')}</td>
                  <td className="py-0.5 font-mono font-semibold">
                    : {invoice.invoice_number ?? '—'}
                  </td>
                </tr>
                <tr>
                  <td className="py-0.5 text-neutral-600">{t('dateLabel')}</td>
                  <td className="py-0.5">: {fmtDate(invoice.invoice_date, locale)}</td>
                </tr>
                {invoice.place_of_supply ? (
                  <tr>
                    <td className="py-0.5 text-neutral-600">{t('placeOfSupplyLabel')}</td>
                    <td className="py-0.5">: {invoice.place_of_supply}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {/* LINE ITEMS */}
        <table className="mt-2 w-full border-collapse border border-black text-xs">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border border-black p-1">{t('snoLabel')}</th>
              <th className="border border-black p-1 text-left">{t('itemDescriptionLabel')}</th>
              {showHsn ? <th className="border border-black p-1">{t('hsnLabel')}</th> : null}
              <th className="border border-black p-1">{t('qtyLabel')}</th>
              <th className="border border-black p-1">{t('unitLabel')}</th>
              <th className="border border-black p-1 text-right">{t('listPriceLabel')}</th>
              <th className="border border-black p-1 text-right">{t('discountLabel')}</th>
              <th className="border border-black p-1 text-right">{t('actualRateLabel')}</th>
              {showGst ? (
                <th className="border border-black p-1 text-right">{t('gstLabel')}</th>
              ) : null}
              <th className="border border-black p-1 text-right">{t('amountLabel')}</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              // Group lines by sku_snapshot.is_discountable. Lines without a
              // snapshot (manual entries) go in the non-discountable group.
              const discountable = lines.filter(
                (l) =>
                  (l.sku_snapshot as { is_discountable?: boolean } | null)?.is_discountable ===
                  true,
              );
              const nonDiscountable = lines.filter(
                (l) =>
                  (l.sku_snapshot as { is_discountable?: boolean } | null)?.is_discountable !==
                  true,
              );
              const sumLineTotal = (rows: LineRow[]) =>
                rows.reduce((acc, l) => acc + Number(l.line_total), 0);
              const colCount = 7 + (showHsn ? 1 : 0) + (showGst ? 1 : 0) + 1;

              const renderRow = (l: LineRow, displayIdx: number) => {
                const list = Number(l.rate);
                const disc = Number(l.discount_pct);
                const actual = Math.round(list * (1 - disc / 100) * 100) / 100;
                return (
                  <tr key={l.id} className="align-top">
                    <td className="border border-black p-1 text-center" style={numericFont}>
                      {displayIdx}
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
                      {list.toFixed(2)}
                    </td>
                    <td className="border border-black p-1 text-right" style={numericFont}>
                      {disc > 0 ? `${disc} (%)` : 'N.A.'}
                    </td>
                    <td className="border border-black p-1 text-right" style={numericFont}>
                      {actual.toFixed(2)}
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
              };

              const sectionHeader = (label: string) => (
                <tr key={`hdr-${label}`}>
                  <td
                    colSpan={colCount}
                    className="border border-black bg-neutral-50 p-1 text-left text-[11px] font-semibold uppercase tracking-wide"
                  >
                    {label}
                  </td>
                </tr>
              );

              const subtotalRow = (label: string, amount: number) => (
                <tr key={`sub-${label}`} className="font-semibold">
                  <td
                    colSpan={colCount - 1}
                    className="border border-black p-1 text-right text-[11px]"
                  >
                    {label}
                  </td>
                  <td className="border border-black p-1 text-right" style={numericFont}>
                    {amount.toFixed(2)}
                  </td>
                </tr>
              );

              const spacerRow = (key: string) => (
                <tr key={key}>
                  <td colSpan={colCount} className="border-x border-black p-2">
                    &nbsp;
                  </td>
                </tr>
              );

              const blocks: React.ReactNode[] = [];
              let runningIdx = 0;
              if (discountable.length > 0) {
                blocks.push(sectionHeader(t('sectionDiscountable')));
                for (const l of discountable) {
                  runningIdx += 1;
                  blocks.push(renderRow(l, runningIdx));
                }
                blocks.push(subtotalRow(t('sectionSubtotal'), sumLineTotal(discountable)));
              }
              if (discountable.length > 0 && nonDiscountable.length > 0) {
                // 3-line spacer between the two sections (per user spec).
                blocks.push(spacerRow('sp-1'), spacerRow('sp-2'), spacerRow('sp-3'));
              }
              if (nonDiscountable.length > 0) {
                blocks.push(sectionHeader(t('sectionNonDiscountable')));
                for (const l of nonDiscountable) {
                  runningIdx += 1;
                  blocks.push(renderRow(l, runningIdx));
                }
                blocks.push(subtotalRow(t('sectionSubtotal'), sumLineTotal(nonDiscountable)));
              }
              return blocks;
            })()}
          </tbody>
        </table>

        {/* TOTALS */}
        <div className="ml-auto mt-2 max-w-md text-xs">
          {/* No aggregated "Discount" row: the Rate column on every line is
              already post-discount, so a section-total would double-count
              from the customer's view. Per-line math still runs. */}
          {showGst && Number(invoice.cgst_total) > 0 ? (
            <Row
              label={t('cgstLabel')}
              value={Number(invoice.cgst_total).toFixed(2)}
              valueStyle={numericFont}
            />
          ) : null}
          {showGst && Number(invoice.sgst_total) > 0 ? (
            <Row
              label={t('sgstLabel')}
              value={Number(invoice.sgst_total).toFixed(2)}
              valueStyle={numericFont}
            />
          ) : null}
          {showGst && Number(invoice.igst_total) > 0 ? (
            <Row
              label={t('igstLabel')}
              value={Number(invoice.igst_total).toFixed(2)}
              valueStyle={numericFont}
            />
          ) : null}
          {Number(invoice.packing_charges) > 0 ? (
            <Row
              label={t('packingChargesLabel')}
              value={`+ ${Number(invoice.packing_charges).toFixed(2)}`}
              valueStyle={numericFont}
            />
          ) : null}
          {Number(invoice.delivery_charges) > 0 ? (
            <Row
              label={t('deliveryChargesLabel')}
              value={`+ ${Number(invoice.delivery_charges).toFixed(2)}`}
              valueStyle={numericFont}
            />
          ) : null}
          {Number(invoice.round_off) !== 0 ? (
            <Row
              label={t('roundOffLabel')}
              value={`${Number(invoice.round_off) > 0 ? '+ ' : '− '}${Math.abs(Number(invoice.round_off)).toFixed(2)}`}
              valueStyle={numericFont}
            />
          ) : null}
          <div className="mt-1 flex items-center justify-between border-y-2 border-black py-1 text-sm font-bold">
            <span>{t('totalLabel')}</span>
            <span style={numericFont}>{Number(invoice.grand_total).toFixed(0)}</span>
          </div>
          <div className="mt-1 italic text-neutral-700">{amountWords}</div>
          <div className="mt-2 border-t border-neutral-300 pt-1 text-[11px]">
            <span className="font-semibold">{t('settledByLabel')}</span> -{' '}
            {t('invoiceBalanceLabel')}: {formatRupees(balance, locale)}
          </div>
        </div>

        {/* NOTES (per-invoice) */}
        {invoice.notes ? (
          <div className="mt-3 border-t border-neutral-300 pt-2 text-xs">
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">
              {t('notesLabel')}
            </div>
            <div>{invoice.notes}</div>
          </div>
        ) : null}

        {/* TERMS */}
        <div className="mt-3 border-t border-neutral-300 pt-2 text-[11px]">
          <div className="font-semibold">{t('termsTitle')}</div>
          <div className="mb-1 italic">{t('eoe')}</div>
          {terms ? (
            <pre className="whitespace-pre-wrap font-serif">{terms}</pre>
          ) : (
            <ol className="list-decimal pl-5">
              <li>{t('defaultTerm1')}</li>
              <li>{t('defaultTerm2', { company: seller.legal_name ?? t('companyFallback') })}</li>
              <li>{t('defaultTerm3', { city: sellerCity })}</li>
            </ol>
          )}
        </div>

        {/* FOOTER: bank left / signature right */}
        <div className="mt-4 grid grid-cols-2 border-t border-neutral-300 pt-2 text-xs">
          <div>
            {seller.bank_account_no ? (
              <div>
                <span className="font-semibold">{t('accountNumberLabel')}:</span>{' '}
                <span className="font-mono">{seller.bank_account_no}</span>
              </div>
            ) : null}
            {seller.bank_name ? (
              <div>
                <span className="font-semibold">{t('bankLabel')}:</span> {seller.bank_name}
              </div>
            ) : null}
            {seller.bank_ifsc ? (
              <div>
                <span className="font-semibold">{t('ifscLabel')}:</span>{' '}
                <span className="font-mono">{seller.bank_ifsc}</span>
              </div>
            ) : null}
          </div>
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
