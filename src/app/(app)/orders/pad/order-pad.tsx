'use client';

import { useEffect, useMemo, useState } from 'react';
import { useFormState } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ServerError, SubmitButton } from '@/components/form-status';
import { formatRupees } from '@/lib/format/locale-shared';
import type { Locale } from '@/lib/i18n/config';
import type { ActionResult } from '@/lib/rpc/action-result';
import { kiteDiscountFor, type KitePricing } from '@/lib/billing/kite-pricing';
import type { CustomerOption, SkuOption } from '@/app/(app)/billing/invoices/invoice-form';
import { buildPadLayout } from '@/lib/orders/order-pad';
import { saveOrderAction } from '../actions';

type Mode = 'pcs' | 'box';

function num(s: string | undefined): number {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Kite order pad: the paper order sheet as a grid. Type the qty the customer
 * asks for in each box. In "Boxes" mode, also type how many pieces are in a
 * box for each size (it changes per customer); the order is saved in pieces.
 */
export function OrderPad({
  customers,
  skus,
  kitePricing,
  locale,
}: {
  customers: CustomerOption[];
  skus: SkuOption[];
  kitePricing: KitePricing;
  locale: Locale;
}) {
  const t = useTranslations('orders.pad');
  const router = useRouter();
  const [state, formAction] = useFormState<ActionResult | null, FormData>(saveOrderAction, null);

  const [customerId, setCustomerId] = useState('');
  const [mode, setMode] = useState<Mode>('pcs');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [perBox, setPerBox] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (state?.ok) router.push(state.redirectTo ?? '/orders');
  }, [state, router]);

  const groupOf = (s: SkuOption) =>
    s.product_group_id ? kitePricing.groups[s.product_group_id] : undefined;

  const layout = useMemo(
    () => buildPadLayout(skus, (s) => groupOf(s)?.name ?? ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skus, kitePricing],
  );
  const skuById = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);

  /** Which "pieces per box" box applies to a product. */
  const boxKey = (id: string) => layout.sizeOf[id] ?? `sku:${id}`;

  function piecesOf(id: string): number {
    const q = num(qty[id]);
    if (mode === 'pcs') return q;
    return q * num(perBox[boxKey(id)]);
  }

  function priceOf(s: SkuOption) {
    const g = groupOf(s);
    return {
      rate: s.price,
      discount_pct: g ? kiteDiscountFor(kitePricing, customerId, g.company_id) : 0,
      hsn_code: g?.hsn_code ?? '',
      gst_pct: g?.gst_pct ?? 0,
    };
  }

  const entered = Object.keys(qty).filter((id) => num(qty[id]) > 0 && skuById.has(id));
  const missingBoxSize =
    mode === 'box'
      ? Array.from(
          new Set(entered.filter((id) => !num(perBox[boxKey(id)])).map((id) => boxKey(id))),
        )
      : [];

  const lines = entered
    .map((id) => {
      const s = skuById.get(id)!;
      const pieces = piecesOf(id);
      const p = priceOf(s);
      const amount = round2(
        round2(pieces * p.rate * (1 - p.discount_pct / 100)) * (1 + p.gst_pct / 100),
      );
      return { s, pieces, p, amount };
    })
    .filter((l) => l.pieces > 0);

  const total = round2(lines.reduce((a, l) => a + l.amount, 0));
  const totalPieces = lines.reduce((a, l) => a + l.pieces, 0);

  // Box sizes used go into the order notes so packing sees them.
  const boxNote =
    mode === 'box'
      ? Array.from(new Set(lines.map((l) => boxKey(l.s.id))))
          .map((k) => {
            const label = k.startsWith('sku:') ? (skuById.get(k.slice(4))?.design_name ?? '') : k;
            return `${label} = ${num(perBox[k])} pcs`;
          })
          .join(', ')
      : '';
  const fullNotes = [notes.trim(), boxNote ? `${t('boxNotePrefix')} ${boxNote}` : '']
    .filter(Boolean)
    .join('\n')
    .slice(0, 500);

  const payload = JSON.stringify({
    business_line: 'kite',
    customer_id: customerId,
    notes: fullNotes,
    lines: lines.map(({ s, pieces, p }) => ({
      sku_id: s.id,
      sku_snapshot: {
        sku_code: s.sku_code,
        design_name: s.design_name,
        pack_size: s.pack_size,
        is_discountable: s.is_discountable,
      },
      description: s.design_name,
      hsn_code: p.hsn_code,
      uom: 'Pcs',
      rate: p.rate,
      discount_pct: p.discount_pct,
      gst_pct: p.gst_pct,
      qty: pieces,
    })),
  });

  const f = filter.trim().toLowerCase();
  const rows = f ? layout.rows.filter((r) => r.brand.toLowerCase().includes(f)) : layout.rows;
  const others = layout.others
    .map((o) => ({
      ...o,
      skus: f
        ? o.skus.filter(
            (s) => s.design_name.toLowerCase().includes(f) || o.group.toLowerCase().includes(f),
          )
        : o.skus,
    }))
    .filter((o) => o.skus.length > 0);

  const setQ = (id: string, v: string) => setQty((c) => ({ ...c, [id]: v }));
  const qtyInput = (s: SkuOption, label?: string) => (
    <input
      key={s.id}
      type="number"
      inputMode="numeric"
      min="0"
      step="1"
      value={qty[s.id] ?? ''}
      onChange={(e) => setQ(s.id, e.target.value)}
      title={`${s.design_name} — ${formatRupees(s.price, locale)}`}
      aria-label={label ?? s.design_name}
      placeholder={label}
      className={`w-14 rounded border px-1 py-1 text-center text-sm tabular-nums focus:border-brand-700 focus:outline-none ${num(qty[s.id]) > 0 ? 'border-emerald-500 bg-emerald-50 font-semibold' : 'border-neutral-300 bg-white'}`}
    />
  );

  return (
    <form action={formAction} className="space-y-4 pb-24">
      <input type="hidden" name="payload" value={payload} />

      <section className="grid gap-3 rounded-lg border border-neutral-200 bg-white p-4 md:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor="pad_customer" className="label-base">
            {t('party')}
          </label>
          <select
            id="pad_customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="input-base"
            required
          >
            <option value="">{t('partyPlaceholder')}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          {!customerId ? <p className="mt-1 text-xs text-amber-700">{t('partyFirst')}</p> : null}
        </div>
        <div>
          <div className="label-base">{t('countIn')}</div>
          <div className="flex gap-2">
            {(['pcs', 'box'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`btn-ghost border px-4 ${mode === m ? 'border-brand-700 bg-brand-50 text-brand-900' : 'border-neutral-300'}`}
              >
                {m === 'pcs' ? t('pieces') : t('boxes')}
              </button>
            ))}
          </div>
          {mode === 'box' ? (
            <p className="mt-1 max-w-xs text-xs text-neutral-600">{t('boxHint')}</p>
          ) : null}
        </div>
      </section>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t('filterPlaceholder')}
        className="input-base"
      />

      <section className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="border-collapse text-sm">
          <thead>
            <tr className="bg-neutral-100 text-neutral-700">
              <th
                rowSpan={mode === 'box' ? 3 : 2}
                className="sticky left-0 z-10 border-b border-r border-neutral-200 bg-neutral-100 px-3 py-2 text-left"
              >
                {t('product')}
              </th>
              {layout.sizeGroups.map((g) => (
                <th
                  key={g.size}
                  colSpan={g.columns.length}
                  className="whitespace-nowrap border-b border-l border-neutral-300 px-2 py-1 text-center font-semibold"
                >
                  {g.size}
                </th>
              ))}
            </tr>
            <tr className="bg-neutral-50 text-xs text-neutral-600">
              {layout.sizeGroups.map((g) =>
                g.columns.map((c, i) => (
                  <th
                    key={c.key}
                    className={`border-b border-neutral-200 px-1 py-1 text-center ${i === 0 ? 'border-l border-l-neutral-300' : ''}`}
                  >
                    {t('cord', { n: c.cord })}
                  </th>
                )),
              )}
            </tr>
            {mode === 'box' ? (
              <tr className="bg-amber-50 text-xs">
                {layout.sizeGroups.map((g) => (
                  <th
                    key={g.size}
                    colSpan={g.columns.length}
                    className="border-b border-l border-neutral-300 px-1 py-1"
                  >
                    <label className="flex items-center justify-center gap-1 font-normal text-amber-900">
                      <input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        value={perBox[g.size] ?? ''}
                        onChange={(e) => setPerBox((c) => ({ ...c, [g.size]: e.target.value }))}
                        className={`w-14 rounded border px-1 py-0.5 text-center ${missingBoxSize.includes(g.size) ? 'border-red-500 bg-red-50' : 'border-amber-300 bg-white'}`}
                        aria-label={t('perBoxFor', { size: g.size })}
                      />
                      {t('perBox')}
                    </label>
                  </th>
                ))}
              </tr>
            ) : null}
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-neutral-100 hover:bg-brand-50/30">
                <th className="sticky left-0 z-10 whitespace-nowrap border-r border-neutral-200 bg-white px-3 py-1 text-left font-medium text-neutral-900">
                  {r.brand}
                </th>
                {layout.sizeGroups.map((g) =>
                  g.columns.map((c, i) => {
                    const items = r.cells[c.key];
                    return (
                      <td
                        key={c.key}
                        className={`px-1 py-1 text-center align-top ${i === 0 ? 'border-l border-neutral-300' : ''} ${items ? '' : 'bg-neutral-100'}`}
                      >
                        {items ? (
                          <div className="flex flex-col items-center gap-0.5">
                            {items.length === 1
                              ? qtyInput(items[0]!.sku)
                              : items.map((it) => (
                                  <div key={it.sku.id} className="flex flex-col items-center">
                                    <span
                                      className="max-w-[4.5rem] truncate text-[10px] leading-tight text-neutral-500"
                                      title={it.sku.design_name}
                                    >
                                      {it.variant}
                                    </span>
                                    {qtyInput(it.sku, it.variant)}
                                  </div>
                                ))}
                          </div>
                        ) : null}
                      </td>
                    );
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {others.length > 0 ? (
        <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-neutral-900">{t('otherItems')}</h2>
          {others.map((o) => (
            <div key={o.group}>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
                {o.group}
              </div>
              <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
                {o.skus.map((s) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm" title={s.design_name}>
                      {s.design_name}
                    </span>
                    {qtyInput(s)}
                    {mode === 'box' ? (
                      <input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        value={perBox[`sku:${s.id}`] ?? ''}
                        onChange={(e) =>
                          setPerBox((c) => ({ ...c, [`sku:${s.id}`]: e.target.value }))
                        }
                        placeholder={t('perBoxShort')}
                        aria-label={t('perBoxFor', { size: s.design_name })}
                        className={`w-14 rounded border px-1 py-1 text-center text-sm ${missingBoxSize.includes(`sku:${s.id}`) ? 'border-red-500 bg-red-50' : 'border-amber-300'}`}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <label htmlFor="pad_notes" className="label-base">
          {t('notes')}
        </label>
        <textarea
          id="pad_notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={400}
          className="input-base resize-y"
        />
      </section>

      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
        <div className="mx-auto flex max-w-screen-xl flex-wrap items-center gap-x-6 gap-y-2">
          <div className="text-sm text-neutral-700">
            {t('summary', { items: lines.length, pieces: totalPieces })}
          </div>
          <div className="text-lg font-semibold tabular-nums text-neutral-900">
            {formatRupees(total, locale)}
          </div>
          {missingBoxSize.length > 0 ? (
            <div className="text-sm font-medium text-red-700">{t('needBoxSize')}</div>
          ) : null}
          <div className="ml-auto">
            {lines.length > 0 && customerId && missingBoxSize.length === 0 ? (
              <SubmitButton
                label={t('save')}
                pendingLabel={t('saving')}
                className="btn-primary !w-auto px-6"
              />
            ) : (
              <button type="button" disabled className="btn-primary !w-auto px-6 opacity-50">
                {t('save')}
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
