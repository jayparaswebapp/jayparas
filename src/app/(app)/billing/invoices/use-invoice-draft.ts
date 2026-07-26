'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BusinessLine, InvoiceLineValues } from './invoice-form';

// A faithful snapshot of everything the user has typed into the invoice form.
// It is mirrored to the browser's own storage (localStorage) as they type, so
// an in-progress bill survives a crash, a refresh, a new deploy, or the shop's
// internet dropping mid-save. localStorage lives on the device and needs no
// network, which is the whole point.
export interface InvoiceDraft {
  v: 1;
  savedAt: number;
  businessLine: BusinessLine;
  customerId: string;
  placeOfSupply: string;
  invoiceDate: string;
  notes: string;
  terms: string;
  packingCharges: string;
  deliveryCharges: string;
  lines: InvoiceLineValues[];
}

export type InvoiceDraftSnapshot = Omit<InvoiceDraft, 'v' | 'savedAt'>;

const KEY_PREFIX = 'jaiparas:invoice-draft:';
const DEBOUNCE_MS = 400;

// A new invoice and each existing invoice being edited get their own slot,
// so restoring one never clobbers another.
function keyFor(invoiceId: string | undefined): string {
  return KEY_PREFIX + (invoiceId ?? 'new');
}

function readDraft(invoiceId: string | undefined): InvoiceDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(keyFor(invoiceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InvoiceDraft;
    if (parsed && parsed.v === 1 && Array.isArray(parsed.lines)) return parsed;
    return null;
  } catch {
    return null;
  }
}

// Crash-safe local autosave for the invoice form.
// - Mirrors the live form to localStorage (debounced) on every change.
// - Exposes any draft recovered on first mount so the form can offer
//   Restore / Discard.
// - Clears the stored draft ONLY when the server confirms a successful save.
//   Every other outcome — a failed save, a reload, a dropped connection, the
//   phone sleeping — keeps the draft. "Keep unless we are certain it saved" is
//   the only safe default for data the shop cannot afford to re-enter.
export function useInvoiceDraft(
  invoiceId: string | undefined,
  snapshot: InvoiceDraftSnapshot,
) {
  // The draft found on first mount (if any). Held in state so the banner is
  // stable even as the user starts editing.
  const [recovered] = useState<InvoiceDraft | null>(() => readDraft(invoiceId));

  const snapshotJson = JSON.stringify(snapshot);

  // Debounced mirror to storage on every change.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = window.setTimeout(() => {
      try {
        const draft: InvoiceDraft = {
          v: 1,
          savedAt: Date.now(),
          ...(JSON.parse(snapshotJson) as InvoiceDraftSnapshot),
        };
        window.localStorage.setItem(keyFor(invoiceId), JSON.stringify(draft));
      } catch {
        // Storage full or disabled (private mode). Ignore: the bill is still
        // safe in the form's memory, we just cannot add the extra backup.
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [snapshotJson, invoiceId]);

  const clearDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(keyFor(invoiceId));
    } catch {
      // ignore
    }
  }, [invoiceId]);

  return { recovered, clearDraft };
}
