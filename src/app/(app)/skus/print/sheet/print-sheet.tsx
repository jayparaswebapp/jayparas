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
 * Chunks the flat label list into rows of `columns` items. Padding the
 * trailing row is unnecessary on a continuous roll — the printer will simply
 * stop after the last label.
 */
function chunkRows<T>(items: T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }
  return rows;
}

function mmValue(css: string): number {
  return parseFloat(css.replace('mm', ''));
}

export function PrintSheet({ items }: { items: SheetItem[] }) {
  const t = useTranslations('skus.print');
  const rows = chunkRows(items, DEFAULT_LABEL_GRID.columns);

  // Pin the @page height to the exact content height so the browser /
  // print driver doesn't fall back to a default sheet (A4 etc.) and feed
  // dozens of blank stickers past the last printed row.
  const labelHmm = mmValue(DEFAULT_LABEL_GRID.labelHeight);
  const gapYmm = mmValue(DEFAULT_LABEL_GRID.gapY);
  const pageHeightMm = rows.length * labelHmm + Math.max(0, rows.length - 1) * gapYmm;

  return (
    <div className="print-sheet-page">
      {/* Page-scoped print CSS, plain <style>. Lives inline so the sheet is
          self-contained and we can reset all parent layout chrome (Header +
          SubNav, both rendered as <header>/<nav>) when the user hits Print.
          The page height is computed from row count so the printer stops at
          the last label instead of feeding to a default sheet height. */}
      <style>{`
        @page { size: ${DEFAULT_LABEL_GRID.pageWidth} ${pageHeightMm}mm; margin: 0; }
        @media print {
          html, body { margin: 0; padding: 0; background: white; }
          header, nav, .no-print { display: none !important; }
          main { max-width: none !important; padding: 0 !important; margin: 0 !important; }
          .print-sheet-root { margin: 0 !important; border: 0 !important; }
          .print-row { page-break-inside: avoid; break-inside: avoid; }
        }
      `}</style>

      {/* On-screen toolbar — hidden from print via .no-print. */}
      <div className="no-print sticky top-0 z-10 -mx-4 mb-4 border-b border-neutral-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-neutral-700">
            {t('sheetTitle')} · {items.length} labels
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

      {/* The actual label sheet. Same DOM used for both screen preview and print.
          Horizontal padding is the physical side margin from label-grid;
          vertical padding stays zero so the first label starts at the roll's
          leading edge. */}
      <div
        className="print-sheet-root mx-auto rounded-md border border-dashed border-neutral-300 bg-white print:m-0 print:rounded-none print:border-0"
        style={{
          width: DEFAULT_LABEL_GRID.pageWidth,
          paddingLeft: DEFAULT_LABEL_GRID.marginX,
          paddingRight: DEFAULT_LABEL_GRID.marginX,
          paddingTop: 0,
          paddingBottom: 0,
        }}
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
              <SkuLabel key={item.key} sku={item.sku} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
