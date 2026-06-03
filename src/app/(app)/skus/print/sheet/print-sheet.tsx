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

  // Per-row page so the printer's gap sensor (Labels With Gaps mode) can
  // do its job: each printed page = one label cycle = labelHeight + gapY.
  // For the TSC TE244 default stock (15 mm label + 2 mm gap = 17 mm),
  // this lines up perfectly. page-break-after on every row forces Chrome
  // to emit exactly rows.length pages instead of guessing from layout
  // height, which is what caused the "9 sheets" preview.
  const labelHmm = mmValue(DEFAULT_LABEL_GRID.labelHeight);
  const gapYmm = mmValue(DEFAULT_LABEL_GRID.gapY);
  const rowPitchMm = labelHmm + gapYmm;

  return (
    <div className="print-sheet-page">
      {/* Page-scoped print CSS, plain <style>. Lives inline so the sheet is
          self-contained and we can reset all parent layout chrome (Header +
          SubNav, both rendered as <header>/<nav>) when the user hits Print.
          @page is sized to one row (one label cycle). Each row carries
          page-break-after so Chrome paginates per-row and the printer
          driver pairs each Chrome page with one physical label. */}
      <style>{`
        @page { size: ${DEFAULT_LABEL_GRID.pageWidth} ${rowPitchMm}mm; margin: 0; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; background: white; width: ${DEFAULT_LABEL_GRID.pageWidth} !important; min-height: 0 !important; }
          header, nav, .no-print { display: none !important; }
          *, *::before, *::after { min-height: 0 !important; }
          main { max-width: none !important; padding: 0 !important; margin: 0 !important; min-height: 0 !important; flex: none !important; }
          .print-sheet-root { margin: 0 !important; border: 0 !important; min-height: 0 !important; padding: 0 !important; }
          .print-row { page-break-after: always; break-after: page; page-break-inside: avoid; break-inside: avoid; height: ${labelHmm}mm; margin-bottom: 0 !important; }
          .print-row:last-child { page-break-after: auto; break-after: auto; }
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
