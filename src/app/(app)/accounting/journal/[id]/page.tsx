import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, pickLocalised, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader } from '@/components/page-header';
import { CancelJournalButton } from './cancel-form';

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
  source_id: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
}

interface LineRow {
  id: string;
  line_no: number;
  account_id: string;
  debit: number;
  credit: number;
  note: string | null;
  account: {
    code: string;
    name_en: string;
    name_gu: string;
  } | null;
}

export default async function JournalEntryDetailPage({ params }: { params: { id: string } }) {
  const user = await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const [{ data: entryRaw }, { data: linesRaw }] = await Promise.all([
    supabase
      .from('journal_entries')
      .select(
        'id, entry_number, entry_date, narration, status, source_type, source_id, cancellation_reason, cancelled_at, created_at',
      )
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('journal_lines')
      .select(
        'id, line_no, account_id, debit, credit, note, account:chart_of_accounts(code, name_en, name_gu)',
      )
      .eq('journal_entry_id', params.id)
      .order('line_no', { ascending: true }),
  ]);

  if (!entryRaw) notFound();
  const entry = entryRaw as unknown as EntryRow;
  const lines = (linesRaw ?? []) as unknown as LineRow[];

  const canWrite = user.role === 'super_admin' || user.role === 'accountant';

  return <DetailView entry={entry} lines={lines} canWrite={canWrite} locale={locale} />;
}

function DetailView({
  entry,
  lines,
  canWrite,
  locale,
}: {
  entry: EntryRow;
  lines: LineRow[];
  canWrite: boolean;
  locale: Locale;
}) {
  const t = useTranslations('accounting.journal.detail');
  const tCommon = useTranslations('accounting');
  const fmtD = (s: string) =>
    new Intl.DateTimeFormat(locale === 'gu' ? 'gu-IN' : 'en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(s));

  const sumDr = lines.reduce((a, l) => a + Number(l.debit), 0);
  const sumCr = lines.reduce((a, l) => a + Number(l.credit), 0);

  const cancellable = canWrite && entry.status === 'posted' && entry.source_type === 'manual';

  return (
    <>
      <PageHeader
        title={entry.entry_number ?? t('untitled')}
        subtitle={fmtD(entry.entry_date)}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {entry.status === 'cancelled' ? (
              <span className="rounded-full bg-red-100 px-2 py-1 text-xs text-red-900">
                {tCommon('statusCancelled')}
              </span>
            ) : (
              <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-800">
                {tCommon('statusPosted')}
              </span>
            )}
            {entry.source_type !== 'manual' ? (
              <span className="rounded-full bg-neutral-200 px-2 py-1 text-xs text-neutral-700">
                {tCommon(`source.${entry.source_type}`)}
              </span>
            ) : null}
          </div>
        }
      />

      {entry.narration ? (
        <div className="mb-3 rounded-md border border-neutral-200 bg-white p-3 text-sm text-neutral-800">
          <div className="text-[10px] uppercase tracking-wide text-neutral-500">
            {t('narrationLabel')}
          </div>
          <div className="mt-0.5 whitespace-pre-wrap">{entry.narration}</div>
        </div>
      ) : null}

      <div className="mb-4 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="w-10 px-2 py-2 text-center">#</th>
              <th className="px-2 py-2 text-left">{t('accountColumn')}</th>
              <th className="w-32 px-2 py-2 text-right">{t('debitColumn')}</th>
              <th className="w-32 px-2 py-2 text-right">{t('creditColumn')}</th>
              <th className="px-2 py-2 text-left">{t('noteColumn')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const acct = l.account
                ? `${l.account.code} · ${pickLocalised(locale, l.account.name_en, l.account.name_gu)}`
                : '—';
              return (
                <tr key={l.id} className="border-t border-neutral-100">
                  <td className="px-2 py-2 text-center text-xs text-neutral-500">{l.line_no}</td>
                  <td className="px-2 py-2">{acct}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {Number(l.debit) > 0 ? formatRupees(Number(l.debit), locale) : ''}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {Number(l.credit) > 0 ? formatRupees(Number(l.credit), locale) : ''}
                  </td>
                  <td className="px-2 py-2 text-xs text-neutral-600">{l.note ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-neutral-50">
            <tr>
              <td
                colSpan={2}
                className="px-2 py-2 text-right text-xs uppercase tracking-wide text-neutral-500"
              >
                {t('totalsLabel')}
              </td>
              <td className="px-2 py-2 text-right font-semibold tabular-nums">
                {formatRupees(sumDr, locale)}
              </td>
              <td className="px-2 py-2 text-right font-semibold tabular-nums">
                {formatRupees(sumCr, locale)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {entry.status === 'cancelled' && entry.cancellation_reason ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span className="font-semibold">{t('cancelReasonLabel')}: </span>
          {entry.cancellation_reason}
        </div>
      ) : null}

      {cancellable ? (
        <div className="mb-4">
          <CancelJournalButton id={entry.id} />
        </div>
      ) : null}

      <Link href="/accounting/journal" className="btn-ghost border border-neutral-300">
        ← {t('backButton')}
      </Link>
    </>
  );
}
