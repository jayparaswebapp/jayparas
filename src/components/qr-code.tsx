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
        // Strip the outer width/height so our CSS controls sizing.
        setSvg(str.replace(/\s+(width|height)="[^"]*"/g, ''));
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
