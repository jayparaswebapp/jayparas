'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/page-header';
import { formatRupees } from '@/lib/format/locale-shared';
import { labelUnit } from '@/lib/skus/label';
import type { Locale } from '@/lib/i18n/config';

export interface PickerRow {
  id: string;
  sku_code: string;
  pack_type: 'single' | 'mix';
  design_no: string | null;
  mix_code: string | null;
  design_name: string;
  pack_size: number;
  price: number;
  photo_url: string | null;
}

function normalise(s: string): string {
  return s.toLowerCase().trim();
}

function matches(r: PickerRow, q: string): boolean {
  if (!q) return true;
  const hay = [r.design_no, r.mix_code, r.design_name, r.sku_code]
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase())
    .join(' ');
  return hay.includes(q);
}

/**
 * Builds the `/skus/print/sheet?items=...` URL from selected (id, quantity)
 * pairs. Encoded as `id:qty,id:qty` to keep the URL terse — typical orders
 * are 5-20 SKUs at v1, well within URL limits even at modest browsers.
 */
function buildSheetHref(selections: Map<string, number>): string {
  const parts: string[] = [];
  for (const [id, qty] of selections) {
    if (qty > 0) parts.push(`${id}:${qty}`);
  }
  return `/skus/print/sheet?items=${encodeURIComponent(parts.join(','))}`;
}

export function PrintPicker({ skus, locale }: { skus: PickerRow[]; locale: Locale }) {
  const t = useTranslations('skus.print');
  const tLib = useTranslations('skus.library');
  const tCard = useTranslations('skus.library.card');

  const [query, setQuery] = useState('');
  const [qtys, setQtys] = useState<Map<string, number>>(new Map());

  const visible = useMemo(() => {
    const q = normalise(query);
    return skus.filter((s) => matches(s, q));
  }, [skus, query]);

  const totalSelections = Array.from(qtys.values()).filter((n) => n > 0).length;
  const totalLabels = Array.from(qtys.values()).reduce((acc, n) => acc + (n > 0 ? n : 0), 0);

  function setQtyFor(id: string, raw: string) {
    const n = Math.max(0, Math.min(999, Number.parseInt(raw, 10) || 0));
    setQtys((prev) => {
      const next = new Map(prev);
      if (n > 0) next.set(id, n);
      else next.delete(id);
      return next;
    });
  }

  function clearAll() {
    setQtys(new Map());
  }

  const href = buildSheetHref(qtys);
  const canOpen = totalSelections > 0;

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <label htmlFor="print-search" className="sr-only">
            {tLib('searchLabel')}
          </label>
          <input
            id="print-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tLib('searchPlaceholder')}
            className="input-base"
          />
        </div>
        <button
          type="button"
          onClick={clearAll}
          disabled={totalSelections === 0}
          className="btn-ghost border border-neutral-300 text-sm disabled:opacity-50"
        >
          {t('clear')}
        </button>
      </div>

      {skus.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500">
          {t('empty')}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
          {visible.map((s) => {
            const qty = qtys.get(s.id) ?? 0;
            return (
              <li key={s.id} className="flex items-center gap-3 px-3 py-3">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-neutral-100 ring-1 ring-neutral-200">
                  {s.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.photo_url} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-neutral-900">
                    {s.design_name}
                  </div>
                  <div className="truncate text-xs text-neutral-600">
                    {s.pack_type === 'single'
                      ? `${tCard('designLabel')} ${s.design_no}`
                      : `${tCard('mixLabel')} ${s.mix_code}`}{' '}
                    · {labelUnit(s.pack_size)} · {formatRupees(s.price, locale)}
                  </div>
                  <code className="font-mono text-xs text-neutral-500">{s.sku_code}</code>
                </div>
                <label className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="text-xs text-neutral-500">Qty</span>
                  <input
                    type="number"
                    min="0"
                    max="999"
                    inputMode="numeric"
                    value={qty || ''}
                    onChange={(e) => setQtyFor(s.id, e.target.value)}
                    placeholder="0"
                    className="h-11 w-16 rounded-md border border-neutral-300 px-2 text-center text-base focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  />
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {/* Sticky action bar so the staff doesn't lose track of the selection count while scrolling. */}
      <div className="sticky bottom-0 -mx-4 mt-4 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-neutral-700">
            {canOpen
              ? `${t('selectedCount', { count: totalSelections })} · ${totalLabels} labels`
              : t('selectedNone')}
          </div>
          <a
            href={canOpen ? href : '#'}
            aria-disabled={!canOpen}
            className={
              canOpen
                ? 'btn-primary !w-auto px-4'
                : 'btn-primary !w-auto cursor-not-allowed px-4 opacity-50'
            }
            onClick={(e) => {
              if (!canOpen) e.preventDefault();
            }}
          >
            {t('openSheet')}
          </a>
        </div>
      </div>
    </>
  );
}
