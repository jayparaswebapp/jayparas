import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { getServerLocale } from '@/lib/format/locale';
import { PageHeader } from '@/components/page-header';
import {
  ReturnForm,
  type InvoiceLineOption,
  type InvoiceOption,
  type ReturnFormValues,
} from '../return-form';

export const dynamic = 'force-dynamic';

interface InvoiceBalanceRow {
  invoice_id: string;
  invoice_number: string | null;
  invoice_date: string;
  business_line: 'rakhi' | 'kite';
  grand_total: number;
  balance_due: number;
  customer_id: string;
}

interface CustomerLite {
  id: string;
  full_name: string;
  business_name: string | null;
}

interface InvoiceLineRow {
  id: string;
  invoice_id: string;
  line_no: number;
  sku_id: string | null;
  sku_snapshot: InvoiceLineOption['sku_snapshot'];
  description: string;
  hsn_code: string | null;
  qty: number;
  uom: string;
  rate: number;
  discount_pct: number;
  gst_pct: number;
}

interface ReturnedRow {
  invoice_line_id: string;
  qty: number;
  sales_return: { status: 'draft' | 'issued' | 'cancelled' } | null;
}

export default async function NewReturnPage({
  searchParams,
}: {
  searchParams: { invoice?: string };
}) {
  await requireRole(['super_admin', 'supervisor']);
  const locale = getServerLocale();
  const supabase = createClient();

  const [{ data: balances }, { data: customers }, { data: company }] = await Promise.all([
    supabase
      .from('invoice_balances')
      .select(
        'invoice_id, invoice_number, invoice_date, business_line, grand_total, balance_due, customer_id',
      )
      .gt('balance_due', 0)
      .order('invoice_date', { ascending: false }),
    supabase
      .from('billing_customers')
      .select('id, full_name, business_name')
      .is('deleted_at', null),
    supabase.from('company_info').select('state').maybeSingle(),
  ]);

  const customerById = new Map<string, CustomerLite>();
  for (const c of (customers ?? []) as CustomerLite[]) customerById.set(c.id, c);

  const invoices: InvoiceOption[] = ((balances ?? []) as unknown as InvoiceBalanceRow[]).map(
    (b) => {
      const c = customerById.get(b.customer_id);
      const customerLabel = c
        ? c.business_name
          ? `${c.business_name} (${c.full_name})`
          : c.full_name
        : '—';
      return {
        id: b.invoice_id,
        invoice_number: b.invoice_number,
        invoice_date: b.invoice_date,
        business_line: b.business_line,
        grand_total: Number(b.grand_total),
        balance_due: Number(b.balance_due),
        customer_label: customerLabel,
      };
    },
  );

  // Pre-fetch lines for every eligible invoice + already-returned qty per line
  // so the form doesn't need to round-trip when the user picks one. For a
  // wholesale shop with at most a few hundred outstanding invoices this is
  // cheap, and it avoids a client-side fetch dance.
  const invoiceIds = invoices.map((i) => i.id);
  let invoiceLines: InvoiceLineRow[] = [];
  let returnedRows: ReturnedRow[] = [];
  if (invoiceIds.length > 0) {
    const [{ data: ls }, { data: rs }] = await Promise.all([
      supabase
        .from('invoice_lines')
        .select(
          'id, invoice_id, line_no, sku_id, sku_snapshot, description, hsn_code, qty, uom, rate, discount_pct, gst_pct',
        )
        .in('invoice_id', invoiceIds)
        .order('invoice_id', { ascending: true })
        .order('line_no', { ascending: true }),
      supabase
        .from('sales_return_lines')
        .select('invoice_line_id, qty, sales_return:sales_returns(status)')
        .in(
          'sales_return_id',
          (
            await supabase
              .from('sales_returns')
              .select('id')
              .eq('status', 'issued')
              .is('deleted_at', null)
              .in('invoice_id', invoiceIds)
          ).data?.map((r) => r.id as string) ?? [],
        ),
    ]);
    invoiceLines = (ls ?? []) as unknown as InvoiceLineRow[];
    returnedRows = (rs ?? []) as unknown as ReturnedRow[];
  }

  const returnedByLineId = new Map<string, number>();
  for (const r of returnedRows) {
    if (!r.invoice_line_id) continue;
    if (r.sales_return && r.sales_return.status !== 'issued') continue;
    returnedByLineId.set(
      r.invoice_line_id,
      (returnedByLineId.get(r.invoice_line_id) ?? 0) + Number(r.qty),
    );
  }

  const linesByInvoice: Record<string, InvoiceLineOption[]> = {};
  for (const l of invoiceLines) {
    const arr = linesByInvoice[l.invoice_id] ?? [];
    arr.push({
      id: l.id,
      invoice_id: l.invoice_id,
      line_no: l.line_no,
      sku_id: l.sku_id,
      sku_snapshot: l.sku_snapshot,
      description: l.description,
      hsn_code: l.hsn_code,
      qty: Number(l.qty),
      uom: l.uom,
      rate: Number(l.rate),
      discount_pct: Number(l.discount_pct),
      gst_pct: Number(l.gst_pct),
      already_returned: returnedByLineId.get(l.id) ?? 0,
    });
    linesByInvoice[l.invoice_id] = arr;
  }

  const preselect = searchParams.invoice ?? null;
  const initial: ReturnFormValues = {
    invoice_id: preselect && invoices.find((i) => i.id === preselect) ? preselect : null,
    return_date: new Date().toISOString().slice(0, 10),
    reason: '',
    notes: '',
    lines: [],
  };

  return (
    <NewView
      initial={initial}
      invoices={invoices}
      linesByInvoice={linesByInvoice}
      sellerState={company?.state ?? null}
      locale={locale}
    />
  );
}

function NewView({
  initial,
  invoices,
  linesByInvoice,
  sellerState,
  locale,
}: {
  initial: ReturnFormValues;
  invoices: InvoiceOption[];
  linesByInvoice: Record<string, InvoiceLineOption[]>;
  sellerState: string | null;
  locale: 'en' | 'gu';
}) {
  const t = useTranslations('billing.returns.form');
  return (
    <>
      <PageHeader title={t('createTitle')} />
      <ReturnForm
        initial={initial}
        invoices={invoices}
        linesByInvoice={linesByInvoice}
        sellerState={sellerState}
        locale={locale}
      />
    </>
  );
}
