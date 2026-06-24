import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader } from '@/components/page-header';

export const dynamic = 'force-dynamic';

type Status = 'draft' | 'issued' | 'cancelled';
type Line = 'rakhi' | 'kite';

interface Row {
  id: string;
  credit_note_number: string | null;
  business_line: Line;
  status: Status;
  return_date: string;
  grand_total: number;
  invoice: { id: string; invoice_number: string | null } | null;
  customer: { full_name: string; business_name: string | null } | null;
}

const STATUS_KEYS: Record<Status, string> = {
  draft: 'statusDraft',
  issued: 'statusIssued',
  cancelled: 'statusCancelled',
};

export default async function ReturnsListPage({
  searchParams,
}: {
  searchParams: { q?: string; line?: string; status?: string; from?: string; to?: string };
}) {
  const user = await requireAppUser();
  const locale = getServerLocale();
  const q = (searchParams.q ?? '').trim();
  const line = (searchParams.line ?? '').trim();
  const status = (searchParams.status ?? '').trim();
  const from = (searchParams.from ?? '').trim();
  const to = (searchParams.to ?? '').trim();
  const supabase = createClient();

  let query = supabase
    .from('sales_returns')
    .select(
      'id, credit_note_number, business_line, status, return_date, grand_total, invoice:invoices(id, invoice_number), customer:billing_customers(full_name, business_name)',
    )
    .is('deleted_at', null)
    .order('return_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (line === 'rakhi' || line === 'kite') query = query.eq('business_line', line);
  if (status === 'draft' || status === 'issued' || status === 'cancelled')
    query = query.eq('status', status);
  if (from) query = query.gte('return_date', from);
  if (to) query = query.lte('return_date', to);
  if (q.length > 0) {
    const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
    query = query.or(`credit_note_number.ilike.${like}`);
  }

  const { data: rows } = await query;
  const returns = (rows ?? []) as unknown as Row[];

  const canWrite = user.role === 'super_admin' || user.role === 'supervisor';

  return (
    <ReturnsView
      rows={returns}
      canWrite={canWrite}
      filters={{ q, line, status, from, to }}
      locale={locale}
    />
  );
}

function ReturnsView({
  rows,
  canWrite,
  filters,
  locale,
}: {
  rows: Row[];
  canWrite: boolean;
  filters: { q: string; line: string; status: string; from: string; to: string };
  locale: Locale;
}) {
  const t = useTranslations('billing.returns');
  const tInv = useTranslations('billing.invoices');
  const hasFilter =
    filters.q.length > 0 ||
    filters.line.length > 0 ||
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
            <Link href="/billing/returns/new" className="btn-primary !w-auto px-4">
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
        <select name="line" defaultValue={filters.line} className="input-base">
          <option value="">{tInv('businessLineAll')}</option>
          <option value="rakhi">{tInv('businessLineRakhi')}</option>
          <option value="kite">{tInv('businessLineKite')}</option>
        </select>
        <select name="status" defaultValue={filters.status} className="input-base">
          <option value="">{tInv('statusAll')}</option>
          <option value="draft">{tInv('statusDraft')}</option>
          <option value="issued">{tInv('statusIssued')}</option>
          <option value="cancelled">{tInv('statusCancelled')}</option>
        </select>
        <input type="date" name="from" defaultValue={filters.from} className="input-base" />
        <input type="date" name="to" defaultValue={filters.to} className="input-base" />
        <div className="flex items-center gap-2 sm:col-span-6">
          <button type="submit" className="btn-ghost border border-neutral-300">
            {tInv('applyButton')}
          </button>
          {hasFilter ? (
            <Link href="/billing/returns" className="btn-ghost border border-neutral-300 text-sm">
              {tInv('clearButton')}
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
          }).format(new Date(row.return_date));
          const customerLabel = row.customer
            ? row.customer.business_name
              ? `${row.customer.business_name} (${row.customer.full_name})`
              : row.customer.full_name
            : '—';
          return (
            <li key={row.id}>
              <Link
                href={`/billing/returns/${row.id}`}
                className="block px-4 py-3 transition hover:bg-neutral-50"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-neutral-900">
                    {row.credit_note_number ?? tInv('draftLabel')}
                  </span>
                  <StatusPill status={row.status} />
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      row.business_line === 'kite'
                        ? 'bg-sky-100 text-sky-900'
                        : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {row.business_line === 'kite'
                      ? tInv('businessLineKite')
                      : tInv('businessLineRakhi')}
                  </span>
                  <span className="ml-auto text-sm font-medium text-neutral-900">
                    {formatRupees(Number(row.grand_total), locale)}
                  </span>
                </div>
                <div className="mt-0.5 text-sm text-neutral-700">{customerLabel}</div>
                <div className="text-xs text-neutral-500">
                  {dateStr}
                  {row.invoice?.invoice_number
                    ? ` · ${t('againstInvoiceLabel')}: ${row.invoice.invoice_number}`
                    : ''}
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
  const tInv = useTranslations('billing.invoices');
  const className =
    status === 'issued'
      ? 'bg-emerald-100 text-emerald-900'
      : status === 'cancelled'
        ? 'bg-red-100 text-red-900'
        : 'bg-neutral-200 text-neutral-700';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${className}`}>
      {tInv(STATUS_KEYS[status])}
    </span>
  );
}
