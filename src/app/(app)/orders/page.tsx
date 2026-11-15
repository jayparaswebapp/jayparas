import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { getServerLocale, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader } from '@/components/page-header';
import { ORDER_ROLES, type OrderStatus } from '@/lib/orders/load';
import { OrderStatusBadge } from './status-badge';

export const dynamic = 'force-dynamic';

/** 'open' = everything still needing work. */
const TABS = ['open', 'new', 'packing', 'ready', 'billed', 'cancelled'] as const;
type Tab = (typeof TABS)[number];
const OPEN: OrderStatus[] = ['new', 'packing', 'ready'];

interface Row {
  id: string;
  order_number: string;
  business_line: 'rakhi' | 'kite';
  status: OrderStatus;
  estimated_total: number;
  created_at: string;
  parent_order_id: string | null;
  customer: { full_name: string; business_name: string | null; city: string | null } | null;
}

export default async function OrdersPage({ searchParams }: { searchParams: { tab?: string } }) {
  await requireRole(ORDER_ROLES);
  const locale = getServerLocale();
  const tab: Tab = (TABS as readonly string[]).includes(searchParams.tab ?? '')
    ? (searchParams.tab as Tab)
    : 'open';

  const supabase = createClient();
  let query = supabase
    .from('orders')
    .select(
      'id, order_number, business_line, status, estimated_total, created_at, parent_order_id, customer:billing_customers(full_name, business_name, city)',
    )
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(300);
  query = tab === 'open' ? query.in('status', OPEN) : query.eq('status', tab);

  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];

  // "from ORD-xxxx" for pending orders.
  const parentIds = Array.from(
    new Set(rows.map((r) => r.parent_order_id).filter((v): v is string => !!v)),
  );
  const parentNumbers: Record<string, string> = {};
  if (parentIds.length > 0) {
    const { data: ps } = await supabase
      .from('orders')
      .select('id, order_number')
      .in('id', parentIds);
    for (const p of (ps ?? []) as { id: string; order_number: string }[]) {
      parentNumbers[p.id] = p.order_number;
    }
  }

  return <OrdersView rows={rows} tab={tab} locale={locale} parentNumbers={parentNumbers} />;
}

function OrdersView({
  rows,
  tab,
  locale,
  parentNumbers,
}: {
  rows: Row[];
  tab: Tab;
  locale: Locale;
  parentNumbers: Record<string, string>;
}) {
  const t = useTranslations('orders');
  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          <Link href="/orders/new" className="btn-primary !w-auto px-4">
            {t('newButton')}
          </Link>
        }
      />

      <div className="mb-3 flex gap-1 overflow-x-auto">
        {TABS.map((k) => (
          <Link
            key={k}
            href={k === 'open' ? '/orders' : `/orders?tab=${k}`}
            className={`whitespace-nowrap rounded-full border px-3 py-1 text-sm ${
              tab === k
                ? 'border-brand-700 bg-brand-50 font-medium text-brand-900'
                : 'border-neutral-300 text-neutral-700'
            }`}
          >
            {t(`tabs.${k}`)}
          </Link>
        ))}
      </div>

      <ul className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {rows.map((r) => {
          const party = r.customer
            ? r.customer.business_name
              ? `${r.customer.business_name} — ${r.customer.full_name}`
              : r.customer.full_name
            : '—';
          return (
            <li key={r.id}>
              <Link
                href={`/orders/${r.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-neutral-900">
                      {r.order_number}
                    </span>
                    <OrderStatusBadge status={r.status} />
                    {r.parent_order_id && parentNumbers[r.parent_order_id] ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                        {t('fromOrder', { order: parentNumbers[r.parent_order_id] })}
                      </span>
                    ) : null}
                    <span className="text-xs uppercase text-neutral-500">
                      {r.business_line === 'kite' ? t('form.kite') : t('form.rakhi')}
                    </span>
                  </div>
                  <div className="truncate text-sm text-neutral-700">
                    {party}
                    {r.customer?.city ? ` · ${r.customer.city}` : ''}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {new Date(r.created_at).toLocaleString(locale === 'gu' ? 'gu-IN' : 'en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </div>
                </div>
                <div className="text-right text-sm font-semibold tabular-nums text-neutral-900">
                  {formatRupees(Number(r.estimated_total), locale)}
                </div>
              </Link>
            </li>
          );
        })}
        {rows.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-neutral-500">{t('empty')}</li>
        ) : null}
      </ul>
    </>
  );
}
