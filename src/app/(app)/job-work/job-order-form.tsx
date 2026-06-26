'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { ServerError } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { createJobOrderAction } from './actions';

export interface LeadLadyOption {
  id: string;
  label: string;
}
export interface LocationOption {
  id: string;
  label: string;
}
export interface DesignOption {
  id: string;
  label: string;
  /** designs.current_rate_per_guss / 144 = default per-piece rate. We store
   *  it pre-computed here so the form doesn't need to know about gusses. */
  default_rate_per_piece: number;
}

interface ItemRow {
  design_id: string;
  qty_issued: string;
  rate_per_piece: string;
  notes: string;
}

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const EMPTY: ItemRow = { design_id: '', qty_issued: '', rate_per_piece: '0', notes: '' };

export function JobOrderForm({
  leadLadies,
  locations,
  designs,
}: {
  leadLadies: LeadLadyOption[];
  locations: LocationOption[];
  designs: DesignOption[];
}) {
  const t = useTranslations('jobWork.form');
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    createJobOrderAction,
    null,
  );

  const [leadLadyId, setLeadLadyId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedReturnDate, setExpectedReturnDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ItemRow[]>([{ ...EMPTY }]);

  const designById = useMemo(() => {
    const m = new Map<string, DesignOption>();
    for (const d of designs) m.set(d.id, d);
    return m;
  }, [designs]);

  function pickDesign(idx: number, designId: string) {
    const d = designById.get(designId);
    setItems((rows) =>
      rows.map((r, i) =>
        i === idx
          ? {
              ...r,
              design_id: designId,
              rate_per_piece: d ? String(d.default_rate_per_piece) : r.rate_per_piece,
            }
          : r,
      ),
    );
  }
  function updateItem(idx: number, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setItems((rows) => [...rows, { ...EMPTY }]);
  }
  function removeRow(idx: number) {
    setItems((rows) => (rows.length <= 1 ? rows : rows.filter((_, i) => i !== idx)));
  }

  const totals = useMemo(() => {
    let qty = 0;
    let value = 0;
    for (const r of items) {
      const q = num(r.qty_issued);
      qty += q;
      value += q * num(r.rate_per_piece);
    }
    return { qty, value };
  }, [items]);

  const payload = useMemo(
    () =>
      JSON.stringify({
        header: {
          lead_lady_id: leadLadyId || undefined,
          location_id: locationId || null,
          issue_date: issueDate,
          expected_return_date: expectedReturnDate || undefined,
          notes: notes || undefined,
        },
        items: items
          .filter((r) => r.design_id && num(r.qty_issued) > 0)
          .map((r) => ({
            design_id: r.design_id,
            qty_issued: num(r.qty_issued),
            rate_per_piece: num(r.rate_per_piece),
            notes: r.notes || undefined,
          })),
      }),
    [leadLadyId, locationId, issueDate, expectedReturnDate, notes, items],
  );

  const canSubmit =
    leadLadyId.length > 0 && items.some((r) => r.design_id && num(r.qty_issued) > 0);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="payload" value={payload} />

      <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          {t('headerSection')}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="ll" className="label-base">
              {t('leadLadyLabel')}
            </label>
            <select
              id="ll"
              value={leadLadyId}
              onChange={(e) => setLeadLadyId(e.target.value)}
              className="input-base"
              required
            >
              <option value="">{t('leadLadyPickerPlaceholder')}</option>
              {leadLadies.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="loc" className="label-base">
              {t('locationLabel')}
            </label>
            <select
              id="loc"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="input-base"
            >
              <option value="">{t('locationOptional')}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="issue_date" className="label-base">
              {t('issueDateLabel')}
            </label>
            <input
              id="issue_date"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              required
              className="input-base"
            />
          </div>

          <div>
            <label htmlFor="exp" className="label-base">
              {t('expectedReturnLabel')}
            </label>
            <input
              id="exp"
              type="date"
              value={expectedReturnDate}
              onChange={(e) => setExpectedReturnDate(e.target.value)}
              className="input-base"
            />
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
            {t('itemsSection')}
          </h2>
          <button
            type="button"
            onClick={addRow}
            className="btn-ghost border border-neutral-300 text-sm"
          >
            {t('addRowButton')}
          </button>
        </div>

        <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="w-8 px-2 py-2">#</th>
                <th className="px-2 py-2 text-left">{t('designColumn')}</th>
                <th className="w-24 px-1 py-2 text-right">{t('qtyColumn')}</th>
                <th className="w-24 px-1 py-2 text-right">{t('rateColumn')}</th>
                <th className="w-24 px-1 py-2 text-right">{t('valueColumn')}</th>
                <th className="px-2 py-2 text-left">{t('notesColumn')}</th>
                <th className="w-6 px-1 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((r, idx) => {
                const value = num(r.qty_issued) * num(r.rate_per_piece);
                return (
                  <tr key={idx} className="border-t border-neutral-100 align-middle">
                    <td className="px-2 py-1 text-center text-xs text-neutral-400">{idx + 1}</td>
                    <td className="px-1 py-1">
                      <select
                        value={r.design_id}
                        onChange={(e) => pickDesign(idx, e.target.value)}
                        className="input-base !min-h-0 !py-1 !text-sm"
                        required
                      >
                        <option value="">{t('designPickerPlaceholder')}</option>
                        {designs.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={r.qty_issued}
                        onChange={(e) => updateItem(idx, { qty_issued: e.target.value })}
                        inputMode="numeric"
                        className="input-base !min-h-0 !py-1 !text-right !text-sm"
                        required
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={r.rate_per_piece}
                        onChange={(e) => updateItem(idx, { rate_per_piece: e.target.value })}
                        inputMode="decimal"
                        className="input-base !min-h-0 !py-1 !text-right !text-sm"
                        required
                      />
                    </td>
                    <td className="px-2 py-1 text-right text-sm font-semibold tabular-nums">
                      {value.toFixed(2)}
                    </td>
                    <td className="px-1 py-1">
                      <input
                        value={r.notes}
                        onChange={(e) => updateItem(idx, { notes: e.target.value })}
                        className="input-base !min-h-0 !py-1 !text-sm"
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        className="text-neutral-400 hover:text-red-600"
                        aria-label="remove"
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

        <div className="ml-auto max-w-sm rounded-md bg-neutral-50 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-neutral-600">{t('totalQtyLabel')}</span>
            <span className="font-semibold tabular-nums">{totals.qty}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-neutral-600">{t('totalValueLabel')}</span>
            <span className="font-semibold tabular-nums">₹ {totals.value.toFixed(2)}</span>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <label htmlFor="notes" className="label-base">
          {t('notesLabel')}
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
          disabled={!canSubmit}
          className="btn-primary !w-auto bg-brand-700 px-4 disabled:opacity-50"
        >
          {t('saveButton')}
        </button>
        <Link href="/job-work" className="btn-ghost border border-neutral-300">
          {t('cancelButton')}
        </Link>
      </div>
    </form>
  );
}
