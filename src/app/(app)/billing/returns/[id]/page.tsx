import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader } from '@/components/page-header';
import {
  ReturnForm,
  type InvoiceLineOption,
  type InvoiceOption,
  type ReturnFormValues,
} from '../return-form';
import { ReturnActions } from './return-actions';

export const dynamic = 'force-dynamic';

interface ReturnRow {
  id: string;
  credit_note_number: string | null;
  business_line: 'rakhi' | 'kite';
  status: 'draft' | 'issued' | 'cancelled';
  return_date: string;
  invoice_id: string;
  customer_id: string | null;
  reason: string | null;
  notes: string | null;
  place_of_supply: string | null;
  intra_state: boolean | null;
  subtotal: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  round_off: number;
  grand_total: number;
  issued_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  customer_snapshot: Record<string, string | null> | null;
  seller_snapshot: Record<string, string | null> | null;
}

interface ReturnLineRow {
  id: string;
  line_no: number;
  invoice_line_id: string | null;
  sku_id: string | null;
  sku_snapshot: InvoiceLineOption['sku_snapshot'];
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

interface InvoiceLite {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  business_line: 'rakhi' | 'kite';
  grand_total: number;
}

export default async function ReturnDetailPage({ params }: { params: { id: string } }) {
  const user = await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const { data: ret } = await supabase
    .from('sales_returns')
    .select(
      'id, credit_note_number, business_line, status, return_date, invoice_id, customer_id, reason, notes, place_of_supply, intra_state, subtotal, cgst_total, sgst_total, igst_total, round_off, grand_total, issued_at, cancelled_at, cancellation_reason, customer_snapshot, seller_snapshot',
    )
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!ret) notFound();
  const r = ret as unknown as ReturnRow;

  const { data: ls } = await supabase
    .from('sales_return_lines')
    .select(
      'id, line_no, invoice_line_id, sku_id, sku_snapshot, description, hsn_code, qty, uom, rate, discount_pct, gst_pct, line_subtotal, line_cgst, line_sgst, line_igst, line_total',
    )
    .eq('sales_return_id', params.id)
    .order('line_no', { ascending: true });
  const lines = (ls ?? []) as unknown as ReturnLineRow[];

  const canWrite = user.role === 'super_admin' || user.role === 'supervisor';

  if (r.status === 'draft' && canWrite) {
    // Re-fetch invoice + its lines + already-returned per line, exactly like
    // the /new page does, but scoped to this one invoice so the editor can
    // hydrate from the saved draft.
    const [{ data: inv }, { data: invLines }, { data: otherReturns }] = await Promise.all([
      supabase
        .from('invoice_balances')
        .select(
          'invoice_id, invoice_number, invoice_date, business_line, grand_total, balance_due, customer_id',
        )
        .eq('invoice_id', r.invoice_id)
        .maybeSingle(),
      supabase
        .from('invoice_lines')
        .select(
          'id, invoice_id, line_no, sku_id, sku_snapshot, description, hsn_code, qty, uom, rate, discount_pct, gst_pct',
        )
        .eq('invoice_id', r.invoice_id)
        .order('line_no', { ascending: true }),
      supabase
        .from('sales_return_lines')
        .select('invoice_line_id, qty, sales_return:sales_returns(id, status)')
        .not('invoice_line_id', 'is', null),
    ]);

    const returnedByLineId = new Map<string, number>();
    for (const row of (otherReturns ?? []) as unknown as Array<{
      invoice_line_id: string | null;
      qty: number;
      sales_return: { id: string; status: string } | null;
    }>) {
      if (!row.invoice_line_id || !row.sales_return) continue;
      if (row.sales_return.id === params.id) continue;
      if (row.sales_return.status !== 'issued') continue;
      returnedByLineId.set(
        row.invoice_line_id,
        (returnedByLineId.get(row.invoice_line_id) ?? 0) + Number(row.qty),
      );
    }

    const { data: cust } = inv
      ? await supabase
          .from('billing_customers')
          .select('id, full_name, business_name')
          .eq('id', (inv as { customer_id: string }).customer_id)
          .maybeSingle()
      : { data: null };
    const customerLabel = cust
      ? cust.business_name
        ? `${cust.business_name} (${cust.full_name})`
        : cust.full_name
      : '—';

    const invoiceOption: InvoiceOption | null = inv
      ? {
          id: (inv as { invoice_id: string }).invoice_id,
          invoice_number: (inv as { invoice_number: string | null }).invoice_number,
          invoice_date: (inv as { invoice_date: string }).invoice_date,
          business_line: (inv as { business_line: 'rakhi' | 'kite' }).business_line,
          grand_total: Number((inv as { grand_total: number }).grand_total),
          balance_due: Number((inv as { balance_due: number }).balance_due),
          customer_label: customerLabel,
        }
      : null;

    const linesByInvoice: Record<string, InvoiceLineOption[]> = {};
    if (invoiceOption) {
      linesByInvoice[invoiceOption.id] = (
        (invLines ?? []) as Array<{
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
        }>
      ).map((l) => ({
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
      }));
    }

    const { data: company } = await supabase.from('company_info').select('state').maybeSingle();

    const initial: ReturnFormValues = {
      id: r.id,
      invoice_id: r.invoice_id,
      return_date: r.return_date,
      reason: r.reason ?? '',
      notes: r.notes ?? '',
      lines: lines.map((l) => ({
        invoice_line_id: l.invoice_line_id,
        qty: String(l.qty),
      })),
    };

    return (
      <DraftView
        initial={initial}
        invoices={invoiceOption ? [invoiceOption] : []}
        linesByInvoice={linesByInvoice}
        sellerState={(company as { state: string | null } | null)?.state ?? null}
        locale={locale}
        returnId={r.id}
      />
    );
  }

