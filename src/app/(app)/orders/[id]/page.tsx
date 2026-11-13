import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { getServerLocale, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader } from '@/components/page-header';
import type { KitePricing } from '@/lib/billing/kite-pricing';
import type { CustomerOption, SkuOption } from '@/app/(app)/billing/invoices/invoice-form';
import { loadOrderFormData, ORDER_ROLES, type OrderStatus } from '@/lib/orders/load';
import { OrderForm, type OrderFormValues } from '../order-form';
import { OrderStatusBadge } from '../status-badge';
import { CancelOrderButton } from './cancel-order-button';
import { PackingPanel } from './packing-panel';

export const dynamic = 'force-dynamic';

interface OrderRow {
  id: string;
  order_number: string;
  business_line: 'rakhi' | 'kite';
  customer_id: string;
  status: OrderStatus;
  notes: string | null;
  estimated_total: number;
  created_at: string;
  customer: { full_name: string; business_name: string | null; city: string | null } | null;
  creator: { full_name: string } | null;
}

interface LineRow {
  id: string;
  line_no: number;
  sku_id: string | null;
  sku_snapshot: {
    sku_code?: string;
    design_name?: string;
    pack_size?: number;
    is_discountable?: boolean;
  } | null;
  description: string;
  hsn_code: string;
  uom: string;
  rate: number;
  discount_pct: number;
  gst_pct: number;
  qty_ordered: number;
  qty_packed: number;
  qty_billed: number;
}

interface BillRow {
  invoice: { id: string; invoice_number: string | null; status: string } | null;
}

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { edit?: string };
}) {
  await requireRole(ORDER_ROLES);
  const locale = getServerLocale();
  const supabase = createClient();

  const { data: o } = await supabase
    .from('orders')
    .select(
      'id, order_number, business_line, customer_id, status, notes, estimated_total, created_at, customer:billing_customers(full_name, business_name, city), creator:app_users(full_name)',
    )
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!o) notFound();
  const order = o as unknown as OrderRow;

  const [{ data: ls }, { data: bs }] = await Promise.all([
    supabase
      .from('order_lines')
      .select(
        'id, line_no, sku_id, sku_snapshot, description, hsn_code, uom, rate, discount_pct, gst_pct, qty_ordered, qty_packed, qty_billed',
      )
      .eq('order_id', order.id)
      .order('line_no', { ascending: true }),
    supabase
      .from('order_invoices')
      .select('invoice:invoices(id, invoice_number, status)')
      .eq('order_id', order.id),
  ]);
  const lines = (ls ?? []) as unknown as LineRow[];
  const bills = ((bs ?? []) as unknown as BillRow[]).flatMap((b) => (b.invoice ? [b.invoice] : []));

  // Edit mode: only while the order is still New.
  if (searchParams.edit === '1' && order.status === 'new') {
    const data = await loadOrderFormData(supabase);
    const initial: OrderFormValues = {
      id: order.id,
      business_line: order.business_line,
      customer_id: order.customer_id,
      notes: order.notes ?? '',
      lines: lines
        .filter((l) => l.sku_id)
        .map((l) => ({
          sku_id: l.sku_id as string,
          sku_code: l.sku_snapshot?.sku_code ?? '',
          design_name: l.sku_snapshot?.design_name ?? l.description,
          pack_size: l.sku_snapshot?.pack_size ?? 1,
          is_discountable: Boolean(l.sku_snapshot?.is_discountable),
          uom: l.uom,
          // Prices stay as they were when the order was taken.
          rate: Number(l.rate),
          discount_pct: Number(l.discount_pct),
          hsn_code: l.hsn_code,
          gst_pct: Number(l.gst_pct),
          qty: String(Number(l.qty_ordered)),
        })),
    };
    return (
      <EditView orderNumber={order.order_number} initial={initial} {...data} locale={locale} />
    );
  }

  return <DetailView order={order} lines={lines} bills={bills} locale={locale} />;
}

function EditView({
  orderNumber,
  initial,
  customers,
  skus,
  kitePricing,
  locale,
}: {
  orderNumber: string;
  initial: OrderFormValues;
  customers: CustomerOption[];
  skus: SkuOption[];
  kitePricing: KitePricing;
  locale: Locale;
}) {
  const t = useTranslations('orders.form');
  return (
    <>
      <PageHeader title={`${t('editTitle')} · ${orderNumber}`} />
      <OrderForm
        initial={initial}
        customers={customers}
        skus={skus}
        kitePricing={kitePricing}
        locale={locale}
      />
    </>
  );
}

