import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader } from '@/components/page-header';
import { BillForm, type BillFormValues, type ItemOption, type SupplierOption } from '../bill-form';
import { BillActions } from './bill-actions';

export const dynamic = 'force-dynamic';

interface BillRow {
  id: string;
  bill_number: string | null;
  supplier_bill_number: string | null;
  business_line: 'rakhi' | 'kite';
  status: 'draft' | 'issued' | 'cancelled';
  bill_date: string;
  supplier_id: string | null;
  place_of_supply: string | null;
  intra_state: boolean | null;
  notes: string | null;
  subtotal: number;
  discount_total: number;
  cgst_total: number;
  sgst_total: number;
  igst_total: number;
  round_off: number;
  grand_total: number;
  posted_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  supplier_snapshot: Record<string, string | null> | null;
  buyer_snapshot: Record<string, string | null> | null;
}

interface LineRow {
  id: string;
  line_no: number;
  item_id: string | null;
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
  item_snapshot: { item_code?: string; name?: string; uom?: string } | null;
}

export default async function BillDetailPage({ params }: { params: { id: string } }) {
  const user = await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const { data: bill } = await supabase
    .from('purchase_bills')
    .select(
      'id, bill_number, supplier_bill_number, business_line, status, bill_date, supplier_id, place_of_supply, intra_state, notes, subtotal, discount_total, cgst_total, sgst_total, igst_total, round_off, grand_total, posted_at, cancelled_at, created_at, supplier_snapshot, buyer_snapshot',
    )
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!bill) notFound();
  const b = bill as unknown as BillRow;

  const { data: ls } = await supabase
    .from('purchase_bill_lines')
    .select(
      'id, line_no, item_id, description, hsn_code, qty, uom, rate, discount_pct, gst_pct, line_subtotal, line_cgst, line_sgst, line_igst, line_total, item_snapshot',
    )
    .eq('bill_id', params.id)
    .order('line_no', { ascending: true });
  const lines = (ls ?? []) as unknown as LineRow[];

  const canWrite = user.role === 'super_admin' || user.role === 'supervisor';

  if (b.status === 'draft' && canWrite) {
    const [{ data: ss }, { data: its }, { data: company }] = await Promise.all([
      supabase
        .from('suppliers')
        .select('id, full_name, business_name, state')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('full_name', { ascending: true }),
      supabase
        .from('purchase_items')
        .select('id, item_code, name, uom, hsn_code, default_rate, default_gst_pct')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('item_code', { ascending: true }),
      supabase.from('company_info').select('state').maybeSingle(),
    ]);

    const suppliers: SupplierOption[] = (ss ?? []).map((s) => {
      const base = s.business_name ? `${s.business_name} — ${s.full_name}` : s.full_name;
      return { id: s.id, label: base, state: s.state };
    });
    const items: ItemOption[] = (its ?? []).map((it) => ({
      id: it.id,
      item_code: it.item_code,
      name: it.name,
      uom: it.uom,
      hsn_code: it.hsn_code,
      default_rate: Number(it.default_rate),
      default_gst_pct: Number(it.default_gst_pct),
    }));

    const initial: BillFormValues = {
      id: b.id,
      business_line: b.business_line,
      supplier_id: b.supplier_id,
      supplier_bill_number: b.supplier_bill_number ?? '',
      bill_date: b.bill_date,
      place_of_supply: b.place_of_supply ?? '',
      notes: b.notes ?? '',
      lines: lines.map((l) => ({
        item_id: l.item_id,
        item_snapshot: l.item_snapshot
          ? {
              item_code: l.item_snapshot.item_code ?? '',
              name: l.item_snapshot.name ?? '',
              uom: l.item_snapshot.uom ?? '',
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
        suppliers={suppliers}
        items={items}
        buyerState={company?.state ?? null}
        locale={locale}
        billId={b.id}
      />
    );
  }

  return <ReadonlyView bill={b} lines={lines} locale={locale} canWrite={canWrite} />;
}

function DraftView({
  initial,
  suppliers,
  items,
  buyerState,
  locale,
  billId,
}: {
  initial: BillFormValues;
  suppliers: SupplierOption[];
  items: ItemOption[];
  buyerState: string | null;
  locale: Locale;
  billId: string;
}) {
  const t = useTranslations('purchases.bills.form');
  return (
    <>
      <PageHeader title={t('editTitle')} action={<BillActions id={billId} status="draft" />} />
      <BillForm
        initial={initial}
        suppliers={suppliers}
        items={items}
        buyerState={buyerState}
        locale={locale}
      />
    </>
  );
}

function ReadonlyView({
  bill,
  lines,
  locale,
  canWrite,
}: {
  bill: BillRow;
  lines: LineRow[];
  locale: Locale;
  canWrite: boolean;
}) {
  const t = useTranslations('purchases.bills');
  const tDet = useTranslations('purchases.bills.detail');
  const tForm = useTranslations('purchases.bills.form');
  const tStatus = bill.status === 'cancelled' ? t('statusCancelled') : t('statusPosted');

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={tStatus}
        action={canWrite ? <BillActions id={bill.id} status={bill.status} /> : null}
      />

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-sm sm:grid-cols-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            {tDet('ourBillNumber')}
          </div>
          <div className="font-mono text-base font-bold text-neutral-900">
            {bill.bill_number ?? t('draftLabel')}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            {tDet('supplierBillNumber')}
          </div>
          <div className="font-mono text-neutral-900">{bill.supplier_bill_number ?? '—'}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            {tDet('placeOfSupply')}
          </div>
          <div className="text-neutral-900">
            {bill.place_of_supply ?? '—'}{' '}
            {bill.intra_state === true
              ? `(${tDet('intraState')})`
              : bill.intra_state === false
                ? `(${tDet('interState')})`
                : ''}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Snapshot title={tDet('supplier')} snap={bill.supplier_snapshot} />
        <Snapshot title={tDet('buyer')} snap={bill.buyer_snapshot} />
      </div>

      <div className="my-4 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">{tForm('descriptionLabel')}</th>
              {bill.business_line === 'kite' ? (
                <th className="px-3 py-2">{tForm('hsnLabel')}</th>
              ) : null}
              <th className="px-3 py-2 text-right">{tForm('qtyLabel')}</th>
              <th className="px-3 py-2 text-right">{tForm('rateLabel')}</th>
              <th className="px-3 py-2 text-right">{tForm('discountLabel')}</th>
              {bill.business_line === 'kite' ? (
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
                {bill.business_line === 'kite' ? (
                  <td className="px-3 py-2 font-mono text-xs">{l.hsn_code ?? '—'}</td>
                ) : null}
                <td className="px-3 py-2 text-right">
                  {Number(l.qty)} {l.uom}
                </td>
                <td className="px-3 py-2 text-right">{formatRupees(Number(l.rate), locale)}</td>
                <td className="px-3 py-2 text-right">{Number(l.discount_pct)}%</td>
                {bill.business_line === 'kite' ? (
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
          <dd className="text-right">{formatRupees(Number(bill.subtotal), locale)}</dd>
          {Number(bill.discount_total) > 0 ? (
            <>
              <dt className="text-neutral-600">{tForm('discountTotalLabel')}</dt>
              <dd className="text-right">− {formatRupees(Number(bill.discount_total), locale)}</dd>
            </>
          ) : null}
          {Number(bill.cgst_total) > 0 ? (
            <>
              <dt className="text-neutral-600">{tForm('cgstLabel')}</dt>
              <dd className="text-right">{formatRupees(Number(bill.cgst_total), locale)}</dd>
              <dt className="text-neutral-600">{tForm('sgstLabel')}</dt>
              <dd className="text-right">{formatRupees(Number(bill.sgst_total), locale)}</dd>
            </>
          ) : null}
          {Number(bill.igst_total) > 0 ? (
            <>
              <dt className="text-neutral-600">{tForm('igstLabel')}</dt>
              <dd className="text-right">{formatRupees(Number(bill.igst_total), locale)}</dd>
            </>
          ) : null}
          {Number(bill.round_off) !== 0 ? (
            <>
              <dt className="text-neutral-600">{tForm('roundOffLabel')}</dt>
              <dd className="text-right">
                {Number(bill.round_off) > 0 ? '+ ' : '− '}
                {formatRupees(Math.abs(Number(bill.round_off)), locale)}
              </dd>
            </>
          ) : null}
          <dt className="border-t border-neutral-200 pt-1 text-base font-semibold">
            {tForm('grandTotalLabel')}
          </dt>
          <dd className="border-t border-neutral-200 pt-1 text-right text-base font-semibold">
            {formatRupees(Number(bill.grand_total), locale)}
          </dd>
        </dl>
      </div>

      {bill.notes ? (
        <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            {tForm('notesLabel')}
          </div>
          <div className="mt-1 text-neutral-900">{bill.notes}</div>
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
