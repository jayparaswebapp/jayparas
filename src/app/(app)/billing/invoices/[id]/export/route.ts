// Single-bill Excel export.  GET /billing/invoices/[id]/export
// Two sheets: "Bill" (header + totals) and "Items" (line-item table).
// PDF of a single bill is already covered by the existing Print page.

import { NextResponse } from 'next/server';
import { requireAppUser } from '@/lib/users/current';
import { createClient } from '@/lib/supabase/server';
import { buildWorkbook, txt, num, type Cell, type Sheet } from '@/lib/export/xlsx';

export const dynamic = 'force-dynamic';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, '0')}-${MONTHS[m - 1]}-${y}`;
}

interface Invoice {
  id: string;
  invoice_number: string | null;
  business_line: 'rakhi' | 'kite';
  status: string;
  invoice_date: string;
  place_of_supply: string | null;
  subtotal: number;
  discount_total: number;
  taxable_total: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  packing_charges: number;
  delivery_charges: number;
  round_off: number;
  grand_total: number;
  customer_snapshot: Record<string, string> | null;
  customer: { full_name: string; business_name: string | null; gstin: string | null } | null;
}

interface LineRow {
  line_no: number;
  description: string;
  hsn_code: string | null;
  qty: number;
  uom: string;
  rate: number;
  discount_pct: number;
  gst_pct: number;
  line_subtotal: number;
  line_cgst: number;
  line_sgst: number;
  line_igst: number;
  line_total: number;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  await requireAppUser();
  const supabase = createClient();

  const { data: inv, error } = await supabase
    .from('invoices')
    .select(
      'id, invoice_number, business_line, status, invoice_date, place_of_supply, subtotal, discount_total, taxable_total, cgst_total, sgst_total, igst_total, packing_charges, delivery_charges, round_off, grand_total, customer_snapshot, customer:billing_customers(full_name, business_name, gstin)',
    )
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!inv) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const invoice = inv as unknown as Invoice;

  const { data: lineData } = await supabase
    .from('invoice_lines')
    .select(
      'line_no, description, hsn_code, qty, uom, rate, discount_pct, gst_pct, line_subtotal, line_cgst, line_sgst, line_igst, line_total',
    )
    .eq('invoice_id', params.id)
    .order('line_no', { ascending: true });
  const lines = (lineData ?? []) as unknown as LineRow[];

  const isKite = invoice.business_line === 'kite';
  const snap = invoice.customer_snapshot;
  const custName = snap?.business_name || invoice.customer?.business_name || snap?.full_name || invoice.customer?.full_name || '—';
  const custGstin = snap?.gstin || invoice.customer?.gstin || '';

  // --- Sheet 1: Bill (label / value pairs) ---
  const kv = (label: string, value: Cell): Cell[] => [txt(label, true), value];
  const billRows: Cell[][] = [
    [txt(isKite ? 'Tax Invoice' : 'Bill of Supply', true), txt('')],
    kv('Invoice #', txt(invoice.invoice_number ?? '(draft)')),
    kv('Date', txt(fmtDate(invoice.invoice_date))),
    kv('Business line', txt(isKite ? 'Kite (GST)' : 'Rakhi (no GST)')),
    kv('Status', txt(invoice.status)),
    kv('Customer', txt(custName)),
    ...(isKite ? [kv('GSTIN', txt(custGstin)), kv('Place of supply', txt(invoice.place_of_supply ?? ''))] : []),
    [txt(''), txt('')],
    kv('Subtotal', num(invoice.subtotal)),
    kv('Discount', num(invoice.discount_total)),
    kv('Taxable', num(invoice.taxable_total)),
    ...(isKite
      ? [kv('CGST', num(invoice.cgst_total)), kv('SGST', num(invoice.sgst_total)), kv('IGST', num(invoice.igst_total))]
      : []),
    kv('Packing', num(invoice.packing_charges)),
    kv('Delivery', num(invoice.delivery_charges)),
    kv('Round off', num(invoice.round_off)),
    [txt('Grand total', true), num(invoice.grand_total, true)],
  ];

  // --- Sheet 2: Items ---
  const itemHeaderBase = ['#', 'Description', 'HSN', 'Qty', 'Unit', 'Rate', 'Disc %'];
  const itemHeader = (isKite
    ? [...itemHeaderBase, 'GST %', 'Subtotal', 'CGST', 'SGST', 'IGST', 'Total']
    : [...itemHeaderBase, 'Subtotal', 'Total']
  ).map((h) => txt(h, true));

  const itemRows = lines.map((l) => {
    const base: Cell[] = [
      txt(String(l.line_no)),
      txt(l.description),
      txt(l.hsn_code ?? ''),
      num(l.qty),
      txt(l.uom),
      num(l.rate),
      num(l.discount_pct),
    ];
    return isKite
      ? [...base, num(l.gst_pct), num(l.line_subtotal), num(l.line_cgst), num(l.line_sgst), num(l.line_igst), num(l.line_total)]
      : [...base, num(l.line_subtotal), num(l.line_total)];
  });

  const sheets: Sheet[] = [
    { name: 'Bill', colWidths: [18, 28], rows: billRows },
    {
      name: 'Items',
      colWidths: isKite ? [5, 34, 10, 8, 8, 10, 8, 8, 12, 10, 10, 10, 12] : [5, 40, 10, 8, 8, 10, 8, 12, 12],
      rows: [itemHeader, ...itemRows],
    },
  ];

  const wb = buildWorkbook(sheets);
  const safe = (invoice.invoice_number ?? 'draft').replace(/[\\/*?:[\]"<>|]/g, '-');
  return new NextResponse(new Uint8Array(wb), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="bill_${safe}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
