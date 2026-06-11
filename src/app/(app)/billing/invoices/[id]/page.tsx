import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader } from '@/components/page-header';
import {
  InvoiceForm,
  type CustomerOption,
  type InvoiceFormValues,
  type SkuOption,
} from '../invoice-form';
import { InvoiceActions } from './invoice-actions';

export const dynamic = 'force-dynamic';

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  business_line: 'rakhi' | 'kite';
  status: 'draft' | 'issued' | 'cancelled';
  invoice_date: string;
  due_date: string | null;
  customer_id: string | null;
  place_of_supply: string | null;
  intra_state: boolean | null;
  notes: string | null;
  terms: string | null;
  subtotal: number;
  discount_total: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  packing_charges: number;
  delivery_charges: number;
  round_off: number;
  grand_total: number;
  issued_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  customer_snapshot: Record<string, string | null> | null;
  seller_snapshot: Record<string, string | null> | null;
}

interface LineRow {
  id: string;
  line_no: number;
  sku_id: string | null;
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
  sku_snapshot: { sku_code?: string; design_name?: string; pack_size?: number } | null;
}

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const user = await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const { data: inv } = await supabase
    .from('invoices')
    .select(
      'id, invoice_number, business_line, status, invoice_date, due_date, customer_id, place_of_supply, intra_state, notes, terms, subtotal, discount_total, cgst_total, sgst_total, igst_total, packing_charges, delivery_charges, round_off, grand_total, issued_at, cancelled_at, created_at, customer_snapshot, seller_snapshot',
    )
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!inv) notFound();
  const invoice = inv as unknown as InvoiceRow;

  const { data: ls } = await supabase
    .from('invoice_lines')
    .select(
      'id, line_no, sku_id, description, hsn_code, qty, uom, rate, discount_pct, gst_pct, line_subtotal, line_cgst, line_sgst, line_igst, line_total, sku_snapshot',
    )
    .eq('invoice_id', params.id)
    .order('line_no', { ascending: true });
  const lines = (ls ?? []) as unknown as LineRow[];

  const canWrite = user.role === 'super_admin' || user.role === 'supervisor';

  if (invoice.status === 'draft' && canWrite) {
    const [{ data: cs }, { data: ss }, { data: company }] = await Promise.all([
      supabase
        .from('billing_customers')
        .select('id, full_name, business_name, city, state')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('full_name', { ascending: true }),
      supabase
        .from('skus')
        .select(
          'id, sku_code, design_name, pack_size, price, discount_pct, is_discountable, rate_unit',
        )
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('design_name', { ascending: true }),
      supabase.from('company_info').select('state').maybeSingle(),
    ]);

    const customers: CustomerOption[] = (cs ?? []).map((c) => {
      const base = c.business_name ? `${c.business_name} — ${c.full_name}` : c.full_name;
      const label = c.city ? `${base} (${c.city})` : base;
      return { id: c.id, label, city: c.city, state: c.state };
    });
    const skus: SkuOption[] = (ss ?? []).map((s) => ({
      id: s.id,
      sku_code: s.sku_code,
      design_name: s.design_name,
      pack_size: s.pack_size,
      price: Number(s.price),
      discount_pct: Number(s.discount_pct ?? 0),
      is_discountable: Boolean(s.is_discountable),
      rate_unit: (s.rate_unit === 'pack' ? 'pack' : 'piece') as 'pack' | 'piece',
    }));

    const initial: InvoiceFormValues = {
      id: invoice.id,
      business_line: invoice.business_line,
      customer_id: invoice.customer_id,
      invoice_date: invoice.invoice_date,
      place_of_supply: invoice.place_of_supply ?? '',
      notes: invoice.notes ?? '',
      terms: invoice.terms ?? '',
      packing_charges: String(invoice.packing_charges ?? 0),
      delivery_charges: String(invoice.delivery_charges ?? 0),
      lines: lines.map((l) => ({
        sku_id: l.sku_id,
        sku_snapshot: l.sku_snapshot
          ? {
              sku_code: l.sku_snapshot.sku_code ?? '',
              design_name: l.sku_snapshot.design_name ?? '',
              pack_size: l.sku_snapshot.pack_size ?? 0,
            }
          : null,
        description: l.description,
        hsn_code: l.hsn_code ?? '',
        qty: String(l.qty),
        uom: l.uom,
        rate: String(l.rate),
        discount_pct: String(l.discount_pct),
        gst_pct: String(l.gst_pct),
      })),
    };

    return (
      <DraftView
        initial={initial}
        customers={customers}
        skus={skus}
        sellerState={company?.state ?? null}
        locale={locale}
        invoiceId={invoice.id}
      />
    );
  }

  return <ReadonlyView invoice={invoice} lines={lines} locale={locale} canWrite={canWrite} />;
}

function DraftView({
  initial,
  customers,
  skus,
  sellerState,
  locale,
  invoiceId,
}: {
  initial: InvoiceFormValues;
  customers: CustomerOption[];
  skus: SkuOption[];
  sellerState: string | null;
  locale: Locale;
  invoiceId: string;
}) {
  const t = useTranslations('billing.invoices.form');
  return (
    <>
      <PageHeader
        title={t('editTitle')}
        action={<InvoiceActions id={invoiceId} status="draft" />}
      />
      <InvoiceForm
        initial={initial}
        customers={customers}
        skus={skus}
        sellerState={sellerState}
        locale={locale}
      />
    </>
  );
}

