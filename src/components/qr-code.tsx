'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * Renders a square QR code of `value` as inline SVG. Used in the live preview
 * on /skus/new, the SKU detail page, and printed labels.
 *
 * Defaults to error-correction level "M" — good headroom against smudges or
 * partial ink coverage without bloating the matrix. The QR content is the
 * verbatim sku_code (e.g. JP-1325-06), so a scan resolves back to the SKU.
 *
 * Sized via the `size` prop (CSS length). `margin` is in QR modules (not px);
 * 0 means flush to the box edge, which is what the printed label needs (the
 * outer label cell already provides its own padding).
 */
export function QrCode({
  value,
  size = '40mm',
  margin = 0,
  className,
}: {
  value: string;
  size?: string;
  margin?: number;
  className?: string;
}) {
  const [svg, setSvg] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    if (!value) {
      setSvg('');
      return;
    }
    QRCode.toString(value, { type: 'svg', margin, errorCorrectionLevel: 'M' })
      .then((str) => {
        if (cancelled) return;
        // qrcode lib emits its own width/height attrs that lock the SVG to
        // its viewBox units regardless of CSS. Strip them, then inject
        // width/height/style="100%" so the SVG actually fills the parent
        // div. Without this the SVG falls back to the browser default
        // 300×150 — twice as wide as tall — and squashes the square QR
        // matrix into horizontal stripes.
        const sized = str
          .replace(/\s+(width|height)="[^"]*"/g, '')
          .replace(
            /<svg\b/,
            '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:100%"',
          );
        setSvg(sized);
      })
      .catch(() => {
        if (!cancelled) setSvg('');
      });
    return () => {
      cancelled = true;
    };
  }, [value, margin]);

  return (
    <div
      className={className}
      style={{ width: size, height: size, display: 'inline-block' }}
      aria-label={value || undefined}
      // QR is pure visual; svg comes from qrcode lib (no user content interpolated).
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
