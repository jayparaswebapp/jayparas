/**
 * Per-device printer bindings, stored in localStorage because printers
 * differ per PC — the label desk has a TSC, the invoice desk has an Epson,
 * a phone has no local printers at all. Anything server-side would force a
 * single global config which doesn't match how the shop actually operates.
 *
 * Roles the app knows about:
 *   - "label" — QR sticker sheets (/skus/print/…)
 *   - "invoice" — invoices, credit notes, payment receipts, ledger prints
 *
 * More roles can be added as new print flows arrive (e.g. "job_slip" if we
 * ship the job-work issue slip in phase 2). Kept as a union so a typo at a
 * call site is a compile error.
 */

'use client';

export type PrinterRole = 'label' | 'invoice';

const KEY_PREFIX = 'jp.printer.';

export function getPrinter(role: PrinterRole): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(KEY_PREFIX + role);
  } catch {
    return null;
  }
}

export function setPrinter(role: PrinterRole, printerName: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (printerName && printerName.length > 0) {
      window.localStorage.setItem(KEY_PREFIX + role, printerName);
    } else {
      window.localStorage.removeItem(KEY_PREFIX + role);
    }
  } catch {
    // Private-browsing mode blocks localStorage; silently no-op — the print
    // button will fall back to native print in that case.
  }
}
