'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { isAvailable, printHtml } from '@/lib/print/qz';
import { getPrinter, type PrinterRole } from '@/lib/print/printer-settings';

/**
 * The primary "Print" button on any print page. Behaviour depends on what's
 * available at click time:
 *
 *  1. QZ Tray reachable AND a printer is bound to this role in
 *     /admin/print-settings → send the current document's HTML straight to
 *     that printer. No browser dialog, no manual printer picking.
 *  2. Anything else (no QZ, unconfigured role, error mid-flight) → fall
 *     back to `window.print()` so the operator can still print via the
 *     browser dialog. Failure surface is invisible to them.
 *
 * `htmlProvider` returns the HTML to send to QZ. The default grabs the
 * whole document so an existing print-styled page (with @media print CSS)
 * looks identical to a browser print. Pages that manage their own iframe
 * (like the label sheet) can pass a custom provider that pulls the iframe's
 * document instead.
 */
export function QzPrintButton({
  role,
  htmlProvider,
  onNativePrint,
  className = 'btn-primary !w-auto bg-brand-700 px-4',
  copies = 1,
  children,
}: {
  role: PrinterRole;
  htmlProvider?: () => string | null;
  onNativePrint?: () => void;
  className?: string;
  copies?: number;
  children: React.ReactNode;
}) {
  const t = useTranslations('print');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setBusy(true);
    try {
      const printer = getPrinter(role);
      const canQz = printer ? await isAvailable() : false;
      if (canQz && printer) {
        const html = (htmlProvider ?? defaultHtml)();
        if (!html) {
          fallbackNative(onNativePrint);
          return;
        }
        await printHtml(printer, html, { copies });
        return;
      }
      // No QZ or no binding — surface a small hint but always print.
      if (!printer) setError(t('unconfigured'));
      else setError(t('qzUnreachable'));
      fallbackNative(onNativePrint);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      fallbackNative(onNativePrint);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={handleClick} disabled={busy} className={className}>
        {busy ? t('sending') : children}
      </button>
      {error ? (
        <p className="text-[10px] text-neutral-500" title={error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function defaultHtml(): string | null {
  if (typeof document === 'undefined') return null;
  return `<!doctype html>${document.documentElement.outerHTML}`;
}

function fallbackNative(onNativePrint?: () => void) {
  if (onNativePrint) onNativePrint();
  else if (typeof window !== 'undefined') window.print();
}
