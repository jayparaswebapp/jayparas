import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildWorkbook, txt, num, type Sheet, type Cell } from './xlsx';

/**
 * The "send to CA" sales register: one .xlsx with two sheets — Kite (tax
 * invoices, GST columns) and Rakhi (bill of supply, no GST) — one row per
 * bill plus a totals row. Respects the same filters as the invoices list so
 * the export matches what the user is looking at.
 *
 * Draft bills are excluded by default (a CA file shouldn't contain drafts);
 * they're only included if the user explicitly filters status=draft.
 */

export interface RegisterFilters {
  line?: string; // 'rakhi' | 'kite' | ''
  status?: string; // 'draft' | 'issued' | 'cancelled' | ''
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  q?: string; // invoice number search
}

interface InvoiceRow {
  invoice_number: string | null;
  revision: number | null;
  business_line: 'rakhi' | 'kite';
  status: 'draft' | 'issued' | 'cancelled';
  invoice_date: string;
  place_of_supply: string | null;
  subtotal: number;
  discount_total: number;
  taxable_total: number;
  packing_charges: number;
  delivery_charges: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  round_off: number;
  grand_total: number;
  customer_snapshot: Record<string, string | null> | null;
  customer: { full_name: string; business_name: string | null; gstin: string | null } | null;
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 50; // 50k bills hard stop — same guard style as loadAllSkus

const SELECT =
  'invoice_number, revision, business_line, status, invoice_date, place_of_supply, subtotal, discount_total, taxable_total, packing_charges, delivery_charges, cgst_total, sgst_total, igst_total, round_off, grand_total, customer_snapshot, customer:billing_customers(full_name, business_name, gstin)';

/** Load every matching invoice, paging past the 1000-row PostgREST cap. */
async function loadInvoices(
  supabase: SupabaseClient,
  filters: RegisterFilters,
): Promise<InvoiceRow[]> {
  const out: InvoiceRow[] = [];
  const line = (filters.line ?? '').trim();
  const status = (filters.status ?? '').trim();
  const from = (filters.from ?? '').trim();
  const to = (filters.to ?? '').trim();
  const q = (filters.q ?? '').trim();

  for (let page = 0; page < MAX_PAGES; page += 1) {
    let query = supabase
      .from('invoices')
      .select(SELECT)
      .is('deleted_at', null)
      .order('business_line', { ascending: true })
      .order('invoice_date', { ascending: true })
      .order('invoice_number', { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (line === 'rakhi' || line === 'kite') query = query.eq('business_line', line);
    if (status === 'draft' || status === 'issued' || status === 'cancelled') {
      query = query.eq('status', status);
    } else {
      // Default: real bills only — never dump drafts into a CA file.
      query = query.in('status', ['issued', 'cancelled']);
    }
    if (from) query = query.gte('invoice_date', from);
    if (to) query = query.lte('invoice_date', to);
    if (q.length > 0) {
      const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
      query = query.ilike('invoice_number', like);
    }

    const { data, error } = await query;
    if (error) break; // return what we have rather than crash the download
    const rows = (data ?? []) as unknown as InvoiceRow[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

function customerLabel(row: InvoiceRow): string {
  const snap = row.customer_snapshot ?? {};
  const biz = snap.business_name ?? row.customer?.business_name ?? null;
  const name = snap.full_name ?? row.customer?.full_name ?? null;
  if (biz && name) return `${biz} (${name})`;
  return biz ?? name ?? '—';
}

function customerGstin(row: InvoiceRow): string {
  return row.customer_snapshot?.gstin ?? row.customer?.gstin ?? '';
}

function fmtDate(s: string): string {
  // YYYY-MM-DD -> DD-MM-YYYY (kept as text; unambiguous for the CA)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

function invoiceNo(row: InvoiceRow): string {
  const base = row.invoice_number ?? '—';
  return row.revision && row.revision > 0 ? `${base} (REV ${row.revision})` : base;
}

const n = (v: unknown) => Number(v) || 0;

/** Kite = tax invoice: include GST columns. */
function kiteSheet(rows: InvoiceRow[]): Sheet {
  const header: Cell[] = [
    txt('Invoice No', true), txt('Date', true), txt('Status', true), txt('Customer', true),
    txt('GSTIN', true), txt('Place of Supply', true),
    txt('Subtotal', true), txt('Discount', true), txt('Taxable', true),
    txt('Packing', true), txt('Delivery', true),
    txt('CGST', true), txt('SGST', true), txt('IGST', true), txt('Round Off', true), txt('Grand Total', true),
  ];
  const body: Cell[][] = rows.map((r) => [
    txt(invoiceNo(r)), txt(fmtDate(r.invoice_date)), txt(r.status), txt(customerLabel(r)),
    txt(customerGstin(r)), txt(r.place_of_supply ?? ''),
    num(n(r.subtotal)), num(n(r.discount_total)), num(n(r.taxable_total)),
    num(n(r.packing_charges)), num(n(r.delivery_charges)),
    num(n(r.cgst_total)), num(n(r.sgst_total)), num(n(r.igst_total)), num(n(r.round_off)), num(n(r.grand_total)),
  ]);
  const sum = (k: keyof InvoiceRow) => rows.reduce((a, r) => a + n(r[k]), 0);
  const total: Cell[] = [
    txt('TOTAL', true), null, null, null, null, null,
    num(sum('subtotal'), true), num(sum('discount_total'), true), num(sum('taxable_total'), true),
    num(sum('packing_charges'), true), num(sum('delivery_charges'), true),
    num(sum('cgst_total'), true), num(sum('sgst_total'), true), num(sum('igst_total'), true),
    num(sum('round_off'), true), num(sum('grand_total'), true),
  ];
  return {
    name: 'Kite (Tax Invoice)',
    colWidths: [16, 12, 10, 30, 18, 16, 11, 10, 11, 10, 10, 10, 10, 10, 10, 12],
    rows: rows.length ? [header, ...body, total] : [header],
  };
}

/** Rakhi = bill of supply: no GST columns. */
function rakhiSheet(rows: InvoiceRow[]): Sheet {
  const header: Cell[] = [
    txt('Invoice No', true), txt('Date', true), txt('Status', true), txt('Customer', true),
    txt('Place of Supply', true),
    txt('Subtotal', true), txt('Discount', true), txt('Taxable', true),
    txt('Packing', true), txt('Delivery', true), txt('Round Off', true), txt('Grand Total', true),
  ];
  const body: Cell[][] = rows.map((r) => [
    txt(invoiceNo(r)), txt(fmtDate(r.invoice_date)), txt(r.status), txt(customerLabel(r)),
    txt(r.place_of_supply ?? ''),
    num(n(r.subtotal)), num(n(r.discount_total)), num(n(r.taxable_total)),
    num(n(r.packing_charges)), num(n(r.delivery_charges)), num(n(r.round_off)), num(n(r.grand_total)),
  ]);
  const sum = (k: keyof InvoiceRow) => rows.reduce((a, r) => a + n(r[k]), 0);
  const total: Cell[] = [
    txt('TOTAL', true), null, null, null, null,
    num(sum('subtotal'), true), num(sum('discount_total'), true), num(sum('taxable_total'), true),
    num(sum('packing_charges'), true), num(sum('delivery_charges'), true),
    num(sum('round_off'), true), num(sum('grand_total'), true),
  ];
  return {
    name: 'Rakhi (Bill of Supply)',
    colWidths: [16, 12, 10, 30, 16, 11, 10, 11, 10, 10, 10, 12],
    rows: rows.length ? [header, ...body, total] : [header],
  };
}

export interface RegisterFile {
  bytes: Buffer;
  filename: string;
  count: number;
}

export async function buildInvoiceRegister(
  supabase: SupabaseClient,
  filters: RegisterFilters,
): Promise<RegisterFile> {
  const all = await loadInvoices(supabase, filters);
  const kite = all.filter((r) => r.business_line === 'kite');
  const rakhi = all.filter((r) => r.business_line === 'rakhi');

  const line = (filters.line ?? '').trim();
  const sheets: Sheet[] = [];
  if (line === 'kite') sheets.push(kiteSheet(kite));
  else if (line === 'rakhi') sheets.push(rakhiSheet(rakhi));
  else sheets.push(rakhiSheet(rakhi), kiteSheet(kite));

  const bytes = buildWorkbook(sheets);

  const range =
    filters.from || filters.to
      ? `_${filters.from || 'start'}_to_${filters.to || 'today'}`
      : '_all';
  const filename = `sales-register${range}.xlsx`;

  return { bytes, filename, count: all.length };
}