function DetailView({
  order,
  lines,
  bills,
  locale,
}: {
  order: OrderRow;
  lines: LineRow[];
  bills: Array<{ id: string; invoice_number: string | null; status: string }>;
  locale: Locale;
}) {
  const t = useTranslations('orders');
  const tD = useTranslations('orders.detail');
  const kite = order.business_line === 'kite';
  const party = order.customer
    ? order.customer.business_name
      ? `${order.customer.business_name} — ${order.customer.full_name}`
      : order.customer.full_name
    : '—';
  const canEdit = order.status === 'new';
  // Packing is open until the order is fully billed or cancelled.
  const canPack = ['new', 'packing', 'ready', 'partial'].includes(order.status);
  const showPacked = ['packing', 'ready'].includes(order.status);
  const canCancel =
    ['new', 'packing', 'ready'].includes(order.status) &&
    lines.every((l) => Number(l.qty_billed) === 0);

  return (
    <>
      <PageHeader
        title={order.order_number}
        subtitle={party + (order.customer?.city ? ` · ${order.customer.city}` : '')}
        action={
          canEdit ? (
            <Link href={`/orders/${order.id}?edit=1`} className="btn-primary !w-auto px-4">
              {tD('edit')}
            </Link>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-sm">
        <OrderStatusBadge status={order.status} />
        <span className="text-neutral-500">·</span>
        <span>{kite ? t('form.kite') : t('form.rakhi')}</span>
        <span className="text-neutral-500">·</span>
        <span className="text-neutral-600">
          {new Date(order.created_at).toLocaleString(locale === 'gu' ? 'gu-IN' : 'en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
          {order.creator ? ` · ${order.creator.full_name}` : ''}
        </span>
      </div>

      {order.status === 'ready' ? (
        <div className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
          {tD('readyBanner')}
        </div>
      ) : null}

      {canPack ? (
        <PackingPanel
          orderId={order.id}
          lines={lines.map((l) => ({
            id: l.id,
            description: l.description,
            uom: l.uom,
            qty_ordered: Number(l.qty_ordered),
            qty_billed: Number(l.qty_billed),
            qty_packed: Number(l.qty_packed),
          }))}
        />
      ) : null}

      <div className="mb-4 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">{tD('item')}</th>
              <th className="px-3 py-2 text-right">{tD('rate')}</th>
              <th className="px-3 py-2 text-right">{tD('disc')}</th>
              {kite ? <th className="px-3 py-2 text-right">GST</th> : null}
              <th className="px-3 py-2 text-right">{tD('ordered')}</th>
              {showPacked ? <th className="px-3 py-2 text-right">{tD('packed')}</th> : null}
              <th className="px-3 py-2 text-right">{tD('billed')}</th>
              <th className="px-3 py-2 text-right">{tD('pending')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const pending = Number(l.qty_ordered) - Number(l.qty_billed);
              return (
                <tr key={l.id} className="border-t border-neutral-100">
                  <td className="px-3 py-2 text-neutral-500">{l.line_no}</td>
                  <td className="px-3 py-2">{l.description}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatRupees(Number(l.rate), locale)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(l.discount_pct)}%</td>
                  {kite ? (
                    <td className="px-3 py-2 text-right tabular-nums">{Number(l.gst_pct)}%</td>
                  ) : null}
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(l.qty_ordered)} {l.uom}
                  </td>
                  {showPacked ? (
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-emerald-700">
                      {Number(l.qty_packed)}
                    </td>
                  ) : null}
                  <td className="px-3 py-2 text-right tabular-nums">{Number(l.qty_billed)}</td>
                  <td
                    className={`px-3 py-2 text-right font-medium tabular-nums ${
                      pending > 0 && order.status !== 'cancelled'
                        ? 'text-amber-700'
                        : 'text-neutral-400'
                    }`}
                  >
                    {pending}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mb-4 flex items-baseline justify-between rounded-lg border border-neutral-200 bg-white p-4">
        <span className="text-sm font-medium text-neutral-700">{t('form.estimatedTotal')}</span>
        <span className="text-xl font-semibold tabular-nums text-neutral-900">
          {formatRupees(Number(order.estimated_total), locale)}
        </span>
      </div>

      {order.notes ? (
        <div className="mb-4 rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-700">
          <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
            {t('form.notes')}
          </div>
          {order.notes}
        </div>
      ) : null}

      {bills.length > 0 ? (
        <div className="mb-4 rounded-lg border border-neutral-200 bg-white p-4 text-sm">
          <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">{tD('bills')}</div>
          <ul className="space-y-1">
            {bills.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/billing/invoices/${b.id}`}
                  className="text-brand-800 font-mono underline"
                >
                  {b.invoice_number ?? b.id.slice(0, 8)}
                </Link>{' '}
                <span className="text-neutral-500">({b.status})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canCancel ? <CancelOrderButton id={order.id} /> : null}
    </>
  );
}
