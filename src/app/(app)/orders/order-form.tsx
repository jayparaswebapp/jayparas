'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormState } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ServerError, SubmitButton } from '@/components/form-status';
import { formatRupees } from '@/lib/format/locale-shared';
import type { Locale } from '@/lib/i18n/config';
import type { ActionResult } from '@/lib/rpc/action-result';
import type { KitePricing } from '@/lib/billing/kite-pricing';
import type {
  BusinessLine,
  CustomerOption,
  SkuOption,
} from '@/app/(app)/billing/invoices/invoice-form';
import { ScanButton } from '@/app/(app)/billing/invoices/scan-button';
import { saveOrderAction } from './actions';

/**
 * One order line. Rate / discount / HSN / GST are worked out from the
 * product (and, for kite, the party's company-wise %) when the line is added,
 * and saved onto the order — they're the prices the bill will use later.
 */
export interface OrderLineValues {
  sku_id: string;
  sku_code: string;
  design_name: string;
  pack_size: number;
  is_discountable: boolean;
  uom: string;
  rate: number;
  discount_pct: number;
  hsn_code: string;
  gst_pct: number;
  qty: string;
}

export interface OrderFormValues {
  id?: string;
  business_line: BusinessLine;
  customer_id: string;
  notes: string;
  lines: OrderLineValues[];
}

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function OrderForm({
  initial,
  customers,
  skus,
  kitePricing,
  locale,
}: {
  initial: OrderFormValues;
  customers: CustomerOption[];
  skus: SkuOption[];
  kitePricing: KitePricing;
  locale: Locale;
}) {
  const t = useTranslations('orders.form');
  const router = useRouter();
  const [state, formAction] = useFormState<ActionResult | null, FormData>(saveOrderAction, null);

  const [businessLine, setBusinessLine] = useState<BusinessLine>(initial.business_line);
  const [customerId, setCustomerId] = useState(initial.customer_id);
  const [notes, setNotes] = useState(initial.notes);
  const [lines, setLines] = useState<OrderLineValues[]>(initial.lines);
  const [scanValue, setScanValue] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (state?.ok) router.push(state.redirectTo ?? '/orders');
  }, [state, router]);

  const lineOf = (s: SkuOption): BusinessLine => s.business_line ?? 'rakhi';
  const skuById = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const lineSkus = useMemo(
    () => skus.filter((s) => (s.business_line ?? 'rakhi') === businessLine),
    [skus, businessLine],
  );
  const skuByCode = useMemo(() => {
    const m = new Map<string, SkuOption>();
    for (const s of skus) {
      m.set(s.sku_code.toUpperCase(), s);
      if (typeof s.short_code === 'number') m.set(String(s.short_code).padStart(4, '0'), s);
    }
    return m;
  }, [skus]);

  function resolve(raw: string): SkuOption | undefined {
    const code = raw.trim().toUpperCase();
    if (!code) return undefined;
    if (/^\d{1,4}$/.test(code)) return skuByCode.get(code.padStart(4, '0')) ?? skuByCode.get(code);
    return skuByCode.get(code);
  }

  /** Price fields for a product on this order (kite: party's company %). */
  function priceFor(sku: SkuOption, custId: string) {
    if (lineOf(sku) !== 'kite') {
      return { discount_pct: sku.discount_pct ?? 0, hsn_code: '', gst_pct: 0 };
    }
    const g = sku.product_group_id ? kitePricing.groups[sku.product_group_id] : undefined;
    return {
      discount_pct: g ? (kitePricing.discounts[custId]?.[g.company_id] ?? 0) : 0,
      hsn_code: g?.hsn_code ?? '',
      gst_pct: g?.gst_pct ?? 0,
    };
  }

  function groupName(skuId: string): string | null {
    const s = skuById.get(skuId);
    return s?.product_group_id ? (kitePricing.groups[s.product_group_id]?.name ?? null) : null;
  }

  function addSku(sku: SkuOption) {
    if (lineOf(sku) !== businessLine) {
      setScanError(lineOf(sku) === 'kite' ? t('scanIsKiteProduct') : t('scanIsRakhiProduct'));
      return;
    }
    const isPerPack = sku.rate_unit === 'pack';
    const step = isPerPack ? 1 : sku.pack_size;
    setLines((curr) => {
      const i = curr.findIndex((l) => l.sku_id === sku.id);
      if (i >= 0) {
        return curr.map((l, j) => (j === i ? { ...l, qty: String(num(l.qty) + step) } : l));
      }
      return [
        ...curr,
        {
          sku_id: sku.id,
          sku_code: sku.sku_code,
          design_name: sku.design_name,
          pack_size: sku.pack_size,
          is_discountable: sku.is_discountable,
          uom: isPerPack ? (sku.pack_size === 12 ? 'Doz' : 'Pack') : 'Pcs',
          rate: sku.price,
          ...priceFor(sku, customerId),
          qty: String(step),
        },
      ];
    });
    setScanError(null);
    setScanValue('');
    scanRef.current?.focus();
  }

  function handleScan(raw: string) {
    const sku = resolve(raw);
    if (!sku) {
      setScanError(t('scanNotFound', { code: raw.trim() }));
      return;
    }
    addSku(sku);
  }

  function changeBusinessLine(next: BusinessLine) {
    if (next === businessLine) return;
    if (lines.length > 0 && !window.confirm(t('switchLineConfirm'))) return;
    setLines([]);
    setBusinessLine(next);
  }

  function changeCustomer(id: string) {
    setCustomerId(id);
    // Kite: re-price every line with the new party's company-wise %.
    setLines((curr) =>
      curr.map((l) => {
        const s = skuById.get(l.sku_id);
        return s && lineOf(s) === 'kite' ? { ...l, ...priceFor(s, id) } : l;
      }),
    );
  }

  const showGst = businessLine === 'kite';
  const lineAmount = (l: OrderLineValues) => {
    const sub = round2(num(l.qty) * l.rate * (1 - l.discount_pct / 100));
    return showGst ? round2(sub * (1 + l.gst_pct / 100)) : sub;
  };
  const total = round2(lines.reduce((a, l) => a + lineAmount(l), 0));

  const payload = JSON.stringify({
    id: initial.id,
    business_line: businessLine,
    customer_id: customerId,
    notes,
    lines: lines
      .filter((l) => num(l.qty) > 0)
      .map((l) => ({
        sku_id: l.sku_id,
        sku_snapshot: {
          sku_code: l.sku_code,
          design_name: l.design_name,
          pack_size: l.pack_size,
          is_discountable: l.is_discountable,
        },
        description: l.design_name,
        hsn_code: l.hsn_code,
        uom: l.uom,
        rate: l.rate,
        discount_pct: l.discount_pct,
        gst_pct: showGst ? l.gst_pct : 0,
        qty: num(l.qty),
      })),
  });

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />

      <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex gap-2">
          {(['rakhi', 'kite'] as const).map((bl) => (
            <button
              key={bl}
              type="button"
              onClick={() => changeBusinessLine(bl)}
              className={`btn-ghost flex-1 border ${businessLine === bl ? 'border-brand-700 bg-brand-50 text-brand-900' : 'border-neutral-300'}`}
            >
              {bl === 'rakhi' ? t('rakhi') : t('kite')}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor="order_customer" className="label-base">
            {t('party')}
          </label>
          <select
            id="order_customer"
            value={customerId}
            onChange={(e) => changeCustomer(e.target.value)}
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
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <label htmlFor="order_scan" className="label-base">
          {t('scanLabel')}
        </label>
        <div className="flex items-center gap-2">
          <input
            id="order_scan"
            ref={scanRef}
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleScan(scanValue);
              }
            }}
            list="order-sku-suggestions"
            autoComplete="off"
            placeholder={t('scanPlaceholder')}
            className="input-base flex-1 font-mono"
          />
          <button
            type="button"
            onClick={() => handleScan(scanValue)}
            className="btn-ghost border border-neutral-300"
          >
            {t('add')}
          </button>
          <ScanButton label="Scan" onDetected={(code) => handleScan(code)} />
        </div>
        <datalist id="order-sku-suggestions">
          {lineSkus.map((s) => (
            <option key={s.id} value={s.sku_code}>
              {s.design_name}
            </option>
          ))}
        </datalist>
        {scanError ? (
          <p className="text-xs text-red-700">{scanError}</p>
        ) : (
          <p className="text-xs text-neutral-500">{t('scanHint')}</p>
        )}

        {lines.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-300 px-3 py-6 text-center text-sm text-neutral-500">
            {t('noLines')}
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
            {lines.map((l, idx) => (
              <li key={l.sku_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <div className="min-w-0 flex-1 basis-48">
                  <div className="truncate font-medium text-neutral-900">{l.design_name}</div>
                  <div className="text-xs text-neutral-500">
                    {showGst && groupName(l.sku_id) ? `${groupName(l.sku_id)} · ` : ''}
                    {formatRupees(l.rate, locale)}
                    {l.discount_pct ? ` − ${l.discount_pct}%` : ''}
                    {showGst && l.gst_pct ? ` + GST ${l.gst_pct}%` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    value={l.qty}
                    onChange={(e) =>
                      setLines((curr) =>
                        curr.map((x, j) => (j === idx ? { ...x, qty: e.target.value } : x)),
                      )
                    }
                    aria-label={t('qty')}
                    className="input-base !min-h-0 !w-24 !px-2 !py-1 text-center"
                  />
                  <span className="text-xs text-neutral-500">{l.uom}</span>
                </div>
                <div className="w-24 text-right text-sm font-semibold tabular-nums">
                  {formatRupees(lineAmount(l), locale)}
                </div>
                <button
                  type="button"
                  onClick={() => setLines((curr) => curr.filter((_, j) => j !== idx))}
                  className="px-1 text-lg text-neutral-400 hover:text-red-600"
                  aria-label={t('remove')}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div>
          <label htmlFor="order_notes" className="label-base">
            {t('notes')}
          </label>
          <textarea
            id="order_notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={500}
            className="input-base resize-y"
          />
        </div>
        <div className="flex items-baseline justify-between border-t border-neutral-200 pt-3">
          <span className="text-sm font-medium text-neutral-700">{t('estimatedTotal')}</span>
          <span className="text-xl font-semibold tabular-nums text-neutral-900">
            {formatRupees(total, locale)}
          </span>
        </div>
      </section>

      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton
          label={t('save')}
          pendingLabel={t('saving')}
          className="btn-primary !w-auto px-5"
        />
        <Link
          href={initial.id ? `/orders/${initial.id}` : '/orders'}
          className="btn-ghost border border-neutral-300"
        >
          {t('cancel')}
        </Link>
      </div>
    </form>
  );
}
