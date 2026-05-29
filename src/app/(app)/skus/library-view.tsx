'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/badges';
import { formatRupees } from '@/lib/format/locale-shared';
import { labelUnit } from '@/lib/skus/label';
import type { Locale } from '@/lib/i18n/config';

export interface SkuRow {
  id: string;
  sku_code: string;
  pack_type: 'single' | 'mix';
  design_no: string | null;
  mix_code: string | null;
  design_name: string;
  pack_size: number;
  price: number;
  is_active: boolean;
  photo_url: string | null;
}

function normaliseQuery(s: string): string {
  return s.toLowerCase().trim();
}

function matches(row: SkuRow, q: string): boolean {
  if (!q) return true;
  const hay = [row.design_no, row.mix_code, row.design_name, row.sku_code]
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase())
    .join(' ');
  return hay.includes(q);
}

export function SkuLibraryView({
  skus,
  canWrite,
  locale,
}: {
  skus: SkuRow[];
  canWrite: boolean;
  locale: Locale;
}) {
  const t = useTranslations('skus.library');
  const tCard = useTranslations('skus.library.card');
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const visible = useMemo(() => {
    const q = normaliseQuery(query);
    return skus.filter((s) => (showInactive || s.is_active) && matches(s, q));
  }, [skus, query, showInactive]);

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          canWrite ? (
            <Link href="/skus/new" className="btn-primary !w-auto px-4">
              {t('newButton')}
            </Link>
          ) : null
        }
      />

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <label htmlFor="sku-search" className="sr-only">
            {t('searchLabel')}
          </label>
          <input
            id="sku-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="input-base"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-5 w-5"
          />
          {t('includeInactive')}
        </label>
      </div>

      {skus.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500">
          {t('empty')}
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500">
          {t('noMatches')}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visible.map((s) => (
            <li key={s.id}>
              <Link
                href={`/skus/${s.id}`}
                className="hover:border-brand-300 flex h-full gap-3 rounded-lg border border-neutral-200 bg-white p-3 transition hover:bg-brand-50/30"
              >
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-neutral-100 ring-1 ring-neutral-200">
                  {s.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.photo_url} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-neutral-900">{s.design_name}</span>
                    <StatusBadge isActive={s.is_active} />
                  </div>
                  <div className="mt-0.5 text-sm text-neutral-700">
                    {s.pack_type === 'single'
                      ? `${tCard('designLabel')} ${s.design_no}`
                      : `${tCard('mixLabel')} ${s.mix_code}`}{' '}
                    · {labelUnit(s.pack_size)}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                    <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-700">
                      {s.sku_code}
                    </code>
                    <span className="font-medium text-neutral-700">
                      {formatRupees(s.price, locale)}
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