function ReadonlyView({
  invoice,
  lines,
  locale,
  canWrite,
}: {
  invoice: InvoiceRow;
  lines: LineRow[];
  locale: Locale;
  canWrite: boolean;
}) {
  const t = useTranslations('billing.invoices');
  const tDet = useTranslations('billing.invoices.detail');
  const tForm = useTranslations('billing.invoices.form');
  const tStatus = invoice.status === 'cancelled' ? t('statusCancelled') : t('statusIssued');

  const docType = invoice.business_line === 'kite' ? t('docTaxInvoice') : t('docBillOfSupply');
  return (
    <>
      <PageHeader
        title={docType}
        subtitle={tStatus}
        action={
          <div className="flex items-center gap-2">
            <Link
              href={`/billing/invoices/${invoice.id}/print`}
              className="btn-primary !w-auto px-4"
            >
              {tDet('printButton')}
            </Link>
            {canWrite ? <InvoiceActions id={invoice.id} status={invoice.status} /> : null}
          </div>
        }
      />
      <div className="mb-4 rounded-lg border border-neutral-200 bg-white p-3 text-sm text-neutral-700">
        <span className="text-neutral-500">{t('invoiceNumberLabel')}: </span>
        <span className="font-mono text-base font-bold text-neutral-900">
          {invoice.invoice_number ?? t('draftLabel')}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Snapshot title={tDet('from')} snap={invoice.seller_snapshot} />
        <Snapshot title={tDet('billedTo')} snap={invoice.customer_snapshot} />
      </div>

      <div className="my-4 rounded-md border border-neutral-200 bg-white p-3 text-sm text-neutral-700">
        <div>
          {tDet('placeOfSupply')}: <strong>{invoice.place_of_supply ?? '—'}</strong>{' '}
          {invoice.intra_state === true
            ? `(${tDet('intraState')})`
            : invoice.intra_state === false
              ? `(${tDet('interState')})`
              : null}
        </div>
      </div>

      <div className="mb-4 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">{tForm('descriptionLabel')}</th>
              {invoice.business_line === 'kite' ? (
                <th className="px-3 py-2">{tForm('hsnLabel')}</th>
              ) : null}
              <th className="px-3 py-2 text-right">{tForm('qtyLabel')}</th>
              <th className="px-3 py-2 text-right">{tForm('rateLabel')}</th>
              <th className="px-3 py-2 text-right">{tForm('discountLabel')}</th>
              {invoice.business_line === 'kite' ? (
                <th className="px-3 py-2 text-right">{tForm('gstLabel')}</th>
              ) : null}
              <th className="px-3 py-2 text-right">{tForm('lineTotalLabel')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-neutral-200">
                <td className="px-3 py-2">{l.line_no}</td>
                <td className="px-3 py-2">{l.description}</td>
                {invoice.business_line === 'kite' ? (
                  <td className="px-3 py-2 font-mono text-xs">{l.hsn_code ?? '—'}</td>
                ) : null}
                <td className="px-3 py-2 text-right">{Number(l.qty)}</td>
                <td className="px-3 py-2 text-right">{formatRupees(Number(l.rate), locale)}</td>
                <td className="px-3 py-2 text-right">{Number(l.discount_pct)}%</td>
                {invoice.business_line === 'kite' ? (
                  <td className="px-3 py-2 text-right">{Number(l.gst_pct)}%</td>
                ) : null}
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
          <dd className="text-right">{formatRupees(Number(invoice.subtotal), locale)}</dd>
          {Number(invoice.discount_total) > 0 ? (
            <>
              <dt className="text-neutral-600">{tForm('discountTotalLabel')}</dt>
              <dd className="text-right">
                − {formatRupees(Number(invoice.discount_total), locale)}
              </dd>
            </>
          ) : null}
          {Number(invoice.cgst_total) > 0 ? (
            <>
              <dt className="text-neutral-600">{tForm('cgstLabel')}</dt>
              <dd className="text-right">{formatRupees(Number(invoice.cgst_total), locale)}</dd>
              <dt className="text-neutral-600">{tForm('sgstLabel')}</dt>
              <dd className="text-right">{formatRupees(Number(invoice.sgst_total), locale)}</dd>
            </>
          ) : null}
          {Number(invoice.igst_total) > 0 ? (
            <>
              <dt className="text-neutral-600">{tForm('igstLabel')}</dt>
              <dd className="text-right">{formatRupees(Number(invoice.igst_total), locale)}</dd>
            </>
          ) : null}
          {Number(invoice.packing_charges) > 0 ? (
            <>
              <dt className="text-neutral-600">{tForm('packingChargesLabel')}</dt>
              <dd className="text-right">
                + {formatRupees(Number(invoice.packing_charges), locale)}
              </dd>
            </>
          ) : null}
          {Number(invoice.delivery_charges) > 0 ? (
            <>
              <dt className="text-neutral-600">{tForm('deliveryChargesLabel')}</dt>
              <dd className="text-right">
                + {formatRupees(Number(invoice.delivery_charges), locale)}
              </dd>
            </>
          ) : null}
          {Number(invoice.round_off) !== 0 ? (
            <>
              <dt className="text-neutral-600">{tForm('roundOffLabel')}</dt>
              <dd className="text-right">
                {Number(invoice.round_off) > 0 ? '+ ' : '− '}
                {formatRupees(Math.abs(Number(invoice.round_off)), locale)}
              </dd>
            </>
          ) : null}
          <dt className="border-t border-neutral-200 pt-1 text-base font-semibold">
            {tForm('grandTotalLabel')}
          </dt>
          <dd className="border-t border-neutral-200 pt-1 text-right text-base font-semibold">
            {formatRupees(Number(invoice.grand_total), locale)}
          </dd>
        </dl>
      </div>
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
