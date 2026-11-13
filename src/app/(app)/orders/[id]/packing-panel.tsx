'use client';

import { useEffect, useMemo, useState } from 'react';
import { useFormState } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ServerError } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { saveOrderPackingAction } from '../actions';

export interface PackingLine {
  id: string;
  description: string;
  uom: string;
  qty_ordered: number;
  qty_billed: number;
  qty_packed: number;
}

interface RowState {
  checked: boolean;
  qty: string;
}

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Packing checklist. Each item still to bill gets a tick + a packed-qty box.
 * Ticking fills the full pending qty; lower it if less is in stock — the rest
 * stays pending on the order. "Mark Ready" hands it over for billing.
 */
export function PackingPanel({ orderId, lines }: { orderId: string; lines: PackingLine[] }) {
  const t = useTranslations('orders.packing');
  const router = useRouter();
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    saveOrderPackingAction,
    null,
  );

  const open = useMemo(() => lines.filter((l) => l.qty_ordered - l.qty_billed > 0), [lines]);
  const pendingOf = (l: PackingLine) => l.qty_ordered - l.qty_billed;

  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      open.map((l) => [
        l.id,
        {
          checked: l.qty_packed > 0,
          qty: String(l.qty_packed > 0 ? l.qty_packed : pendingOf(l)),
        },
      ]),
    ),
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  function setRow(id: string, patch: Partial<RowState>) {
    setRows((r) => ({ ...r, [id]: { ...(r[id] as RowState), ...patch } }));
  }

  function tickAll(checked: boolean) {
    setRows((r) =>
      Object.fromEntries(
        open.map((l) => [
          l.id,
          { checked, qty: checked ? String(pendingOf(l)) : (r[l.id]?.qty ?? '0') },
        ]),
      ),
    );
  }

  const packedCount = open.filter(
    (l) => rows[l.id]?.checked && num(rows[l.id]?.qty ?? '0') > 0,
  ).length;

  const payload = JSON.stringify(
    open.map((l) => {
      const r = rows[l.id];
      const q = r?.checked ? Math.min(Math.max(num(r.qty), 0), pendingOf(l)) : 0;
      return { line_id: l.id, qty_packed: q };
    }),
  );

  if (open.length === 0) return null;

  return (
    <form
      action={formAction}
      className="border-brand-200 mb-4 space-y-3 rounded-lg border bg-white p-4"
    >
      <input type="hidden" name="id" value={orderId} />
      <input type="hidden" name="lines" value={payload} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-neutral-900">{t('title')}</h2>
          <p className="text-xs text-neutral-500">{t('hint')}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => tickAll(true)}
            className="btn-ghost border border-neutral-300 text-sm"
          >
            {t('tickAll')}
          </button>
          <button
            type="button"
            onClick={() => tickAll(false)}
            className="btn-ghost border border-neutral-300 text-sm"
          >
            {t('clearAll')}
          </button>
        </div>
      </div>

      <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
        {open.map((l) => {
          const r = rows[l.id] ?? { checked: false, qty: '0' };
          const pending = pendingOf(l);
          const short = r.checked ? pending - Math.min(num(r.qty), pending) : 0;
          return (
            <li
              key={l.id}
              className={`flex flex-wrap items-center gap-3 px-3 py-2 ${r.checked ? 'bg-emerald-50/50' : ''}`}
            >
              <label className="flex min-w-0 flex-1 basis-48 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={r.checked}
                  onChange={(e) =>
                    setRow(l.id, {
                      checked: e.target.checked,
                      qty: e.target.checked && num(r.qty) <= 0 ? String(pending) : r.qty,
                    })
                  }
                  className="h-6 w-6 shrink-0 accent-emerald-700"
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-neutral-900">
                    {l.description}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {t('pendingLabel', { qty: pending, uom: l.uom })}
                    {short > 0 ? (
                      <span className="ml-2 font-medium text-amber-700">
                        {t('short', { qty: short })}
                      </span>
                    ) : null}
                  </span>
                </span>
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max={pending}
                  step="1"
                  value={r.qty}
                  disabled={!r.checked}
                  onChange={(e) => setRow(l.id, { qty: e.target.value })}
                  aria-label={t('packedQty')}
                  className="input-base !min-h-0 !w-24 !px-2 !py-1 text-center disabled:bg-neutral-100 disabled:text-neutral-400"
                />
                <span className="text-xs text-neutral-500">{l.uom}</span>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-neutral-600">
          {t('summary', { packed: packedCount, total: open.length })}
        </span>
        <div className="flex gap-2">
          <button
            type="submit"
            name="mark_ready"
            value="0"
            className="btn-ghost border border-neutral-300"
          >
            {t('save')}
          </button>
          <button
            type="submit"
            name="mark_ready"
            value="1"
            disabled={packedCount === 0}
            className="btn-primary !w-auto bg-emerald-700 px-5 disabled:opacity-50"
          >
            {t('markReady')}
          </button>
        </div>
      </div>

      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}
    </form>
  );
}
