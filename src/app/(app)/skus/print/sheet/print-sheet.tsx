'use client';

import Link from 'next/link';
import { useRef } from 'react';
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

/**
 * Build an isolated iframe with only the printed labels + @page rule, then
 * print it. Bypasses the parent React tree, Tailwind base styles, and every
 * layout ancestor that contributes height to the live document. Chrome can
 * only paginate what's in the iframe document, so the sheet count matches
 * the row count exactly.
 */
function printIsolated(rowsHtml: string, pageWidth: string, rowPitchMm: number, marginX: string) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }

  // Side padding lives on <body> inside the iframe — not on the React
  // wrapper — because we copy root.innerHTML, which excludes the wrapper.
  // Without this, every row was rendered flush against x=0 of the 57mm
  // page, shoving the left cell 2mm onto the carrier strip.
  doc.open();
  doc.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: ${pageWidth} ${rowPitchMm}mm; margin: 0; }
  html { margin: 0; padding: 0; background: white; }
  body { margin: 0; padding: 0 ${marginX}; background: white; width: ${pageWidth}; box-sizing: border-box; }
  .print-row { display: flex; page-break-after: always; break-after: page; page-break-inside: avoid; break-inside: avoid; }
  .print-row:last-child { page-break-after: auto; break-after: auto; }
</style>
</head>
<body>${rowsHtml}</body>
</html>`);
  doc.close();

  const finish = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      // Give the print dialog a moment to grab the document before we
      // detach the iframe. 1 s is enough on all browsers tested.
      window.setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1000);
    }
  };

  // Wait for the SVG QR images inside the rows to be fully attached before
  // printing. Two RAFs is the standard belt-and-braces for "DOM mounted +
  // one paint cycle".
  iframe.contentWindow?.requestAnimationFrame(() => {
    iframe.contentWindow?.requestAnimationFrame(finish);
  });
}

export function PrintSheet({ items }: { items: SheetItem[] }) {
  const t = useTranslations('skus.print');
  const rows = chunkRows(items, DEFAULT_LABEL_GRID.columns);
  const printRootRef = useRef<HTMLDivElement>(null);

  const labelHmm = mmValue(DEFAULT_LABEL_GRID.labelHeight);
  const gapYmm = mmValue(DEFAULT_LABEL_GRID.gapY);
  const rowPitchMm = labelHmm + gapYmm;

  const handlePrint = () => {
    const root = printRootRef.current;
    if (!root) return;
    printIsolated(
      root.innerHTML,
      DEFAULT_LABEL_GRID.pageWidth,
      rowPitchMm,
      DEFAULT_LABEL_GRID.marginX,
    );
  };

  return (
    <div className="print-sheet-page">
      {/* On-screen toolbar. The Print button copies the rendered rows into
          an isolated iframe — see printIsolated() — and prints that. */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 border-b border-neutral-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-neutral-700">
            {t('sheetTitle')} · {items.length} labels
          </div>
          <div className="flex items-center gap-2">
            <Link href="/skus/print" className="btn-ghost border border-neutral-300 text-sm">
              {t('back')}
            </Link>
            <button type="button" onClick={handlePrint} className="btn-primary !w-auto px-4">
              {t('printNow')}
            </button>
          </div>
        </div>
      </div>

      {/* The on-screen preview. Same DOM that gets captured for the iframe
          print — every SkuLabel uses inline styles so the iframe doesn't
          need any external CSS to render correctly. */}
      <div
        ref={printRootRef}
        className="mx-auto rounded-md border border-dashed border-neutral-300 bg-white"
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
