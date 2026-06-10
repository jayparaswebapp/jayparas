'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';
import { ServerError } from '@/components/form-status';
import { formatRupees } from '@/lib/format/locale-shared';
import type { Locale } from '@/lib/i18n/config';
import type { ActionResult } from '@/lib/rpc/action-result';
import { savePurchaseBillDraftAction } from './actions';
import { scanBillAction, type ScanBillResult } from './scan-action';

export type BusinessLine = 'rakhi' | 'kite';

export interface BillLineValues {
  item_id: string | null;
  item_snapshot: { item_code: string; name: string; uom: string } | null;
  description: string;
  hsn_code: string;
  qty: string;
  uom: string;
  rate: string;
  discount_pct: string;
  gst_pct: string;
}

export interface BillFormValues {
  id?: string;
  business_line: BusinessLine;
  supplier_id: string | null;
  supplier_bill_number: string;
  bill_date: string;
  place_of_supply: string;
  notes: string;
  lines: BillLineValues[];
}

export interface SupplierOption {
  id: string;
  label: string;
  state: string | null;
}

export interface ItemOption {
  id: string;
  item_code: string;
  name: string;
  uom: string;
  hsn_code: string | null;
  default_rate: number;
  default_gst_pct: number;
}

const EMPTY_LINE: BillLineValues = {
  item_id: null,
  item_snapshot: null,
  description: '',
  hsn_code: '',
  qty: '1',
  uom: 'pcs',
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

function lineFromItem(item: ItemOption, showGst: boolean): BillLineValues {
  return {
    item_id: item.id,
    item_snapshot: { item_code: item.item_code, name: item.name, uom: item.uom },
    description: `${item.name} (${item.item_code})`,
    hsn_code: item.hsn_code ?? '',
    qty: '1',
    uom: item.uom,
    rate: String(item.default_rate),
    discount_pct: '0',
    gst_pct: showGst ? String(item.default_gst_pct) : '0',
  };
}

export function BillForm({
  initial,
  suppliers,
  items,
  buyerState,
  locale,
}: {
  initial: BillFormValues;
  suppliers: SupplierOption[];
  items: ItemOption[];
  buyerState: string | null;
  locale: Locale;
}) {
  const tForm = useTranslations('purchases.bills.form');
  const tList = useTranslations('purchases.bills');
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    savePurchaseBillDraftAction,
    null,
  );

  const [businessLine, setBusinessLine] = useState<BusinessLine>(initial.business_line);
  const [supplierId, setSupplierId] = useState<string>(initial.supplier_id ?? '');
  const [supplierBillNumber, setSupplierBillNumber] = useState<string>(
    initial.supplier_bill_number ?? '',
  );
  const [placeOfSupply, setPlaceOfSupply] = useState<string>(initial.place_of_supply ?? '');
  const [billDate, setBillDate] = useState<string>(initial.bill_date);
  const [notes, setNotes] = useState<string>(initial.notes ?? '');
  const [lines, setLines] = useState<BillLineValues[]>(
    initial.lines.length ? initial.lines : [{ ...EMPTY_LINE }],
  );

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === supplierId) ?? null,
    [suppliers, supplierId],
  );

  const showGst = businessLine === 'kite';

  function onSupplierChange(id: string) {
    setSupplierId(id);
    if (id) {
      const s = suppliers.find((x) => x.id === id);
      if (s && s.state && !placeOfSupply) setPlaceOfSupply(s.state);
    }
  }

  function updateLine(idx: number, patch: Partial<BillLineValues>) {
    setLines((curr) => curr.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function pickItemForLine(idx: number, itemId: string) {
    if (!itemId) {
      updateLine(idx, { item_id: null, item_snapshot: null });
      return;
    }
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    const fresh = lineFromItem(it, showGst);
    setLines((curr) => curr.map((l, i) => (i === idx ? fresh : l)));
  }

  function addLine() {
    setLines((curr) => [...curr, { ...EMPTY_LINE }]);
  }
  function removeLine(idx: number) {
    setLines((curr) => (curr.length <= 1 ? curr : curr.filter((_, i) => i !== idx)));
  }

  // ── Scan-bill: Claude vision API extracts an invoice photo into form state.
  // The whole flow lives on the new-bill form so staff can review and edit
  // before saving — we never auto-post a draft on scan.
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanNotice, setScanNotice] = useState<string | null>(null);

  function applyScannedBill(result: Extract<ScanBillResult, { ok: true }>) {
    const { data, matchedSupplierId } = result;

    // Infer business line from line-level GST presence: any non-zero GST → kite.
    const hasGst = data.lines.some((l) => (l.gst_pct ?? 0) > 0);
    const inferredBusinessLine: BusinessLine = hasGst ? 'kite' : 'rakhi';
    setBusinessLine(inferredBusinessLine);

    if (matchedSupplierId) {
      setSupplierId(matchedSupplierId);
      const sup = suppliers.find((s) => s.id === matchedSupplierId);
      if (sup?.state) setPlaceOfSupply(sup.state);
    } else if (data.supplier.state_name) {
      setPlaceOfSupply(data.supplier.state_name);
    }

    if (data.invoice_number) setSupplierBillNumber(data.invoice_number);
    if (data.invoice_date) setBillDate(data.invoice_date);

    if (data.lines.length > 0) {
      setLines(
        data.lines.map((l) => ({
          item_id: null,
          item_snapshot: null,
          description: l.description,
          hsn_code: l.hsn_code ?? '',
          qty: String(l.qty),
          uom: l.uom ?? 'pcs',
          rate: String(l.rate),
          discount_pct: String(l.discount_pct ?? 0),
          gst_pct: inferredBusinessLine === 'kite' ? String(l.gst_pct ?? 0) : '0',
        })),
      );
    }

    const supplierLabel = data.supplier.name ?? data.supplier.gstin ?? 'unknown supplier';
    const noticeParts = [
      `Filled from scan: ${supplierLabel}.`,
      matchedSupplierId
        ? 'Supplier matched by GSTIN.'
        : data.supplier.gstin
          ? `No supplier in our list with GSTIN ${data.supplier.gstin} — pick or create one before saving.`
          : 'No GSTIN found on the bill — pick the supplier manually.',
      'Review every field before saving.',
    ];
    setScanNotice(noticeParts.join(' '));
  }

  async function onScanFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setScanning(true);
    setScanError(null);
    setScanNotice(null);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const result = await scanBillAction(fd);
      if (!result.ok) {
        const messages: Record<typeof result.error, string> = {
          no_image: 'No image found in upload.',
          image_too_large: 'Image is larger than 10 MB. Take a smaller photo.',
          unsupported_image_type: 'Only JPEG, PNG, or WebP images are supported.',
          api_key_missing:
            'AI extraction is not configured on this deployment. Ask the admin to set ANTHROPIC_API_KEY.',
          extraction_failed:
            'Could not read the bill. Try a clearer, well-lit photo, or fill the form manually.',
        };
        setScanError(messages[result.error]);
        return;
      }
      applyScannedBill(result);
    } catch (err) {
      console.error(err);
      setScanError('Scan failed unexpectedly. Try again or fill the form manually.');
    } finally {
      setScanning(false);
    }
  }

  const intraState = useMemo(() => {
    if (!buyerState || !placeOfSupply) return null;
    return buyerState.trim().toLowerCase() === placeOfSupply.trim().toLowerCase();
  }, [buyerState, placeOfSupply]);

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
    const sum = round2(subtotal + cgst + sgst + igst);
    const grand = Math.round(sum);
    const round = round2(grand - sum);
    return { subtotal, discount, cgst, sgst, igst, round, grand };
  }, [lines, showGst, intraState]);

  const payload = useMemo(
    () =>
      JSON.stringify({
        header: {
          id: initial.id,
          business_line: businessLine,
          supplier_id: supplierId || null,
          supplier_bill_number: supplierBillNumber || undefined,
          bill_date: billDate,
          place_of_supply: placeOfSupply || undefined,
          notes: notes || undefined,
        },
        lines: lines.map((l) => ({
          item_id: l.item_id || null,
          item_snapshot: l.item_snapshot,
          description: l.description || (l.item_snapshot?.name ?? '—'),
          hsn_code: l.hsn_code || null,
          qty: num(l.qty),
          uom: l.uom || 'pcs',
          rate: num(l.rate),
          discount_pct: num(l.discount_pct),
          gst_pct: showGst ? num(l.gst_pct) : 0,
        })),
      }),
    [
      initial.id,
      businessLine,
      supplierId,
      supplierBillNumber,
      billDate,
      placeOfSupply,
      notes,
      lines,
      showGst,
    ],
  );

  return (
    <div className="space-y-6">
      {/* Scan-bill banner — Claude vision extracts a photo into the form below. */}
      <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-amber-900">
            <div className="font-semibold">Scan a supplier bill (beta)</div>
            <div className="mt-0.5 text-xs text-amber-800">
              Snap a clear photo of the printed invoice. AI fills supplier, items, totals — you
              review before saving.
            </div>
          </div>
          <input
            ref={scanInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={onScanFileChosen}
          />
          <button
            type="button"
            onClick={() => scanInputRef.current?.click()}
            disabled={scanning}
            className="btn-primary !w-auto whitespace-nowrap px-4"
          >
            {scanning ? 'Reading…' : 'Scan bill'}
          </button>
        </div>
        {scanError ? (
          <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {scanError}
          </p>
        ) : null}
        {scanNotice ? (
          <p className="mt-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
            {scanNotice}
          </p>
        ) : null}
      </section>

      <form action={formAction} className="space-y-6">
        <input type="hidden" name="payload" value={payload} />

        {/* Header */}
        <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
            {tForm('headerSection')}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label-base">{tList('businessLineLabel')}</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBusinessLine('rakhi')}
                  className={`btn-ghost border ${businessLine === 'rakhi' ? 'border-brand-700 bg-brand-50 text-brand-900' : 'border-neutral-300'}`}
                >
                  {tList('businessLineRakhi')}
                </button>
                <button
                  type="button"
                  onClick={() => setBusinessLine('kite')}
                  className={`btn-ghost border ${businessLine === 'kite' ? 'border-brand-700 bg-brand-50 text-brand-900' : 'border-neutral-300'}`}
                >
                  {tList('businessLineKite')}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="bill_date" className="label-base">
                {tForm('billDateLabel')}
              </label>
              <input
                id="bill_date"
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                required
                className="input-base"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="supplier_id" className="label-base">
                {tForm('supplierLabel')}
              </label>
              <select
                id="supplier_id"
                value={supplierId}
                onChange={(e) => onSupplierChange(e.target.value)}
                className="input-base"
                required
              >
                <option value="">{tForm('supplierPickerPlaceholder')}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              {selectedSupplier?.state ? (
                <p className="mt-1 text-xs text-neutral-600">{selectedSupplier.state}</p>
              ) : null}
            </div>

            <div>
              <label htmlFor="supplier_bill_number" className="label-base">
                {tForm('supplierBillNumberLabel')}
              </label>
              <input
                id="supplier_bill_number"
                value={supplierBillNumber}
                onChange={(e) => setSupplierBillNumber(e.target.value)}
                className="input-base font-mono"
              />
              <p className="mt-1 text-xs text-neutral-500">{tForm('supplierBillNumberHint')}</p>
            </div>

            <div>
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

        {/* Lines */}
        <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
              {tForm('linesSection')}
            </h2>
            <button
              type="button"
              onClick={addLine}
              className="btn-ghost border border-neutral-300 text-sm"
            >
              {tForm('addLineButton')}
            </button>
          </div>

          <div className="space-y-3">
            {lines.map((l, idx) => {
              const qty = num(l.qty);
              const rate = num(l.rate);
              const disc = num(l.discount_pct);
              const lineSubtotal = round2(qty * rate * (1 - disc / 100));
              const lineTax = showGst ? round2((lineSubtotal * num(l.gst_pct)) / 100) : 0;
              const lineTotal = round2(lineSubtotal + lineTax);
              return (
                <div key={idx} className="space-y-2 rounded-md border border-neutral-200 p-3">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                    <div className="sm:col-span-5">
                      <label className="text-xs font-medium text-neutral-600">
                        {tForm('itemLabel')}
                      </label>
                      <select
                        value={l.item_id ?? ''}
                        onChange={(e) => pickItemForLine(idx, e.target.value)}
                        className="input-base"
                      >
                        <option value="">{tForm('itemNone')}</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.item_code} — {it.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-7">
                      <label className="text-xs font-medium text-neutral-600">
                        {tForm('descriptionLabel')}
                      </label>
                      <input
                        value={l.description}
                        onChange={(e) => updateLine(idx, { description: e.target.value })}
                        className="input-base"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
                    {showGst ? (
                      <div className="sm:col-span-2">
                        <label className="text-xs font-medium text-neutral-600">
                          {tForm('hsnLabel')}
                        </label>
                        <input
                          value={l.hsn_code}
                          onChange={(e) => updateLine(idx, { hsn_code: e.target.value })}
                          className="input-base font-mono"
                        />
                      </div>
                    ) : null}
                    <div className="sm:col-span-2">
                      <label className="text-xs font-medium text-neutral-600">
                        {tForm('qtyLabel')}
                      </label>
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={l.qty}
                        onChange={(e) => updateLine(idx, { qty: e.target.value })}
                        inputMode="decimal"
                        className="input-base"
                        required
                      />
                    </div>
                    <div className="sm:col-span-1">
                      <label className="text-xs font-medium text-neutral-600">
                        {tForm('uomLabel')}
                      </label>
                      <input
                        value={l.uom}
                        onChange={(e) => updateLine(idx, { uom: e.target.value })}
                        className="input-base"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-xs font-medium text-neutral-600">
                        {tForm('rateLabel')}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={l.rate}
                        onChange={(e) => updateLine(idx, { rate: e.target.value })}
                        inputMode="decimal"
                        className="input-base"
                        required
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-xs font-medium text-neutral-600">
                        {tForm('discountLabel')}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={l.discount_pct}
                        onChange={(e) => updateLine(idx, { discount_pct: e.target.value })}
                        inputMode="decimal"
                        className="input-base"
                      />
                    </div>
                    {showGst ? (
                      <div className="sm:col-span-2">
                        <label className="text-xs font-medium text-neutral-600">
                          {tForm('gstLabel')}
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={l.gst_pct}
                          onChange={(e) => updateLine(idx, { gst_pct: e.target.value })}
                          inputMode="decimal"
                          className="input-base"
                        />
                      </div>
                    ) : null}
                    <div className={`sm:col-span-${showGst ? 1 : 3} flex items-end justify-end`}>
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        className="btn-ghost text-sm text-red-700"
                        aria-label={tForm('removeLineLabel')}
                        title={tForm('removeLineLabel')}
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-sm text-neutral-700">
                    <span>
                      {tForm('lineSubtotalLabel')}: {formatRupees(lineSubtotal, locale)}
                    </span>
                    <span className="font-medium text-neutral-900">
                      {tForm('lineTotalLabel')}: {formatRupees(lineTotal, locale)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Notes */}
        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <label htmlFor="notes" className="label-base">
            {tForm('notesLabel')}
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="input-base resize-y"
          />
        </section>

        {/* Totals */}
        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
            {tForm('totalsSection')}
          </h2>
          <dl className="ml-auto grid max-w-sm grid-cols-2 gap-y-1 text-sm">
            <dt className="text-neutral-600">{tForm('subtotalLabel')}</dt>
            <dd className="text-right text-neutral-900">{formatRupees(totals.subtotal, locale)}</dd>
            {totals.discount > 0 ? (
              <>
                <dt className="text-neutral-600">{tForm('discountTotalLabel')}</dt>
                <dd className="text-right text-neutral-900">
                  − {formatRupees(totals.discount, locale)}
                </dd>
              </>
            ) : null}
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
          <button type="submit" name="and_post" value="0" className="btn-primary !w-auto px-4">
            {tForm('saveDraftButton')}
          </button>
          <button
            type="submit"
            name="and_post"
            value="1"
            className="btn-primary !w-auto bg-brand-700 px-4"
          >
            {tForm('saveAndPostButton')}
          </button>
          <Link href="/purchases/bills" className="btn-ghost border border-neutral-300">
            {tForm('cancelButton')}
          </Link>
        </div>
      </form>
    </div>
  );
}
