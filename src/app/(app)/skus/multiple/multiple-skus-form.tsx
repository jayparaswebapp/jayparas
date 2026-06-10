'use client';

import { useMemo, useState } from 'react';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { createMultipleSkusAction, type CreateMultipleResult } from './actions';

interface RowValues {
  design_name: string;
  design_no: string;
  pack_size: string;
  price: string;
  discount_pct: string;
  print_qty: string;
}

const PACK_OPTIONS = ['1', '3', '4', '6', '12'];

function emptyRow(): RowValues {
  return {
    design_name: '',
    design_no: '',
    pack_size: '1',
    price: '0',
    discount_pct: '0',
    print_qty: '0',
  };
}

/**
 * Parses a TSV/CSV block copied from Excel/Sheets. We accept tabs OR commas
 * as the delimiter (Excel copies as tabs; some Sheets exports use commas) and
 * tolerate trailing whitespace + blank rows. Column order is fixed and
 * documented in the placeholder: Design Name | Design # | Pack | Price |
 * Discount % | Print Qty.
 */
function parsePastedRows(raw: string): RowValues[] {
  const out: RowValues[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cells = line.includes('\t') ? line.split('\t') : line.split(',');
    const cleaned = cells.map((c) => c.trim());
    // Need at least design_name + design_no + pack + price.
    if (cleaned.length < 4 || !cleaned[0]) continue;
    let packCell = cleaned[2] ?? '1';
    if (/doz/i.test(packCell)) packCell = '12';
    out.push({
      design_name: cleaned[0] ?? '',
      design_no: cleaned[1] ?? '',
      pack_size: PACK_OPTIONS.includes(packCell) ? packCell : '1',
      price: cleaned[3] ?? '0',
      discount_pct: cleaned[4] ?? '0',
      print_qty: cleaned[5] ?? '0',
    });
  }
  return out;
}

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function MultipleSkusForm() {
  const t = useTranslations('skus.multiple');
  const tCommon = useTranslations('common');
  const [rows, setRows] = useState<RowValues[]>([emptyRow()]);
  const [paste, setPaste] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [state, formAction] = useFormState<CreateMultipleResult | null, FormData>(
    createMultipleSkusAction,
    null,
  );

  const payload = useMemo(
    () =>
      JSON.stringify({
        rows: rows.map((r) => ({
          design_name: r.design_name.trim(),
          design_no: r.design_no.trim(),
          pack_size: num(r.pack_size),
          price: num(r.price),
          discount_pct: num(r.discount_pct),
          print_qty: num(r.print_qty),
        })),
      }),
    [rows],
  );

  function updateRow(idx: number, patch: Partial<RowValues>) {
    setRows((curr) => curr.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((curr) => [...curr, emptyRow()]);
  }
  function removeRow(idx: number) {
    setRows((curr) => (curr.length <= 1 ? curr : curr.filter((_, i) => i !== idx)));
  }
  function clearAll() {
    setRows([emptyRow()]);
  }

  function handleParse() {
    const parsed = parsePastedRows(paste);
    if (parsed.length === 0) return;
    // If the current sheet is just one empty starter row, replace it; else
    // append, so accidentally pasting twice doesn't wipe what was typed.
    const first = rows[0];
    const isStarter =
      rows.length === 1 && !!first && !first.design_name.trim() && !first.design_no.trim();
    setRows(isStarter ? parsed : [...rows, ...parsed]);
    setPaste('');
    setPasteOpen(false);
  }

  const totalLabels = rows.reduce((acc, r) => acc + Math.max(0, num(r.print_qty)), 0);
  const allRowsHaveRequired = rows.every(
    (r) => r.design_name.trim() && r.design_no.trim() && num(r.pack_size) > 0,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-neutral-600">{t('subtitle')}</p>
        </div>
        <Link href="/skus" className="btn-ghost border border-neutral-300 text-sm">
          {tCommon('actions.back')}
        </Link>
      </div>

      {/* Excel paste */}
      <section className="rounded-md border border-neutral-200 bg-white">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
          onClick={() => setPasteOpen((v) => !v)}
        >
          <span>{t('pasteTitle')}</span>
          <span className="text-xs text-neutral-500">{pasteOpen ? '−' : '+'}</span>
        </button>
        {pasteOpen ? (
          <div className="space-y-2 border-t border-neutral-200 px-4 py-3">
            <p className="text-xs text-neutral-600">{t('pasteHint')}</p>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={6}
              className="input-base h-auto min-h-0 w-full font-mono text-xs"
              placeholder={'Dori\t1325\t6\t120\t5\t10\nFestive\t2026\t1\t50\t0\t20'}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="btn-ghost border border-neutral-300 text-sm"
                onClick={() => {
                  setPaste('');
                  setPasteOpen(false);
                }}
              >
                {tCommon('actions.cancel')}
              </button>
              <button
                type="button"
                className="btn-primary !w-auto px-4 text-sm"
                onClick={handleParse}
                disabled={!paste.trim()}
              >
                {t('pasteButton')}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {/* Editable grid */}
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="payload" value={payload} />

        <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">{t('col.designName')}</th>
                <th className="px-2 py-2">{t('col.designNo')}</th>
                <th className="px-2 py-2">{t('col.pack')}</th>
                <th className="px-2 py-2">{t('col.price')}</th>
                <th className="px-2 py-2">{t('col.discount')}</th>
                <th className="px-2 py-2">{t('col.printQty')}</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} className="border-t border-neutral-100">
                  <td className="px-2 py-1 text-neutral-500">{idx + 1}</td>
                  <td className="px-1 py-1">
                    <input
                      className="input-base !min-h-0 !py-1 !text-sm"
                      value={r.design_name}
                      onChange={(e) => updateRow(idx, { design_name: e.target.value })}
                      placeholder={t('placeholders.designName')}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      className="input-base !min-h-0 !py-1 !text-sm"
                      value={r.design_no}
                      onChange={(e) => updateRow(idx, { design_no: e.target.value })}
                      placeholder={t('placeholders.designNo')}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <select
                      className="input-base !min-h-0 !py-1 !text-sm"
                      value={r.pack_size}
                      onChange={(e) => updateRow(idx, { pack_size: e.target.value })}
                    >
                      {PACK_OPTIONS.map((p) => (
                        <option key={p} value={p}>
                          {p === '12' ? '1 Doz' : p}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="input-base !min-h-0 !py-1 !text-sm"
                      value={r.price}
                      onChange={(e) => updateRow(idx, { price: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      className="input-base !min-h-0 !py-1 !text-sm"
                      value={r.discount_pct}
                      onChange={(e) => updateRow(idx, { discount_pct: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      className="input-base !min-h-0 !py-1 !text-sm"
                      value={r.print_qty}
                      onChange={(e) => updateRow(idx, { print_qty: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      disabled={rows.length <= 1}
                      className="text-sm text-neutral-500 hover:text-red-600 disabled:opacity-40"
                      aria-label={t('removeRow')}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={addRow}
            className="btn-ghost border border-neutral-300 text-sm"
          >
            {t('addRow')}
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="btn-ghost border border-neutral-300 text-sm"
          >
            {t('clearAll')}
          </button>
          <div className="ml-auto text-sm text-neutral-600">
            {t('summary', { rows: rows.length, labels: totalLabels })}
          </div>
        </div>

        {state && !state.ok ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {state.rowIndex !== undefined ? t('errorOnRow', { row: state.rowIndex + 1 }) : null}{' '}
            <span>{state.messageKey}</span>
            {state.duplicateSkuCode ? (
              <span className="ml-1">({state.duplicateSkuCode})</span>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center justify-end">
          <button
            type="submit"
            className="btn-primary !w-auto px-5"
            disabled={!allRowsHaveRequired}
          >
            {totalLabels > 0 ? t('submitWithPrint') : t('submitNoPrint')}
          </button>
        </div>
      </form>
    </div>
  );
}
