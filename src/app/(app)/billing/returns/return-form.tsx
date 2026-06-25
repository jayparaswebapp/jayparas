'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { ServerError } from '@/components/form-status';
import { formatRupees } from '@/lib/format/locale-shared';
import type { Locale } from '@/lib/i18n/config';
import type { ActionResult } from '@/lib/rpc/action-result';
import { saveSalesReturnDraftAction } from './actions';

export type BusinessLine = 'rakhi' | 'kite';

export interface InvoiceOption {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  business_line: BusinessLine;
  grand_total: number;
  balance_due: number;
  customer_label: string;
}

export interface InvoiceLineOption {
  id: string;
  invoice_id: string;
  line_no: number;
  sku_id: string | null;
  sku_snapshot: {
    sku_code?: string;
    design_name?: string;
    pack_size?: number;
    is_discountable?: boolean;
  } | null;
  description: string;
  hsn_code: string | null;
  qty: number;
  uom: string;
  rate: number;
  discount_pct: number;
  gst_pct: number;
  already_returned: number;
}

interface ReturnLineDraft {
  invoice_line_id: string;
  selected: boolean;
  qty: string;
}

export interface ReturnFormValues {
  id?: string;
  invoice_id: string | null;
  return_date: string;
  reason: string;
  notes: string;
  /** Existing draft lines (when editing) — maps to invoice_line_id + qty. */
  lines: Array<{ invoice_line_id: string | null; qty: string }>;
}

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function ReturnForm({
  initial,
  invoices,
  linesByInvoice,
  sellerState,
  locale,
}: {
  initial: ReturnFormValues;
  invoices: InvoiceOption[];
  linesByInvoice: Record<string, InvoiceLineOption[]>;
  sellerState: string | null;
  locale: Locale;
}) {
  const t = useTranslations('billing.returns');
  const tForm = useTranslations('billing.returns.form');
  const tInv = useTranslations('billing.invoices.form');
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    saveSalesReturnDraftAction,
    null,
  );

  const [invoiceId, setInvoiceId] = useState<string>(initial.invoice_id ?? '');
  const [returnDate, setReturnDate] = useState<string>(initial.return_date);
  const [reason, setReason] = useState<string>(initial.reason);
  const [notes, setNotes] = useState<string>(initial.notes);
  // Lines selected for this return. Keyed by invoice_line_id so changing the
  // picker for a new draft clears them, while editing a draft hydrates from
  // initial.lines.
  const [drafts, setDrafts] = useState<Record<string, ReturnLineDraft>>(() => {
    const out: Record<string, ReturnLineDraft> = {};
    for (const l of initial.lines) {
      if (l.invoice_line_id) {
        out[l.invoice_line_id] = {
          invoice_line_id: l.invoice_line_id,
          selected: true,
          qty: l.qty,
        };
      }
    }
    return out;
  });

  const selectedInvoice = useMemo(
    () => invoices.find((i) => i.id === invoiceId) ?? null,
    [invoices, invoiceId],
  );
  const invoiceLines = useMemo(
    () => (invoiceId ? (linesByInvoice[invoiceId] ?? []) : []),
    [invoiceId, linesByInvoice],
  );
  const showGst = selectedInvoice?.business_line === 'kite';
  const showHsn = showGst;

  // Intra/inter state — used to mirror invoice's CGST+SGST vs IGST split in
  // the live preview totals.
  const intraState = useMemo(() => {
    if (!sellerState || !selectedInvoice) return null;
    // The invoice already locked in its place_of_supply but we don't have it
    // here, and the credit-note will inherit it server-side. For the preview,
    // assume intra-state if seller's state is the only signal we have — the
    // server is the source of truth. This only affects on-screen totals
    // before save and won't drift after issue since we re-display from DB.
    return null;
  }, [sellerState, selectedInvoice]);

  function onInvoiceChange(id: string) {
    setInvoiceId(id);
    // Clear line drafts when switching invoices.
    setDrafts({});
  }

  function toggleLine(line: InvoiceLineOption) {
    setDrafts((curr) => {
      const next = { ...curr };
      const existing = next[line.id];
      const remaining = Math.max(0, round2(line.qty - line.already_returned));
      if (existing && existing.selected) {
        next[line.id] = { ...existing, selected: false };
      } else {
        next[line.id] = {
          invoice_line_id: line.id,
          selected: true,
          qty: remaining.toString(),
        };
      }
      return next;
    });
  }

  function setLineQty(lineId: string, value: string) {
    setDrafts((curr) => ({
      ...curr,
      [lineId]: {
        invoice_line_id: lineId,
        selected: curr[lineId]?.selected ?? true,
        qty: value,
      },
    }));
  }

  const activeLines = useMemo(() => {
    const out: Array<{ line: InvoiceLineOption; draft: ReturnLineDraft }> = [];
    for (const line of invoiceLines) {
      const draft = drafts[line.id];
      if (!draft || !draft.selected || num(draft.qty) <= 0) continue;
      out.push({ line, draft });
    }
    return out;
  }, [invoiceLines, drafts]);

  // Live preview totals: per-line subtotal/tax/total mirrors the invoice math
  // exactly. Server re-computes from the DB, this is just for the on-screen
  // grid.
  const totals = useMemo(() => {
    let subtotal = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    const intra = intraState ?? true; // optimistic for preview
    for (const { line, draft } of activeLines) {
      const qty = num(draft.qty);
      const lineSubtotal = round2(qty * line.rate * (1 - line.discount_pct / 100));
      subtotal += lineSubtotal;
      if (showGst && line.gst_pct > 0) {
        const tax = round2((lineSubtotal * line.gst_pct) / 100);
        if (intra) {
          const half = round2(tax / 2);
          cgst += half;
          sgst += tax - half;
        } else {
          igst += tax;
        }
      }
    }
    const sum = round2(subtotal + cgst + sgst + igst);
    const grand = Math.round(sum);
    const round = round2(grand - sum);
    return { subtotal, cgst, sgst, igst, round, grand };
  }, [activeLines, showGst, intraState]);

  const exceedsBalance =
    selectedInvoice !== null && totals.grand > selectedInvoice.balance_due + 0.005;

  const payload = useMemo(
    () =>
      JSON.stringify({
        header: {
          id: initial.id,
          invoice_id: invoiceId || undefined,
          return_date: returnDate,
          reason: reason || undefined,
          notes: notes || undefined,
        },
        lines: activeLines.map(({ line, draft }) => ({
          invoice_line_id: line.id,
          sku_id: line.sku_id ?? null,
          sku_snapshot: line.sku_snapshot,
          description: line.description,
          hsn_code: line.hsn_code ?? null,
          qty: num(draft.qty),
          uom: line.uom || 'Pcs',
          rate: line.rate,
          discount_pct: line.discount_pct,
          gst_pct: showGst ? line.gst_pct : 0,
        })),
      }),
    [initial.id, invoiceId, returnDate, reason, notes, activeLines, showGst],
  );

  const canSubmit = invoiceId.length > 0 && activeLines.length > 0 && !exceedsBalance;

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="payload" value={payload} />

      {/* Header */}
      <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          {tForm('headerSection')}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="invoice_id" className="label-base">
              {tForm('originalInvoiceLabel')}
            </label>
            <select
              id="invoice_id"
              value={invoiceId}
              onChange={(e) => onInvoiceChange(e.target.value)}
              className="input-base"
              required
              disabled={Boolean(initial.id)}
            >
              <option value="">{tForm('originalInvoicePickerPlaceholder')}</option>
              {invoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoice_number ?? '—'} · {inv.customer_label} ·{' '}
                  {formatRupees(inv.grand_total, locale)}
                </option>
              ))}
            </select>
            {selectedInvoice ? (
              <p className="mt-1 text-xs text-neutral-600">
                {tForm('invoiceBalanceLabel')}:{' '}
                <span className="font-semibold">
                  {formatRupees(selectedInvoice.balance_due, locale)}
                </span>
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="return_date" className="label-base">
              {tForm('returnDateLabel')}
            </label>
            <input
              id="return_date"
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
              required
              className="input-base"
            />
          </div>

          <div>
            <label htmlFor="reason" className="label-base">
              {tForm('reasonLabel')}
            </label>
            <input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={tForm('reasonPlaceholder')}
              className="input-base"
            />
          </div>
        </div>
      </section>

      {/* Lines */}
      <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          {tForm('linesSection')}
        </h2>

        {!invoiceId ? (
          <p className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3 text-sm text-neutral-500">
            {tForm('pickInvoiceFirst')}
          </p>
        ) : invoiceLines.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3 text-sm text-neutral-500">
            {tForm('noLines')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="w-8 px-2 py-2"></th>
                  <th className="px-2 py-2 text-left">{tInv('itemColumn')}</th>
                  {showHsn ? (
                    <th className="w-20 px-1 py-2 text-left font-mono">{tInv('hsnLabel')}</th>
                  ) : null}
                  <th className="w-16 px-1 py-2 text-right">{tForm('billedQtyColumn')}</th>
                  <th className="w-20 px-1 py-2 text-right">{tForm('returnedQtyColumn')}</th>
                  <th className="w-20 px-1 py-2 text-right">{tForm('returnQtyColumn')}</th>
                  <th className="w-14 px-1 py-2">{tInv('uomLabel')}</th>
                  <th className="w-20 px-1 py-2 text-right">{tInv('rateColumn')}</th>
                  <th className="w-14 px-1 py-2 text-right">{tInv('discountColumn')}</th>
                  {showGst ? (
                    <th className="w-14 px-1 py-2 text-right">{tInv('gstLabel')}</th>
                  ) : null}
                  <th className="w-24 px-1 py-2 text-right">{tInv('totalColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {invoiceLines.map((line) => {
                  const draft = drafts[line.id];
                  const selected = draft?.selected ?? false;
                  const remaining = Math.max(0, round2(line.qty - line.already_returned));
                  const exhausted = remaining <= 0;
                  const qty = selected ? num(draft?.qty ?? '0') : 0;
                  const lineSubtotal = round2(qty * line.rate * (1 - line.discount_pct / 100));
                  const lineTax = showGst ? round2((lineSubtotal * line.gst_pct) / 100) : 0;
                  const lineTotal = round2(lineSubtotal + lineTax);
                  return (
                    <tr
                      key={line.id}
                      className={`border-t border-neutral-100 align-middle ${
                        exhausted ? 'bg-neutral-50 text-neutral-400' : ''
                      }`}
                    >
                      <td className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={exhausted}
                          onChange={() => toggleLine(line)}
                          className="h-4 w-4"
                        />
                      </td>
                      <td className="px-2 py-1">{line.description}</td>
                      {showHsn ? (
                        <td className="px-1 py-1 font-mono text-xs">{line.hsn_code ?? '—'}</td>
                      ) : null}
                      <td className="px-1 py-1 text-right tabular-nums">
                        {Number(line.qty).toFixed(2)}
                      </td>
                      <td className="px-1 py-1 text-right tabular-nums text-neutral-600">
                        {Number(line.already_returned).toFixed(2)}
                      </td>
                      <td className="px-1 py-1 text-right">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max={remaining}
                          disabled={!selected || exhausted}
                          value={draft?.qty ?? '0'}
                          onChange={(e) => setLineQty(line.id, e.target.value)}
                          inputMode="decimal"
                          className="input-base !min-h-0 !py-1 !text-right !text-sm disabled:bg-neutral-100"
                        />
                      </td>
                      <td className="px-1 py-1 text-center">{line.uom}</td>
                      <td className="px-1 py-1 text-right tabular-nums">{line.rate.toFixed(2)}</td>
                      <td className="px-1 py-1 text-right tabular-nums">
                        {line.discount_pct > 0 ? `${line.discount_pct}%` : '—'}
                      </td>
                      {showGst ? (
                        <td className="px-1 py-1 text-right tabular-nums">
                          {line.gst_pct > 0 ? `${line.gst_pct}%` : '—'}
                        </td>
                      ) : null}
                      <td className="px-2 py-1 text-right text-sm font-semibold tabular-nums">
                        {lineTotal.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Live totals */}
        {activeLines.length > 0 ? (
          <div className="ml-auto max-w-sm rounded-md bg-neutral-50 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-neutral-600">{tInv('subtotalLabel')}</span>
              <span>{formatRupees(totals.subtotal, locale)}</span>
            </div>
            {showGst && totals.cgst > 0 ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-600">{tInv('cgstLabel')}</span>
                  <span>{formatRupees(totals.cgst, locale)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-600">{tInv('sgstLabel')}</span>
                  <span>{formatRupees(totals.sgst, locale)}</span>
                </div>
              </>
            ) : null}
            {showGst && totals.igst > 0 ? (
              <div className="flex items-center justify-between">
                <span className="text-neutral-600">{tInv('igstLabel')}</span>
                <span>{formatRupees(totals.igst, locale)}</span>
              </div>
            ) : null}
            {totals.round !== 0 ? (
              <div className="flex items-center justify-between">
                <span className="text-neutral-600">{tInv('roundOffLabel')}</span>
                <span>
                  {totals.round > 0 ? '+ ' : '− '}
                  {formatRupees(Math.abs(totals.round), locale)}
                </span>
              </div>
            ) : null}
            <div className="mt-1 flex items-center justify-between border-t border-neutral-200 pt-1 text-base font-semibold">
              <span>{tInv('grandTotalLabel')}</span>
              <span>{formatRupees(totals.grand, locale)}</span>
            </div>
            {exceedsBalance && selectedInvoice ? (
              <div className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                {tForm('exceedsBalanceWarning', {
                  balance: formatRupees(selectedInvoice.balance_due, locale),
                })}
              </div>
            ) : null}
          </div>
        ) : null}
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

      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          name="and_issue"
          value="0"
          disabled={!canSubmit}
          className="btn-primary !w-auto px-4 disabled:opacity-50"
        >
          {tForm('saveDraftButton')}
        </button>
        <button
          type="submit"
          name="and_issue"
          value="1"
          disabled={!canSubmit}
          className="btn-primary !w-auto bg-brand-700 px-4 disabled:opacity-50"
        >
          {tForm('saveAndIssueButton')}
        </button>
        <Link href="/billing/returns" className="btn-ghost border border-neutral-300">
          {t('cancelButton')}
        </Link>
      </div>
    </form>
  );
}
