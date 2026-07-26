'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BusinessLine, InvoiceLineValues } from './invoice-form';

/**
 * A faithful snapshot of everything the user has typed into the invoice form.
 * We mirror this to the browser's OWN storage (localStorage) as they type, so
 * an in-progress bill survives a crash, a refresh, a new deploy landing, or the
 * shop's internet dropping mid-save. localStorage lives on the device and needs
 * no network — that's the whole point.
 */
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

function keyFor(invoiceId: string | undefined): string {
  // A new invoice and each existing invoice being edited get their own slot,
  // so restoring one never clobbers another.
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

/**
 * Crash-safe local autosave for the invoice form.
 *
 * - Mirrors the live form to
