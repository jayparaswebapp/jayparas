'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { SkuLabel } from '@/components/sku-label';
import { DEFAULT_LABEL_GRID } from '@/lib/skus/label-grid';
import type { SkuLabelInput } from '@/lib/skus/label';

export interface SheetItem {
  key: string;
  sku: Omit<SkuLabelInput, 'sku_code'> & { sku_code: string };
}

/**
 * Chunks the flat label list into rows of `columns`. The last row may have
 * only one label; the right slot is left blank (one physical sticker is
 * wasted, but the user wanted exact-count printing so this is intentional).
 */
function chunkRows<T>(items: T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }
  return rows;
}

export function PrintSheet({ items }: { items: SheetItem[] }) {
  const t = useTranslations('skus.print');
  const rows = chunkRows(items, DEFAULT_LABEL_GRID.columns);

  return (
    <div className="print-sheet-page">
      {/*
       * Each @page is exactly one row of stickers (57 × 15 mm). A forced
       * page break after every .print-row makes the browser send one page
       * per row to the printer, and the printer's gap sensor advances the
       * 3 mm row gap automatically. Without this, the browser was using an
       * implicit A4 page height and the thermal printer obediently fed
       * ~A4-worth of stickers per print job → 8 blanks for every 1 used.
       */}
      <style>{`
        @page {
          size: ${DEFAULT_LABEL_GRID.pageWidth} ${DEFAULT_LABEL_GRID.pageHeight};
          margin: 0;
        }
        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            min-height: 0 !important;
            height: auto !important;
          }
          body * { visibility: hidden; }
          .print-sheet-root, .print-sheet-root * { visibility: visible; }
          .print-sheet-root {
            position: absolute;
            inset: 0;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            background: white !important;
          }
          header, nav, .no-print { display: none !important; }
          main { max-width: none !important; padding: 0 !important; margin: 0 !important; }
          .print-row {
            page-break-after: always;
            break-after: page;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .print-row:last-child {
            page-break-after: auto;
            break-after: auto;
          }
        }
      `}</style>

      {/* On-screen toolbar — hidden from print via .no-print. */}
      <div className="no-print sticky top-0 z-10 -mx-4 mb-4 border-b border-neutral-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-neutral-700">
            {t('sheetTitle')} · {items.length} {items.length === 1 ? 'label' : 'labels'}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/skus/print" className="btn-ghost border border-neutral-300 text-sm">
              {t('back')}
            </Link>
            <button
              type="button"
              onClick={() => window.print()}
              className="btn-primary !w-auto px-4"
            >
              {t('printNow')}
            </button>
          </div>
        </div>
      </div>

      {/*
       * Printer-setup hint. CSS @page is only a hint; if the OS-level
       * driver paper size is still A4, the thermal printer will feed A4
       * worth of stickers regardless of what the browser says. The most
       * common reason staff see "8 blanks for every 1 printed" lives in
       * the printer dialog, not the code — hence this in-app reminder.
       */}
      <div className="no-print mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <div className="font-semibold">{t('setupTitle')}</div>
        <p className="mt-1">{t('setupBody')}</p>
        <ol className="mt-2 space-y-1 pl-1">
          <li>{t('setupStep1')}</li>
          <li>{t('setupStep2')}</li>
          <li>{t('setupStep3')}</li>
          <li>{t('setupStep4')}</li>
        </ol>
        <p className="mt-2 text-xs text-amber-800">{t('setupHint')}</p>
      </div>

      {/*
       * On-screen preview: stack rows vertically with a faint separator so
       * you can scroll the queue. In print, each .print-row becomes its
       * own page (one row of stickers per page).
       */}
      <div
        className="print-sheet-root mx-auto rounded-md border border-dashed border-neutral-300 bg-white p-2 print:m-0 print:rounded-none print:border-0 print:p-0"
        style={{ width: DEFAULT_LABEL_GRID.pageWidth }}
      >
        {rows.map((row, rowIdx) => (
          <div
            key={rowIdx}
            className="print-row"
            style={{
              display: 'flex',
              gap: DEFAULT_LABEL_GRID.gapX,
              marginBottom: rowIdx === rows.length - 1 ? 0 : DEFAULT_LABEL_GRID.gapY,
            }}
          >
            {row.map((item) => (
              <SkuLabel key={item.key} sku={item.sku} showBorder />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
