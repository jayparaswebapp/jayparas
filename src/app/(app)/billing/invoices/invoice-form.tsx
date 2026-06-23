'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';
import { ServerError } from '@/components/form-status';
import { formatRupees } from '@/lib/format/locale-shared';
import type { Locale } from '@/lib/i18n/config';
import type { ActionResult } from '@/lib/rpc/action-result';
import { saveInvoiceDraftAction } from './actions';

export type BusinessLine = 'rakhi' | 'kite';

export interface InvoiceLineValues {
  sku_id: string | null;
  /**
   * Snapshot of the SKU at line-pick time. `is_discountable` is frozen here
   * (not re-read from the SKU later) so changing a SKU's discountable flag
   * doesn't re-shuffle historical invoices that already grouped lines into
   * sections at the time of print.
   */
  sku_snapshot: {
    sku_code: string;
    design_name: string;
    pack_size: number;
    is_discountable?: boolean;
  } | null;
  description: string;
  hsn_code: string;
  qty: string;
  uom: string;
  rate: string;
  discount_pct: string;
  gst_pct: string;
}

export interface InvoiceFormValues {
  id?: string;
  business_line: BusinessLine;
  customer_id: string | null;
  invoice_date: string;
  place_of_supply: string;
  notes: string;
  terms: string;
  packing_charges: string;
  delivery_charges: string;
  lines: InvoiceLineValues[];
}

export interface CustomerOption {
  id: string;
  label: string;
  city: string | null;
  state: string | null;
}

export interface SkuOption {
  id: string;
  sku_code: string;
  design_name: string;
  pack_size: number;
  price: number;
  discount_pct: number;
  is_discountable: boolean;
  /**
   * 'pack' = the SKU's stored rate is for the whole pack (e.g. ₹240/dozen);
   * 'piece' = the stored rate is per individual piece (e.g. ₹20/piece × 12).
   * Drives the qty / uom defaults when this SKU is picked on an invoice line.
   */
  rate_unit: 'pack' | 'piece';
}

const EMPTY_LINE: InvoiceLineValues = {
  sku_id: null,
  sku_snapshot: null,
  description: '',
  hsn_code: '',
  qty: '1',
  uom: 'Pcs',
  rate: '0',
  discount_pct: '0',
  gst_pct: '0',
};

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function lineFromSku(sku: SkuOption): InvoiceLineValues {
  // rate_unit = 'pack' (e.g. "1 Doz" tile): the saved price IS the per-pack
  // rate, so default qty = 1 pack and uom = the pack's friendly unit.
  // rate_unit = 'piece' (e.g. "12 pcs" tile, or any 1/3/4/6 pack): the saved
  // price is per piece, so default qty = pack_size pieces, uom = Pcs.
  const isPerPack = sku.rate_unit === 'pack';
  return {
    sku_id: sku.id,
    sku_snapshot: {
      sku_code: sku.sku_code,
      design_name: sku.design_name,
      pack_size: sku.pack_size,
      is_discountable: sku.is_discountable,
    },
    // Just the design name; the SKU code adds clutter on screen and the
    // printed invoice — the QR/label flow keeps the code, the bill doesn't
    // need to.
    description: sku.design_name,
    hsn_code: '',
    qty: isPerPack ? '1' : String(sku.pack_size),
    uom: isPerPack ? (sku.pack_size === 12 ? 'Doz' : 'Pack') : 'Pcs',
    rate: String(sku.price),
    // Auto-fill the SKU's default discount; staff can override per invoice.
    discount_pct: String(sku.discount_pct ?? 0),
    gst_pct: '0',
  };
}

