'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
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
 * Build the exact HTML the printer will receive. Used twice: once for the
 * visible preview iframe on the page, and again — identically — for the
 * print() call. Keeping the two byte-for-byte identical means whatever
 * staff see on screen is exactly what comes off the printer.
 */
function buildPrintHtml(
  rowsHtml: string,
  pageWidth: string,
  rowPitchMm: number,
  marginX: string,
): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: ${pageWidth} ${rowPitchMm}mm; margin: 0; }
  html { margin: 0; padding: 0; background: white; }
  body {
    margin: 0;
    padding: 0 ${marginX};
    background: white;
    width: ${pageWidth};
    box-sizing: border-box;
    font-family: system-ui, -apple-system, "Segoe UI", Inter, "Helvetica Neue", Arial, sans-serif;
    color: #000;
  }
  .print-row {
    display: flex;
    page-break-after: always;
    break-after: page;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .print-row:last-child {
    page-break-after: auto;
    break-after: auto;
  }
</style>
</head>
<body>${rowsHtml}</body>
</html>`;
}

export function PrintSheet({ items }: { items: SheetItem[] }) {
  const t = useTranslations('skus.print');
  const rows = chunkRows(items, DEFAULT_LABEL_GRID.columns);
  const sourceRef = useRef<HTMLDivElement>(null);
  const previewIframeRef = useRef<HTMLIFrameElement>(null);

  const labelHmm = mmValue(DEFAULT_LABEL_GRID.labelHeight);
  const gapYmm = mmValue(DEFAULT_LABEL_GRID.gapY);
  const rowPitchMm = labelHmm + gapYmm;
  const previewHeightMm = rows.length * rowPitchMm;

  // Mirror the React-rendered rows into the visible iframe whenever items
  // change. The iframe is the SAME document that will print, so what staff
  // see on screen is byte-for-byte what the printer receives.
  useEffect(() => {
    const source = sourceRef.current;
    const iframe = previewIframeRef.current;
    if (!source || !iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;
    const html = buildPrintHtml(
      source.innerHTML,
      DEFAULT_LABEL_GRID.pageWidth,
      rowPitchMm,
      DEFAULT_LABEL_GRID.marginX,
    );
    doc.open();
    doc.write(html);
    doc.close();
  }, [items, rowPitchMm]);

  const handlePrint = () => {
    const win = previewIframeRef.current?.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
  };

  return (
    <div className="print-sheet-page">
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

      <p className="mb-3 text-xs text-neutral-600">
        Live preview of the exact HTML the printer will receive — same width (
        {DEFAULT_LABEL_GRID.pageWidth}), same row pitch ({rowPitchMm} mm), same side margin (
        {DEFAULT_LABEL_GRID.marginX}). What you see is what prints.
      </p>

      {/*
       * Hidden source DOM: React renders the rows here so we can grab their
       * serialised HTML (including inline-styled SVG QR codes) and pump it
       * into the visible iframe.
       */}
      <div ref={sourceRef} style={{ display: 'none' }} aria-hidden="true">
        {rows.map((row, rowIdx) => (
          <div
            key={rowIdx}
            className="print-row"
            style={{
              display: 'flex',
              gap: DEFAULT_LABEL_GRID.gapX,
            }}
          >
            {row.map((item) => (
              <SkuLabel key={item.key} sku={item.sku} />
            ))}
          </div>
        ))}
      </div>

      {/* The visible print preview — and the actual document we print. */}
      <iframe
        ref={previewIframeRef}
        title="Print preview"
        className="mx-auto block bg-white"
        style={{
          width: DEFAULT_LABEL_GRID.pageWidth,
          height: `${previewHeightMm}mm`,
          border: '1px dashed #cbd5e1',
        }}
      />
    </div>
  );
}
