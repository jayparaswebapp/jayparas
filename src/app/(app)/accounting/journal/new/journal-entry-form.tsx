'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { ServerError } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { createJournalEntryAction } from '../../actions';

export interface AccountOption {
  id: string;
  code: string;
  label: string;
  type: string;
}

interface LineRow {
  account_id: string;
  debit: string;
  credit: string;
  note: string;
}

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const EMPTY: LineRow = { account_id: '', debit: '', credit: '', note: '' };

export function JournalEntryForm({ accounts }: { accounts: AccountOption[] }) {
  const t = useTranslations('accounting.journal.form');
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    createJournalEntryAction,
    null,
  );

  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState('');
  // Start with two lines because the minimum valid entry has two — one Dr,
  // one Cr. Prevents the "why is submit greyed out" question.
  const [lines, setLines] = useState<LineRow[]>([{ ...EMPTY }, { ...EMPTY }]);

  const totals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const l of lines) {
      dr += num(l.debit);
      cr += num(l.credit);
    }
    return { dr, cr, diff: dr - cr };
  }, [lines]);

  const balanced = Math.abs(totals.diff) < 0.005 && totals.dr > 0;

  function updateLine(idx: number, patch: Partial<LineRow>) {
    setLines((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setLines((rows) => [...rows, { ...EMPTY }]);
  }
  function removeRow(idx: number) {
    setLines((rows) => (rows.length <= 2 ? rows : rows.filter((_, i) => i !== idx)));
  }

  const payload = useMemo(
    () =>
      JSON.stringify({
        header: {
          entry_date: entryDate,
          narration: narration || undefined,
        },
        lines: lines
          .filter((l) => l.account_id && (num(l.debit) > 0 || num(l.credit) > 0))
          .map((l) => ({
            account_id: l.account_id,
            debit: num(l.debit),
            credit: num(l.credit),
            note: l.note || undefined,
          })),
      }),
    [entryDate, narration, lines],
  );

  const canSubmit =
    balanced &&
    lines.filter((l) => l.account_id && (num(l.debit) > 0 || num(l.credit) > 0)).length >= 2;

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="payload" value={payload} />

      <section className="grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-2">
        <div>
          <label htmlFor="entry_date" className="label-base">
            {t('dateLabel')}
          </label>
          <input
            id="entry_date"
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            required
            className="input-base"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="narration" className="label-base">
            {t('narrationLabel')}
          </label>
          <input
            id="narration"
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder={t('narrationPlaceholder')}
            className="input-base"
          />
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
            {t('linesSection')}
          </h2>
          <button
            type="button"
            onClick={addRow}
            className="btn-ghost border border-neutral-300 text-sm"
          >
            {t('addLineButton')}
          </button>
        </div>

        <div className="overflow-x-auto rounded-md border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-2 py-2 text-left">{t('accountColumn')}</th>
                <th className="w-28 px-1 py-2 text-right">{t('debitColumn')}</th>
                <th className="w-28 px-1 py-2 text-right">{t('creditColumn')}</th>
                <th className="px-2 py-2 text-left">{t('noteColumn')}</th>
                <th className="w-6 px-1 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={idx} className="border-t border-neutral-100 align-middle">
                  <td className="px-1 py-1">
                    <select
                      value={l.account_id}
                      onChange={(e) => updateLine(idx, { account_id: e.target.value })}
                      className="input-base !min-h-0 !py-1 !text-sm"
                    >
                      <option value="">{t('accountPickerPlaceholder')}</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {a.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={l.debit}
                      onChange={(e) =>
                        updateLine(idx, {
                          debit: e.target.value,
                          credit: e.target.value ? '' : l.credit,
                        })
                      }
                      inputMode="decimal"
                      className="input-base !min-h-0 !py-1 !text-right !text-sm"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={l.credit}
                      onChange={(e) =>
                        updateLine(idx, {
                          credit: e.target.value,
                          debit: e.target.value ? '' : l.debit,
                        })
                      }
                      inputMode="decimal"
                      className="input-base !min-h-0 !py-1 !text-right !text-sm"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      value={l.note}
                      onChange={(e) => updateLine(idx, { note: e.target.value })}
                      className="input-base !min-h-0 !py-1 !text-sm"
                    />
                  </td>
                  <td className="px-1 py-1 text-center">
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      disabled={lines.length <= 2}
                      className="text-neutral-400 hover:text-red-600 disabled:opacity-40"
                      aria-label="remove"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-neutral-50 text-sm">
              <tr>
                <td className="px-2 py-2 text-right text-xs uppercase tracking-wide text-neutral-500">
                  {t('totalsLabel')}
                </td>
                <td className="px-1 py-2 text-right font-semibold tabular-nums">
                  {totals.dr.toFixed(2)}
                </td>
                <td className="px-1 py-2 text-right font-semibold tabular-nums">
                  {totals.cr.toFixed(2)}
                </td>
                <td className="px-2 py-2 text-xs">
                  {balanced ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">
                      {t('balancedLabel')}
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">
                      {t('unbalancedLabel', { diff: totals.diff.toFixed(2) })}
                    </span>
                  )}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="btn-primary !w-auto bg-brand-700 px-5 disabled:opacity-50"
        >
          {t('saveButton')}
        </button>
        <Link href="/accounting/journal" className="btn-ghost border border-neutral-300">
          {t('cancelButton')}
        </Link>
      </div>
    </form>
  );
}
