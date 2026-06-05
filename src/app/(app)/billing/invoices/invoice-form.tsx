'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { ServerError } from '@/components/form-status';
import { formatRupees } from '@/lib/format/locale-shared';
import type { Locale } from '@/lib/i18n/config';
import type { ActionResult } from '@/lib/rpc/action-result';
import { saveInvoiceDraftAction } from './actions';

export type BusinessLine = 'rakhi' | 'kite';

export interface InvoiceLineValues {
  sku_id: string | null;
  sku_snapshot: { sku_code: string; design_name: string; pack_size: number } | null;
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
  due_date: string;
  place_of_supply: string;
  notes: string;
  terms: string;
  lines: InvoiceLineValues[];
}

export interface CustomerOption {
  id: string;
  label: string;
  state: string | null;
}

export interface SkuOption {
  id: string;
  sku_code: string;
  design_name: string;
  pack_size: number;
  price: number;
}

const EMPTY_LINE: InvoiceLineValues = {
  sku_id: null,
  sku_snapshot: null,
  description: '',
  hsn_code: '',
  qty: '1',
  uom: 'Pack',
  rate: '0',
  discount_pct: '0',
  gst_pct: '0',
};

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
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
  const [dueDate, setDueDate] = useState<string>(initial.due_date ?? '');
  const [notes, setNotes] = useState<string>(initial.notes ?? '');
  const [terms, setTerms] = useState<string>(initial.terms ?? '');
  const [lines, setLines] = useState<InvoiceLineValues[]>(
    initial.lines.length ? initial.lines : [{ ...EMPTY_LINE }],
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

  function pickSkuForLine(idx: number, skuId: string) {
    if (!skuId) {
      updateLine(idx, { sku_id: null, sku_snapshot: null });
      return;
    }
    const s = skus.find((x) => x.id === skuId);
    if (!s) return;
    updateLine(idx, {
      sku_id: s.id,
      sku_snapshot: { sku_code: s.sku_code, design_name: s.design_name, pack_size: s.pack_size },
      description: `${s.design_name} — ${s.sku_code} (${s.pack_size} pcs)`,
      rate: String(s.price),
    });
  }

  function addLine() {
    setLines((curr) => [...curr, { ...EMPTY_LINE }]);
  }
  function removeLine(idx: number) {
    setLines((curr) => (curr.length <= 1 ? curr : curr.filter((_, i) => i !== idx)));
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
      const lineSubtotal = +(qty * rate * (1 - disc / 100)).toFixed(2);
      const lineDiscount = +(qty * rate * (disc / 100)).toFixed(2);
      subtotal += lineSubtotal;
      discount += lineDiscount;
      if (showGst) {
        const gstPct = num(l.gst_pct);
        if (gstPct > 0) {
          const tax = +(lineSubtotal * (gstPct / 100)).toFixed(2);
          if (intraState) {
            const half = +(tax / 2).toFixed(2);
            cgst += half;
            sgst += tax - half;
          } else {
            igst += tax;
          }
        }
      }
    }
    const sum = +(subtotal + cgst + sgst + igst).toFixed(2);
    const grand = Math.round(sum);
    const round = +(grand - sum).toFixed(2);
    return { subtotal, discount, cgst, sgst, igst, round, grand };
  }, [lines, showGst, intraState]);

  const payload = useMemo(
    () =>
      JSON.stringify({
        header: {
          id: initial.id,
          business_line: businessLine,
          customer_id: customerId || null,
          invoice_date: invoiceDate,
          due_date: dueDate || undefined,
          place_of_supply: placeOfSupply || undefined,
          notes: notes || undefined,
          terms: terms || undefined,
        },
        lines: lines.map((l) => ({
          sku_id: l.sku_id || null,
          sku_snapshot: l.sku_snapshot,
          description: l.description || (l.sku_snapshot?.design_name ?? '—'),
          hsn_code: l.hsn_code || null,
          qty: num(l.qty),
          uom: l.uom || 'Pack',
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
      dueDate,
      placeOfSupply,
      notes,
      terms,
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

          <div>
            <label htmlFor="due_date" className="label-base">
              {tForm('dueDateLabel')}
            </label>
            <input
              id="due_date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="input-base"
            />
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

      {/* Lines */}
      <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex items-center justify-between">
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
            const lineSubtotal = +(
              num(l.qty) *
              num(l.rate) *
              (1 - num(l.discount_pct) / 100)
            ).toFixed(2);
            const lineTax = showGst ? +((lineSubtotal * num(l.gst_pct)) / 100).toFixed(2) : 0;
            const lineTotal = +(lineSubtotal + lineTax).toFixed(2);
            return (
              <div key={idx} className="space-y-2 rounded-md border border-neutral-200 p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                  <div className="sm:col-span-5">
                    <label className="text-xs font-medium text-neutral-600">
                      {tForm('skuLabel')}
                    </label>
                    <select
                      value={l.sku_id ?? ''}
                      onChange={(e) => pickSkuForLine(idx, e.target.value)}
                      className="input-base"
                    >
                      <option value="">{tForm('skuNone')}</option>
                      {skus.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.sku_code} — {s.design_name}
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

                <div className="flex items-center justify-end gap-4 text-sm text-neutral-700">
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