export function InvoiceForm({
  initial,
  customers,
  skus,
  sellerState,
  locale,
}: {
  initial: InvoiceFormValues;
  customers: CustomerOption[];
  skus: SkuOption[];
  sellerState: string | null;
  locale: Locale;
}) {
  const t = useTranslations('billing.invoices');
  const tForm = useTranslations('billing.invoices.form');
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    saveInvoiceDraftAction,
    null,
  );

  const [businessLine, setBusinessLine] = useState<BusinessLine>(initial.business_line);
  const [customerId, setCustomerId] = useState<string>(initial.customer_id ?? '');
  const [placeOfSupply, setPlaceOfSupply] = useState<string>(initial.place_of_supply ?? '');
  const [invoiceDate, setInvoiceDate] = useState<string>(initial.invoice_date);
  const [notes, setNotes] = useState<string>(initial.notes ?? '');
  const [terms, setTerms] = useState<string>(initial.terms ?? '');
  const [packingCharges, setPackingCharges] = useState<string>(initial.packing_charges ?? '0');
  const [deliveryCharges, setDeliveryCharges] = useState<string>(initial.delivery_charges ?? '0');
  const [lines, setLines] = useState<InvoiceLineValues[]>(
    initial.lines.length ? initial.lines : [{ ...EMPTY_LINE }],
  );

  const [scanValue, setScanValue] = useState<string>('');
  const [scanError, setScanError] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);

  const skuByCode = useMemo(() => {
    const m = new Map<string, SkuOption>();
    for (const s of skus) m.set(s.sku_code.toUpperCase(), s);
    return m;
  }, [skus]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) ?? null,
    [customers, customerId],
  );

  function onCustomerChange(id: string) {
    setCustomerId(id);
    if (id) {
      const c = customers.find((x) => x.id === id);
      if (c && c.state && !placeOfSupply) setPlaceOfSupply(c.state);
    }
  }

  function updateLine(idx: number, patch: Partial<InvoiceLineValues>) {
    setLines((curr) => curr.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addBlankLine() {
    setLines((curr) => [...curr, { ...EMPTY_LINE }]);
  }

  function addOrIncrementSku(sku: SkuOption) {
    // One scan / one "add same SKU" = one more pack. With rate_unit 'pack'
    // (1 Doz tile) qty is in packs/dozens → increment by 1. With rate_unit
    // 'piece' (12 pcs / 6 / 4 / 3 / 1) qty is in pieces → increment by
    // pack_size (= pieces in one pack). Without this branch a second scan
    // of a "1 Doz" SKU would jump qty 1 → 13 and the total to rate × 13.
    const qtyPerPack = sku.rate_unit === 'pack' ? 1 : sku.pack_size;
    setLines((curr) => {
      const existingIdx = curr.findIndex((l) => l.sku_id === sku.id);
      if (existingIdx >= 0) {
        return curr.map((l, i) =>
          i === existingIdx ? { ...l, qty: String(num(l.qty) + qtyPerPack) } : l,
        );
      }
      const first = curr[0];
      const isEmptyFirst =
        curr.length === 1 && first && first.sku_id === null && !first.description;
      const fresh = lineFromSku(sku);
      return isEmptyFirst ? [fresh] : [...curr, fresh];
    });
  }

  function pickSkuForLine(idx: number, skuId: string) {
    if (!skuId) {
      updateLine(idx, { sku_id: null, sku_snapshot: null });
      return;
    }
    const s = skus.find((x) => x.id === skuId);
    if (!s) return;
    const fresh = lineFromSku(s);
    setLines((curr) => curr.map((l, i) => (i === idx ? { ...fresh, hsn_code: l.hsn_code } : l)));
  }

  function removeLine(idx: number) {
    setLines((curr) => (curr.length <= 1 ? curr : curr.filter((_, i) => i !== idx)));
  }

  function handleScan() {
    const code = scanValue.trim().toUpperCase();
    if (!code) return;
    const sku = skuByCode.get(code);
    if (!sku) {
      setScanError(`SKU ${code} not found`);
      return;
    }
    addOrIncrementSku(sku);
    setScanError(null);
    setScanValue('');
    scanInputRef.current?.focus();
  }

  const intraState = useMemo(() => {
    if (!sellerState || !placeOfSupply) return null;
    return sellerState.trim().toLowerCase() === placeOfSupply.trim().toLowerCase();
  }, [sellerState, placeOfSupply]);

  const showGst = businessLine === 'kite';

  const totals = useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    for (const l of lines) {
      const qty = num(l.qty);
      const rate = num(l.rate);
      const disc = num(l.discount_pct);
      const lineSubtotal = round2(qty * rate * (1 - disc / 100));
      const lineDiscount = round2(qty * rate * (disc / 100));
      subtotal += lineSubtotal;
      discount += lineDiscount;
      if (showGst) {
        const gstPct = num(l.gst_pct);
        if (gstPct > 0) {
          const tax = round2(lineSubtotal * (gstPct / 100));
          if (intraState) {
            const half = round2(tax / 2);
            cgst += half;
            sgst += tax - half;
          } else {
            igst += tax;
          }
        }
      }
    }
    const packing = num(packingCharges);
    const delivery = num(deliveryCharges);
    const extras = round2(packing + delivery);
    const sum = round2(subtotal + cgst + sgst + igst + extras);
    const grand = Math.round(sum);
    const round = round2(grand - sum);
    return { subtotal, discount, cgst, sgst, igst, packing, delivery, extras, round, grand };
  }, [lines, showGst, intraState, packingCharges, deliveryCharges]);

  const payload = useMemo(
    () =>
      JSON.stringify({
        header: {
          id: initial.id,
          business_line: businessLine,
          customer_id: customerId || null,
          invoice_date: invoiceDate,
          place_of_supply: placeOfSupply || undefined,
          notes: notes || undefined,
          terms: terms || undefined,
          packing_charges: num(packingCharges),
          delivery_charges: num(deliveryCharges),
        },
        lines: lines.map((l) => ({
          sku_id: l.sku_id || null,
          sku_snapshot: l.sku_snapshot,
          description: l.description || (l.sku_snapshot?.design_name ?? '—'),
          hsn_code: l.hsn_code || null,
          qty: num(l.qty),
          uom: l.uom || 'Pcs',
          rate: num(l.rate),
          discount_pct: num(l.discount_pct),
          gst_pct: showGst ? num(l.gst_pct) : 0,
        })),
      }),
    [
      initial.id,
      businessLine,
      customerId,
      invoiceDate,
      placeOfSupply,
      notes,
      terms,
      packingCharges,
      deliveryCharges,
      lines,
      showGst,
    ],
  );

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="payload" value={payload} />

      {/* Header */}
      <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          {tForm('headerSection')}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label-base">{t('businessLineLabel')}</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBusinessLine('rakhi')}
                className={`btn-ghost border ${businessLine === 'rakhi' ? 'border-brand-700 bg-brand-50 text-brand-900' : 'border-neutral-300'}`}
              >
                {t('businessLineRakhi')}
              </button>
              <button
                type="button"
                onClick={() => setBusinessLine('kite')}
                className={`btn-ghost border ${businessLine === 'kite' ? 'border-brand-700 bg-brand-50 text-brand-900' : 'border-neutral-300'}`}
              >
                {t('businessLineKite')}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="invoice_date" className="label-base">
              {tForm('invoiceDateLabel')}
            </label>
            <input
              id="invoice_date"
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              required
              className="input-base"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="customer_id" className="label-base">
              {tForm('customerLabel')}
            </label>
            <select
              id="customer_id"
              value={customerId}
              onChange={(e) => onCustomerChange(e.target.value)}
              className="input-base"
              required
            >
              <option value="">{tForm('customerPickerPlaceholder')}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {selectedCustomer ? (
              <p className="mt-1 text-xs text-neutral-600">
                {selectedCustomer.city ? (
                  <>
                    <span className="font-medium">{tForm('customerCityLabel')}:</span>{' '}
                    {selectedCustomer.city}
                  </>
                ) : (
                  <span className="text-amber-700">{tForm('customerCityMissing')}</span>
                )}
                {selectedCustomer.state ? ` · ${selectedCustomer.state}` : null}
              </p>
            ) : null}
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="place_of_supply" className="label-base">
              {tForm('placeOfSupplyLabel')}
            </label>
            <input
              id="place_of_supply"
              value={placeOfSupply}
              onChange={(e) => setPlaceOfSupply(e.target.value)}
              className="input-base"
            />
            <p className="mt-1 text-xs text-neutral-500">{tForm('placeOfSupplyHint')}</p>
          </div>
        </div>
      </section>

      {/* Scan + add */}
      <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
            {tForm('linesSection')}
          </h2>
          <button
            type="button"
            onClick={addBlankLine}
            className="btn-ghost border border-neutral-300 text-sm"
          >
            {tForm('addLineButton')}
          </button>
        </div>

        <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3">
          <label htmlFor="scan_code" className="label-base">
            {tForm('scanLabel')}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="scan_code"
              ref={scanInputRef}
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleScan();
                }
              }}
              placeholder={tForm('scanPlaceholder')}
              className="input-base flex-1 font-mono"
            />
            <button
              type="button"
              onClick={handleScan}
              className="btn-ghost border border-neutral-300"
            >
              {tForm('scanAddButton')}
            </button>
          </div>
          {scanError ? (
            <p className="mt-1 text-xs text-red-700">{scanError}</p>
          ) : (
            <p className="mt-1 text-xs text-neutral-500">{tForm('scanHint')}</p>
          )}
        </div>

        {/*
         * Spreadsheet line editor — one row per item. Item picker is the SKU
         * dropdown showing just the design name; once a SKU is picked the
         * row's description / HSN / pack snapshot fields fill in invisibly
         * (they ride into invoice_lines and onto the printed copy without
         * cluttering the entry screen). HSN and GST % columns appear only on
         * the kite line; rakhi invoices hide them so the row fits cleanly.
         */}
        <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="w-8 px-2 py-2">{tForm('snoColumn')}</th>
                <th className="px-2 py-2 text-left">{tForm('itemColumn')}</th>
                <th className="w-16 px-1 py-2">{tForm('qtyLabel')}</th>
                <th className="w-14 px-1 py-2">{tForm('uomLabel')}</th>
                {showGst ? (
                  <th className="w-20 px-1 py-2 text-left font-mono">{tForm('hsnLabel')}</th>
                ) : null}
                <th className="w-20 px-1 py-2 text-right">{tForm('mrpLabel')}</th>
                <th className="w-14 px-1 py-2 text-right">{tForm('discountColumn')}</th>
                {showGst ? (
                  <th className="w-14 px-1 py-2 text-right">{tForm('gstLabel')}</th>
                ) : null}
                <th className="w-20 px-1 py-2 text-right">{tForm('rateColumn')}</th>
                <th className="w-24 px-1 py-2 text-right">{tForm('totalColumn')}</th>
                <th className="w-6 px-1 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => {
                const qty = num(l.qty);
                const rate = num(l.rate);
                const disc = num(l.discount_pct);
                const effectiveRate = round2(rate * (1 - disc / 100));
                const lineSubtotal = round2(qty * effectiveRate);
                const lineTax = showGst ? round2((lineSubtotal * num(l.gst_pct)) / 100) : 0;
                const lineTotal = round2(lineSubtotal + lineTax);
                return (
                  <tr key={idx} className="border-t border-neutral-100 align-middle">
                    <td className="px-2 py-1 text-center text-xs text-neutral-400">{idx + 1}</td>
                    <td className="px-1 py-1">
                      <select
                        value={l.sku_id ?? ''}
                        onChange={(e) => pickSkuForLine(idx, e.target.value)}
                        className="input-base !min-h-0 !py-1 !text-sm"
                        required
                      >
                        <option value="">{tForm('skuNone')}</option>
                        {skus.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.design_name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={l.qty}
                        onChange={(e) => updateLine(idx, { qty: e.target.value })}
                        inputMode="numeric"
                        className="input-base !min-h-0 !py-1 !text-sm"
                        required
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        value={l.uom}
                        onChange={(e) => updateLine(idx, { uom: e.target.value })}
                        className="input-base !min-h-0 !py-1 !text-sm"
                      />
                    </td>
                    {showGst ? (
                      <td className="px-1 py-1">
                        <input
                          value={l.hsn_code}
                          onChange={(e) => updateLine(idx, { hsn_code: e.target.value })}
                          className="input-base !min-h-0 !py-1 !font-mono !text-sm"
                        />
                      </td>
                    ) : null}
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={l.rate}
                        onChange={(e) => updateLine(idx, { rate: e.target.value })}
                        inputMode="decimal"
                        className="input-base !min-h-0 !py-1 !text-right !text-sm"
                        required
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={l.discount_pct}
                        onChange={(e) => updateLine(idx, { discount_pct: e.target.value })}
                        inputMode="decimal"
                        className="input-base !min-h-0 !py-1 !text-right !text-sm"
                      />
                    </td>
                    {showGst ? (
                      <td className="px-1 py-1">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={l.gst_pct}
                          onChange={(e) => updateLine(idx, { gst_pct: e.target.value })}
                          inputMode="decimal"
                          className="input-base !min-h-0 !py-1 !text-right !text-sm"
                        />
                      </td>
                    ) : null}
                    <td className="px-2 py-1 text-right text-sm tabular-nums text-neutral-700">
                      {effectiveRate.toFixed(2)}
                    </td>
                    <td className="px-2 py-1 text-right text-sm font-semibold tabular-nums">
                      {lineTotal.toFixed(2)}
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        className="text-neutral-400 hover:text-red-600"
                        aria-label={tForm('removeLineLabel')}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Notes / terms */}
      <section className="grid grid-cols-1 gap-4 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-2">
        <div>
          <label htmlFor="notes" className="label-base">
            {tForm('notesLabel')}
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="input-base resize-y"
          />
        </div>
        <div>
          <label htmlFor="terms" className="label-base">
            {tForm('termsLabel')}
          </label>
          <textarea
            id="terms"
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            rows={3}
            className="input-base resize-y"
          />
        </div>
      </section>

      {/* Extras */}
      <section className="grid grid-cols-1 gap-4 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-2">
        <div>
          <label htmlFor="packing_charges" className="label-base">
            {tForm('packingChargesLabel')}
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-lg text-neutral-500">
              ₹
            </span>
            <input
              id="packing_charges"
              type="number"
              step="0.01"
              min="0"
              value={packingCharges}
              onChange={(e) => setPackingCharges(e.target.value)}
              inputMode="decimal"
              className="input-base pl-8"
            />
          </div>
        </div>
        <div>
          <label htmlFor="delivery_charges" className="label-base">
            {tForm('deliveryChargesLabel')}
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-lg text-neutral-500">
              ₹
            </span>
            <input
              id="delivery_charges"
              type="number"
              step="0.01"
              min="0"
              value={deliveryCharges}
              onChange={(e) => setDeliveryCharges(e.target.value)}
              inputMode="decimal"
              className="input-base pl-8"
            />
          </div>
        </div>
      </section>

      {/* Totals */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
          {tForm('totalsSection')}
        </h2>
        <dl className="ml-auto grid max-w-sm grid-cols-2 gap-y-1 text-sm">
          <dt className="text-neutral-600">{tForm('subtotalLabel')}</dt>
          <dd className="text-right text-neutral-900">{formatRupees(totals.subtotal, locale)}</dd>
          {/*
           * No aggregated "Discount" row: each line already shows the
           * post-discount Rate column, so a separate total would
           * double-count from the customer's perspective. Per-line discount
           * math still runs (it drives the Rate column and the saved
           * line_subtotal); we just don't surface a section-total here.
           */}
          {showGst && totals.cgst > 0 ? (
            <>
              <dt className="text-neutral-600">{tForm('cgstLabel')}</dt>
              <dd className="text-right text-neutral-900">{formatRupees(totals.cgst, locale)}</dd>
              <dt className="text-neutral-600">{tForm('sgstLabel')}</dt>
              <dd className="text-right text-neutral-900">{formatRupees(totals.sgst, locale)}</dd>
            </>
          ) : null}
          {showGst && totals.igst > 0 ? (
            <>
              <dt className="text-neutral-600">{tForm('igstLabel')}</dt>
              <dd className="text-right text-neutral-900">{formatRupees(totals.igst, locale)}</dd>
            </>
          ) : null}
          {totals.packing > 0 ? (
            <>
              <dt className="text-neutral-600">{tForm('packingChargesLabel')}</dt>
              <dd className="text-right text-neutral-900">
                + {formatRupees(totals.packing, locale)}
              </dd>
            </>
          ) : null}
          {totals.delivery > 0 ? (
            <>
              <dt className="text-neutral-600">{tForm('deliveryChargesLabel')}</dt>
              <dd className="text-right text-neutral-900">
                + {formatRupees(totals.delivery, locale)}
              </dd>
            </>
          ) : null}
          {totals.round !== 0 ? (
            <>
              <dt className="text-neutral-600">{tForm('roundOffLabel')}</dt>
              <dd className="text-right text-neutral-900">
                {totals.round > 0 ? '+ ' : '− '}
                {formatRupees(Math.abs(totals.round), locale)}
              </dd>
            </>
          ) : null}
          <dt className="border-t border-neutral-200 pt-1 text-base font-semibold text-neutral-900">
            {tForm('grandTotalLabel')}
          </dt>
          <dd className="border-t border-neutral-200 pt-1 text-right text-base font-semibold text-neutral-900">
            {formatRupees(totals.grand, locale)}
          </dd>
        </dl>
      </section>

      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" name="and_issue" value="0" className="btn-primary !w-auto px-4">
          {tForm('saveDraftButton')}
        </button>
        <button
          type="submit"
          name="and_issue"
          value="1"
          className="btn-primary !w-auto bg-brand-700 px-4"
        >
          {tForm('saveAndIssueButton')}
        </button>
        <Link href="/billing/invoices" className="btn-ghost border border-neutral-300">
          {tForm('cancelButton')}
        </Link>
      </div>
    </form>
  );
}
