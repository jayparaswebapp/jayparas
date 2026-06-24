import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader } from '@/components/page-header';

export const dynamic = 'force-dynamic';

type Method = 'cash' | 'upi' | 'bank_transfer';
type Status = 'received' | 'cancelled';

interface Row {
  id: string;
  payment_number: string | null;
  payment_date: string;
  payment_method: Method;
  amount: number;
  reference_no: string | null;
  status: Status;
  customer: { full_name: string; business_name: string | null } | null;
}

const STATUS_KEYS: Record<Status, string> = {
  received: 'statusReceived',
  cancelled: 'statusCancelled',
};

const METHOD_KEYS: Record<Method, string> = {
  cash: 'methodCash',
  upi: 'methodUpi',
  bank_transfer: 'methodBankTransfer',
};

export default async function PaymentsListPage({
  searchParams,
}: {
  searchParams: { q?: string; method?: string; status?: string; from?: string; to?: string };
}) {
  const user = await requireAppUser();
  const locale = getServerLocale();
  const q = (searchParams.q ?? '').trim();
  const method = (searchParams.method ?? '').trim();
  const status = (searchParams.status ?? '').trim();
  const from = (searchParams.from ?? '').trim();
  const to = (searchParams.to ?? '').trim();
  const supabase = createClient();

  let query = supabase
    .from('payments')
    .select(
      'id, payment_number, payment_date, payment_method, amount, reference_no, status, customer:billing_customers(full_name, business_name)',
    )
    .order('payment_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (method === 'cash' || method === 'upi' || method === 'bank_transfer')
    query = query.eq('payment_method', method);
  if (status === 'received' || status === 'cancelled') query = query.eq('status', status);
  if (from) query = query.gte('payment_date', from);
  if (to) query = query.lte('payment_date', to);
  if (q.length > 0) {
    const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
    query = query.or(`payment_number.ilike.${like},reference_no.ilike.${like}`);
  }

  const { data: rows } = await query;
  const payments = (rows ?? []) as unknown as Row[];

  const canWrite = user.role === 'super_admin' || user.role === 'supervisor';

  return (
    <PaymentsView
      rows={payments}
      canWrite={canWrite}
      filters={{ q, method, status, from, to }}
      locale={locale}
    />
  );
}

function PaymentsView({
  rows,
  canWrite,
  filters,
  locale,
}: {
  rows: Row[];
  canWrite: boolean;
  filters: { q: string; method: string; status: string; from: string; to: string };
  locale: Locale;
}) {
  const t = useTranslations('billing.payments');
  const hasFilter =
    filters.q.length > 0 ||
    filters.method.length > 0 ||
    filters.status.length > 0 ||
    filters.from.length > 0 ||
    filters.to.length > 0;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          canWrite ? (
            <Link href="/billing/payments/new" className="btn-primary !w-auto px-4">
              {t('newButton')}
            </Link>
          ) : null
        }
      />

      <form
        method="get"
        className="mb-3 grid grid-cols-1 gap-2 rounded-md border border-neutral-200 bg-white p-3 sm:grid-cols-6"
      >
        <input
          name="q"
          defaultValue={filters.q}
          placeholder={t('searchPlaceholder')}
          className="input-base sm:col-span-2"
        />
        <select name="method" defaultValue={filters.method} className="input-base">
          <option value="">{t('methodAll')}</option>
          <option value="cash">{t('methodCash')}</option>
          <option value="upi">{t('methodUpi')}</option>
          <option value="bank_transfer">{t('methodBankTransfer')}</option>
        </select>
        <select name="status" defaultValue={filters.status} className="input-base">
          <option value="">{t('statusAll')}</option>
          <option value="received">{t('statusReceived')}</option>
          <option value="cancelled">{t('statusCancelled')}</option>
        </select>
        <input type="date" name="from" defaultValue={filters.from} className="input-base" />
        <input type="date" name="to" defaultValue={filters.to} className="input-base" />
        <div className="flex items-center gap-2 sm:col-span-6">
          <button type="submit" className="btn-ghost border border-neutral-300">
            {t('applyButton')}
          </button>
          {hasFilter ? (
            <Link href="/billing/payments" className="btn-ghost border border-neutral-300 text-sm">
              {t('clearButton')}
            </Link>
          ) : null}
        </div>
      </form>

      <ul className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {rows.map((row) => {
          const dateStr = new Intl.DateTimeFormat(locale === 'gu' ? 'gu-IN' : 'en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          }).format(new Date(row.payment_date));
          const customerLabel = row.customer
            ? row.customer.business_name
              ? `${row.customer.business_name} (${row.customer.full_name})`
              : row.customer.full_name
            : '—';
          return (
            <li key={row.id}>
              <Link
                href={`/billing/payments/${row.id}`}
                className="block px-4 py-3 transition hover:bg-neutral-50"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-neutral-900">
                    {row.payment_number ?? '—'}
                  </span>
                  <StatusPill status={row.status} />
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                    {t(METHOD_KEYS[row.payment_method])}
                  </span>
                  <span className="ml-auto text-sm font-medium text-neutral-900">
                    {formatRupees(Number(row.amount), locale)}
                  </span>
                </div>
                <div className="mt-0.5 text-sm text-neutral-700">{customerLabel}</div>
                <div className="text-xs text-neutral-500">
                  {dateStr}
                  {row.reference_no ? ` · ${t('refLabel')}: ${row.reference_no}` : ''}
                </div>
              </Link>
            </li>
          );
        })}
        {rows.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-neutral-500">
            {hasFilter ? t('noMatches') : t('empty')}
          </li>
        ) : null}
      </ul>
    </>
  );
}

function StatusPill({ status }: { status: Status }) {
  const t = useTranslations('billing.payments');
  const className =
    status === 'received' ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${className}`}>
      {t(STATUS_KEYS[status])}
    </span>
  );
}
