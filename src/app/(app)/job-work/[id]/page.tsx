import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, pickLocalised, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader } from '@/components/page-header';
import { ItemActions, type LabourerOption } from './item-actions';
import { OrderActions } from './order-actions';

export const dynamic = 'force-dynamic';

type Status = 'open' | 'closed' | 'cancelled';

interface OrderRow {
  id: string;
  job_order_number: string | null;
  lead_lady_id: string;
  location_id: string | null;
  issue_date: string;
  expected_return_date: string | null;
  status: Status;
  notes: string | null;
  lead_lady_snapshot: { full_name?: string; mobile?: string } | null;
  location_snapshot: { name?: string } | null;
  cancellation_reason: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
}

interface ItemRow {
  id: string;
  line_no: number;
  design_id: string | null;
  design_snapshot: { design_number?: string; name_en?: string; name_gu?: string } | null;
  qty_issued: number;
  rate_per_piece: number;
  notes: string | null;
}

interface BalanceRow {
  job_order_item_id: string;
  qty_sub_assigned: number;
  qty_accepted: number;
  qty_rejected: number;
  qty_at_labourer: number;
  qty_at_ll: number;
  wages_owed: number;
}

interface SubRow {
  id: string;
  job_order_item_id: string;
  labourer_id: string;
  qty_assigned: number;
  assigned_date: string;
  notes: string | null;
  labourer: { full_name: string } | null;
}

interface ReceiptRow {
  id: string;
  job_order_item_id: string;
  labourer_id: string | null;
  qty_accepted: number;
  qty_rejected: number;
  receipt_date: string;
  notes: string | null;
  labourer: { full_name: string } | null;
}

const STATUS_KEYS: Record<Status, string> = {
  open: 'statusOpen',
  closed: 'statusClosed',
  cancelled: 'statusCancelled',
};

export default async function JobOrderDetailPage({ params }: { params: { id: string } }) {
  const user = await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const { data: ord } = await supabase
    .from('job_orders')
    .select(
      'id, job_order_number, lead_lady_id, location_id, issue_date, expected_return_date, status, notes, lead_lady_snapshot, location_snapshot, cancellation_reason, closed_at, cancelled_at',
    )
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!ord) notFound();
  const order = ord as unknown as OrderRow;

  const [
    { data: itemsRaw },
    { data: balsRaw },
    { data: subsRaw },
    { data: recsRaw },
    { data: labsRaw },
  ] = await Promise.all([
    supabase
      .from('job_order_items')
      .select('id, line_no, design_id, design_snapshot, qty_issued, rate_per_piece, notes')
      .eq('job_order_id', params.id)
      .order('line_no', { ascending: true }),
    supabase
      .from('job_order_item_balances')
      .select(
        'job_order_item_id, qty_sub_assigned, qty_accepted, qty_rejected, qty_at_labourer, qty_at_ll, wages_owed',
      )
      .eq('job_order_id', params.id),
    supabase
      .from('job_sub_assignments')
      .select(
        'id, job_order_item_id, labourer_id, qty_assigned, assigned_date, notes, labourer:labourers(full_name)',
      )
      .in(
        'job_order_item_id',
        (
          await supabase.from('job_order_items').select('id').eq('job_order_id', params.id)
        ).data?.map((r) => r.id as string) ?? [],
      )
      .order('assigned_date', { ascending: true }),
    supabase
      .from('job_receipts')
      .select(
        'id, job_order_item_id, labourer_id, qty_accepted, qty_rejected, receipt_date, notes, labourer:labourers(full_name)',
      )
      .in(
        'job_order_item_id',
        (
          await supabase.from('job_order_items').select('id').eq('job_order_id', params.id)
        ).data?.map((r) => r.id as string) ?? [],
      )
      .order('receipt_date', { ascending: true }),
    supabase
      .from('labourers')
      .select('id, full_name, mobile')
      .eq('lead_lady_id', order.lead_lady_id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('full_name', { ascending: true }),
  ]);

  const items = (itemsRaw ?? []) as unknown as ItemRow[];
  const balances = (balsRaw ?? []) as unknown as BalanceRow[];
  const balanceById = new Map<string, BalanceRow>();
  for (const b of balances) balanceById.set(b.job_order_item_id, b);
  const subs = (subsRaw ?? []) as unknown as SubRow[];
  const receipts = (recsRaw ?? []) as unknown as ReceiptRow[];
  const labourers: LabourerOption[] = (labsRaw ?? []).map(
    (l: { id: string; full_name: string; mobile: string | null }) => ({
      id: l.id,
      label: l.full_name + (l.mobile ? ` · +91 ${l.mobile}` : ''),
    }),
  );

  const canWrite = user.role === 'super_admin' || user.role === 'supervisor';

  return (
    <DetailView
      order={order}
      items={items}
      balanceById={balanceById}
      subs={subs}
      receipts={receipts}
      labourers={labourers}
      canWrite={canWrite}
      locale={locale}
    />
  );
}

