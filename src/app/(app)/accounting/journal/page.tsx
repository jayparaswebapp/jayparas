import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader } from '@/components/page-header';

export const dynamic = 'force-dynamic';

type Status = 'posted' | 'cancelled';
type SourceType =
  'manual' | 'invoice' | 'payment' | 'purchase_bill' | 'sales_return' | 'll_wage_payment';

interface EntryRow {
  id: string;
  entry_number: string | null;
  entry_date: string;
  narration: string | null;
  status: Status;
  source_type: SourceType;
}
interface LineRow {
  journal_entry_id: string;
  debit: number;
  credit: number;
}

export default async function JournalListPage({
  searchParams,
}: {
  searchParams: { source?: string; status?: string; from?: string; to?: string };
}) {
  const user = await requireAppUser();
  const locale = getServerLocale();
  const source = (searchParams.source ?? '').trim();
  const status = (searchParams.status ?? '').trim();
  const from = (searchParams.from ?? '').trim();
  const to = (searchParams.to ?? '').trim();
  const supabase = createClient();

  let q = supabase
    .from('journal_entries')
    .select('id, entry_number, entry_date, narration, status, source_type')
    .is('deleted_at', null)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (source) q = q.eq('source_type', source);
  if (status === 'posted' || status === 'cancelled') q = q.eq('status', status);
  if (from) q = q.gte('entry_date', from);
  if (to) q = q.lte('entry_date', to);

  const { data: entriesRaw } = await q;
  const entries = (entriesRaw ?? []) as unknown as EntryRow[];
  const entryIds = entries.map((e) => e.id);

  let sumsByEntry = new Map<string, { debit: number; credit: number }>();
  if (entryIds.length > 0) {
    const { data: linesRaw } = await supabase
      .from('journal_lines')
      .select('journal_entry_id, debit, credit')
      .in('journal_entry_id', entryIds);
    sumsByEntry = ((linesRaw ?? []) as unknown as LineRow[]).reduce((acc, l) => {
      const cur = acc.get(l.journal_entry_id) ?? { debit: 0, credit: 0 };
      cur.debit += Number(l.debit);
      cur.credit += Number(l.credit);
      acc.set(l.journal_entry_id, cur);
      return acc;
    }, new Map<string, { debit: number; credit: number }>());
  }

  const canWrite = user.role === 'super_admin' || user.role === 'accountant';

  return (
    <JournalListView
      entries={entries}
      sumsByEntry={sumsByEntry}
      canWrite={canWrite}
      filters={{ source, status, from, to }}
      locale={locale}
    />
  );
}

function JournalListView({
  entries,
  sumsByEntry,
  canWrite,
  filters,
  locale,
}: {
  entries: EntryRow[];
  sumsByEntry: Map<string, { debit: number; credit: number }>;
  canWrite: boolean;
  filters: { source: string; status: string; from: string; to: string };
  locale: Locale;
}) {
  const t = useTranslations('accounting.journal');
  const tCommon = useTranslations('accounting');
  const hasFilter =
    filters.source.length + filters.status.length + filters.from.length + filters.to.length > 0;
  const fmtD = (s: string) =>
    new Intl.DateTimeFormat(locale === 'gu' ? 'gu-IN' : 'en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(s));

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          canWrite ? (
            <Link href="/accounting/journal/new" className="btn-primary !w-auto px-4">
              {tCommon('newJournalEntryButton')}
            </Link>
          ) : null
        }
      />

      <form
        method="get"
        className="mb-3 grid grid-cols-1 gap-2 rounded-md border border-neutral-200 bg-white p-3 sm:grid-cols-5"
      >
        <select name="source" defaultValue={filters.source} className="input-base">
          <option value="">{t('allSources')}</option>
          <option value="manual">{tCommon('source.manual')}</option>
          <option value="invoice">{tCommon('source.invoice')}</option>
          <option value="payment">{tCommon('source.payment')}</option>
          <option value="purchase_bill">{tCommon('source.purchase_bill')}</option>
          <option value="sales_return">{tCommon('source.sales_return')}</option>
          <option value="ll_wage_payment">{tCommon('source.ll_wage_payment')}</option>
        </select>
        <select name="status" defaultValue={filters.status} className="input-base">
          <option value="">{t('allStatuses')}</option>
          <option value="posted">{tCommon('statusPosted')}</option>
          <option value="cancelled">{tCommon('statusCancelled')}</option>
        </select>
        <input type="date" name="from" defaultValue={filters.from} className="input-base" />
        <input type="date" name="to" defaultValue={filters.to} className="input-base" />
        <div className="flex items-center gap-2">
          <button type="submit" className="btn-ghost border border-neutral-300">
            {t('applyButton')}
          </button>
          {hasFilter ? (
            <Link
              href="/accounting/journal"
              className="btn-ghost border border-neutral-300 text-sm"
            >
              {t('clearButton')}
            </Link>
          ) : null}
        </div>
      </form>

      <ul className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {entries.map((e) => {
          const s = sumsByEntry.get(e.id) ?? { debit: 0, credit: 0 };
          return (
            <li key={e.id}>
              <Link
                href={`/accounting/journal/${e.id}`}
                className="block px-4 py-3 transition hover:bg-neutral-50"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-neutral-900">
                    {e.entry_number ?? '—'}
                  </span>
                  {e.status === 'cancelled' ? (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-900">
                      {tCommon('statusCancelled')}
                    </span>
                  ) : null}
                  {e.source_type !== 'manual' ? (
                    <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-700">
                      {tCommon(`source.${e.source_type}`)}
                    </span>
                  ) : null}
                  <span className="ml-auto text-xs text-neutral-500">{fmtD(e.entry_date)}</span>
                </div>
                {e.narration ? (
                  <div className="mt-0.5 truncate text-sm text-neutral-700">{e.narration}</div>
                ) : null}
                <div className="mt-1 text-xs tabular-nums text-neutral-600">
                  Dr {formatRupees(s.debit, locale)} · Cr {formatRupees(s.credit, locale)}
                </div>
              </Link>
            </li>
          );
        })}
        {entries.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-neutral-500">
            {hasFilter ? t('noMatches') : t('empty')}
          </li>
        ) : null}
      </ul>
    </>
  );
}