  const { data: invRow } = await supabase
    .from('invoices')
    .select('id, invoice_number, invoice_date, business_line, grand_total')
    .eq('id', r.invoice_id)
    .maybeSingle();
  const invoice = invRow as unknown as InvoiceLite | null;

  return (
    <ReadonlyView ret={r} lines={lines} invoice={invoice} canWrite={canWrite} locale={locale} />
  );
}

function DraftView({
  initial,
  invoices,
  linesByInvoice,
  sellerState,
  locale,
  returnId,
}: {
  initial: ReturnFormValues;
  invoices: InvoiceOption[];
  linesByInvoice: Record<string, InvoiceLineOption[]>;
  sellerState: string | null;
  locale: Locale;
  returnId: string;
}) {
  const t = useTranslations('billing.returns.form');
  return (
    <>
      <PageHeader title={t('editTitle')} action={<ReturnActions id={returnId} status="draft" />} />
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

function ReadonlyView({
  ret,
  lines,
  invoice,
  canWrite,
  locale,
}: {
  ret: ReturnRow;
  lines: ReturnLineRow[];
  invoice: InvoiceLite | null;
  canWrite: boolean;
  locale: Locale;
}) {
  const t = useTranslations('billing.returns');
  const tDet = useTranslations('billing.returns.detail');
  const tInv = useTranslations('billing.invoices');
  const tForm = useTranslations('billing.invoices.form');
  const isTax = ret.business_line === 'kite';
  const statusLabel =
    ret.status === 'cancelled'
      ? tInv('statusCancelled')
      : ret.status === 'draft'
        ? tInv('statusDraft')
        : tInv('statusIssued');

  return (
    <>
      <PageHeader
        title={tDet('title')}
        subtitle={statusLabel}
        action={
          <div className="flex items-center gap-2">
            {ret.status !== 'draft' ? (
              <Link href={`/billing/returns/${ret.id}/print`} className="btn-primary !w-auto px-4">
                {tDet('printButton')}
              </Link>
            ) : null}
            {canWrite ? <ReturnActions id={ret.id} status={ret.status} /> : null}
          </div>
        }
      />

      <div className="mb-4 rounded-lg border border-neutral-200 bg-white p-3 text-sm text-neutral-700">
        <span className="text-neutral-500">{tDet('numberLabel')}: </span>
        <span className="font-mono text-base font-bold text-neutral-900">
          {ret.credit_note_number ?? tInv('draftLabel')}
        </span>
        {invoice ? (
          <span className="ml-3">
            <span className="text-neutral-500">{t('againstInvoiceLabel')}: </span>
            <Link
              href={`/billing/invoices/${invoice.id}`}
              className="font-mono text-brand-700 hover:underline"
            >
              {invoice.invoice_number ?? '—'}
            </Link>
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Snapshot title={tDet('from')} snap={ret.seller_snapshot} />
        <Snapshot title={tDet('billedTo')} snap={ret.customer_snapshot} />
      </div>

      <div className="my-4 rounded-md border border-neutral-200 bg-white p-3 text-sm text-neutral-700">
        <div>
          {tDet('placeOfSupply')}: <strong>{ret.place_of_supply ?? '—'}</strong>{' '}
          {ret.intra_state === true ? `(${tInv('docTaxInvoice')})` : null}
        </div>
        {ret.reason ? (
          <div className="mt-1">
            <span className="text-neutral-500">{tDet('reasonLabel')}: </span>
            {ret.reason}
          </div>
        ) : null}
      </div>

      <div className="mb-4 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">{tForm('descriptionLabel')}</th>
              {isTax ? <th className="px-3 py-2">{tForm('hsnLabel')}</th> : null}
              <th className="px-3 py-2 text-right">{tForm('qtyLabel')}</th>
              <th className="px-3 py-2 text-right">{tForm('rateLabel')}</th>
              <th className="px-3 py-2 text-right">{tForm('discountLabel')}</th>
              {isTax ? <th className="px-3 py-2 text-right">{tForm('gstLabel')}</th> : null}
              <th className="px-3 py-2 text-right">{tForm('lineTotalLabel')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-neutral-200">
                <td className="px-3 py-2">{l.line_no}</td>
                <td className="px-3 py-2">{l.description}</td>
                {isTax ? (
                  <td className="px-3 py-2 font-mono text-xs">{l.hsn_code ?? '—'}</td>
                ) : null}
                <td className="px-3 py-2 text-right">{Number(l.qty)}</td>
                <td className="px-3 py-2 text-right">{formatRupees(Number(l.rate), locale)}</td>
                <td className="px-3 py-2 text-right">{Number(l.discount_pct)}%</td>
                {isTax ? <td className="px-3 py-2 text-right">{Number(l.gst_pct)}%</td> : null}
                <td className="px-3 py-2 text-right font-medium">
                  {formatRupees(Number(l.line_total), locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ml-auto max-w-sm rounded-lg border border-neutral-200 bg-white p-4">
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-neutral-600">{tForm('subtotalLabel')}</dt>
          <dd className="text-right">{formatRupees(Number(ret.subtotal), locale)}</dd>
          {Number(ret.cgst_total) > 0 ? (
            <>
              <dt className="text-neutral-600">{tForm('cgstLabel')}</dt>
              <dd className="text-right">{formatRupees(Number(ret.cgst_total), locale)}</dd>
              <dt className="text-neutral-600">{tForm('sgstLabel')}</dt>
              <dd className="text-right">{formatRupees(Number(ret.sgst_total), locale)}</dd>
            </>
          ) : null}
          {Number(ret.igst_total) > 0 ? (
            <>
              <dt className="text-neutral-600">{tForm('igstLabel')}</dt>
              <dd className="text-right">{formatRupees(Number(ret.igst_total), locale)}</dd>
            </>
          ) : null}
          {Number(ret.round_off) !== 0 ? (
            <>
              <dt className="text-neutral-600">{tForm('roundOffLabel')}</dt>
              <dd className="text-right">
                {Number(ret.round_off) > 0 ? '+ ' : '− '}
                {formatRupees(Math.abs(Number(ret.round_off)), locale)}
              </dd>
            </>
          ) : null}
          <dt className="border-t border-neutral-200 pt-1 text-base font-semibold">
            {tForm('grandTotalLabel')}
          </dt>
          <dd className="border-t border-neutral-200 pt-1 text-right text-base font-semibold">
            {formatRupees(Number(ret.grand_total), locale)}
          </dd>
        </dl>
      </div>

      {ret.notes ? (
        <div className="mt-4 rounded-md border border-neutral-200 bg-white p-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            {tDet('notesLabel')}
          </div>
          <div className="mt-1 whitespace-pre-wrap text-neutral-800">{ret.notes}</div>
        </div>
      ) : null}

      {ret.status === 'cancelled' && ret.cancellation_reason ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span className="font-semibold">{tDet('cancelReasonLabel')}: </span>
          {ret.cancellation_reason}
        </div>
      ) : null}
    </>
  );
}

function Snapshot({ title, snap }: { title: string; snap: Record<string, string | null> | null }) {
  if (!snap) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
        {title}: —
      </div>
    );
  }
  const lineParts = [
    snap.legal_name ?? snap.business_name ?? snap.full_name,
    snap.address_line1,
    snap.address_line2,
    [snap.city, snap.state, snap.pincode].filter(Boolean).join(', '),
    snap.mobile,
    snap.email,
    snap.gstin ? `GSTIN: ${snap.gstin}` : null,
  ].filter(Boolean);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
      <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">{title}</div>
      <div className="space-y-0.5 text-neutral-900">
        {lineParts.map((p, i) => (
          <div key={i}>{p}</div>
        ))}
      </div>
    </div>
  );
}