function DetailView({
  order,
  items,
  balanceById,
  subs,
  receipts,
  labourers,
  canWrite,
  locale,
}: {
  order: OrderRow;
  items: ItemRow[];
  balanceById: Map<string, BalanceRow>;
  subs: SubRow[];
  receipts: ReceiptRow[];
  labourers: LabourerOption[];
  canWrite: boolean;
  locale: Locale;
}) {
  const t = useTranslations('jobWork.detail');
  const tList = useTranslations('jobWork');
  const fmtD = (s: string | null) =>
    s
      ? new Intl.DateTimeFormat(locale === 'gu' ? 'gu-IN' : 'en-IN', {
          day: '2-digit',
          month: 'short',
          year: '2-digit',
        }).format(new Date(s))
      : '—';

  const llName = order.lead_lady_snapshot?.full_name ?? '—';
  const locName = order.location_snapshot?.name ?? null;

  return (
    <>
      <PageHeader
        title={order.job_order_number ?? t('untitledOrder')}
        subtitle={tList(STATUS_KEYS[order.status])}
        action={canWrite ? <OrderActions id={order.id} status={order.status} /> : null}
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <InfoTile label={t('leadLadyLabel')} value={llName} />
        <InfoTile label={t('issueDateLabel')} value={fmtD(order.issue_date)} />
        <InfoTile
          label={t('expectedReturnLabel')}
          value={order.expected_return_date ? fmtD(order.expected_return_date) : '—'}
        />
        {locName ? <InfoTile label={t('locationLabel')} value={locName} /> : null}
        {order.notes ? <InfoTile label={t('notesLabel')} value={order.notes} wide /> : null}
        {order.status === 'cancelled' && order.cancellation_reason ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 sm:col-span-3">
            <span className="font-semibold">{t('cancelReasonLabel')}: </span>
            {order.cancellation_reason}
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center text-sm text-neutral-500">
          {t('noItems')}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const bal = balanceById.get(item.id);
            const designLabel = item.design_snapshot
              ? `${item.design_snapshot.design_number ?? ''} · ${pickLocalised(locale, item.design_snapshot.name_en, item.design_snapshot.name_gu)}`
              : '—';
            const itemSubs = subs.filter((s) => s.job_order_item_id === item.id);
            const itemReceipts = receipts.filter((r) => r.job_order_item_id === item.id);
            return (
              <section
                key={item.id}
                className="overflow-hidden rounded-lg border border-neutral-200 bg-white"
              >
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2">
                  <div>
                    <div className="text-sm font-semibold">
                      {item.line_no}. {designLabel}
                    </div>
                    <div className="text-xs text-neutral-600">
                      {t('issuedLabel')}: <strong>{Number(item.qty_issued).toFixed(0)}</strong> ·{' '}
                      {t('rateLabel')}: {formatRupees(Number(item.rate_per_piece), locale)}/pc
                    </div>
                  </div>
                  {bal ? (
                    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <Stat label={t('atLlLabel')} value={Number(bal.qty_at_ll)} />
                      <Stat label={t('atLabourerLabel')} value={Number(bal.qty_at_labourer)} />
                      <Stat
                        label={t('acceptedLabel')}
                        value={Number(bal.qty_accepted)}
                        accent="emerald"
                      />
                      <Stat
                        label={t('rejectedLabel')}
                        value={Number(bal.qty_rejected)}
                        accent="red"
                      />
                    </div>
                  ) : null}
                </header>

                <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
                  <div>
                    <h3 className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
                      {t('subAssignmentsHeader')}
                    </h3>
                    {itemSubs.length === 0 ? (
                      <p className="text-xs text-neutral-500">{t('noSubAssignments')}</p>
                    ) : (
                      <ul className="space-y-1 text-xs">
                        {itemSubs.map((s) => (
                          <li key={s.id} className="flex items-center justify-between">
                            <span>
                              {fmtD(s.assigned_date)} · {s.labourer?.full_name ?? '—'}
                            </span>
                            <span className="font-semibold tabular-nums">
                              {Number(s.qty_assigned).toFixed(0)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h3 className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
                      {t('receiptsHeader')}
                    </h3>
                    {itemReceipts.length === 0 ? (
                      <p className="text-xs text-neutral-500">{t('noReceipts')}</p>
                    ) : (
                      <ul className="space-y-1 text-xs">
                        {itemReceipts.map((r) => (
                          <li key={r.id} className="flex items-center justify-between">
                            <span>
                              {fmtD(r.receipt_date)} ·{' '}
                              {r.labourer?.full_name ?? t('directReceiptLabel')}
                            </span>
                            <span className="tabular-nums">
                              <span className="font-semibold text-emerald-700">
                                {Number(r.qty_accepted).toFixed(0)}
                              </span>
                              {Number(r.qty_rejected) > 0 ? (
                                <span className="ml-2 text-red-700">
                                  −{Number(r.qty_rejected).toFixed(0)}
                                </span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {canWrite && order.status === 'open' ? (
                  <div className="border-t border-neutral-200 p-3">
                    <ItemActions orderId={order.id} itemId={item.id} labourers={labourers} />
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      <div className="mt-6">
        <Link href="/job-work" className="btn-ghost border border-neutral-300">
          ← {t('backButton')}
        </Link>
      </div>
    </>
  );
}

function InfoTile({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div
      className={`rounded-md border border-neutral-200 bg-white p-3 text-sm ${wide ? 'sm:col-span-3' : ''}`}
    >
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-0.5 whitespace-pre-wrap text-neutral-900">{value}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'emerald' | 'red';
}) {
  const cls =
    accent === 'emerald'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : accent === 'red'
        ? 'border-red-200 bg-red-50 text-red-900'
        : 'border-neutral-200 bg-white text-neutral-700';
  return (
    <div className={`rounded border px-2 py-1 ${cls}`}>
      <div className="text-[9px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="font-semibold tabular-nums">{value.toFixed(0)}</div>
    </div>
  );
}
