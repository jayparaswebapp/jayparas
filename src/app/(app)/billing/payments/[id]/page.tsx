import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader } from '@/components/page-header';
import { PaymentActions } from './payment-actions';

export const dynamic = 'force-dynamic';

type Method = 'cash' | 'upi' | 'bank_transfer';
type Status = 'received' | 'cancelled';

interface PaymentRow {
  id: string;
  payment_number: string | null;
  customer_id: string;
  payment_date: string;
  payment_method: Method;
  amount: number;
  reference_no: string | null;
  notes: string | null;
  status: Status;
  customer_snapshot: Record<string, string | null> | null;
  seller_snapshot: Record<string, string | null> | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
}

interface AllocRow {
  id: string;
  invoice_id: string;
  amount_applied: number;
  invoice: {
    id: string;
    invoice_number: string | null;
    invoice_date: string;
    grand_total: number;
  } | null;
}

const METHOD_KEYS: Record<Method, string> = {
  cash: 'methodCash',
  upi: 'methodUpi',
  bank_transfer: 'methodBankTransfer',
};

export default async function PaymentDetailPage({ params }: { params: { id: string } }) {
  const user = await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const { data: pay } = await supabase
    .from('payments')
    .select(
      'id, payment_number, customer_id, payment_date, payment_method, amount, reference_no, notes, status, customer_snapshot, seller_snapshot, cancelled_at, cancellation_reason, created_at',
    )
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!pay) notFound();
  const payment = pay as unknown as PaymentRow;

  const { data: als } = await supabase
    .from('payment_allocations')
    .select(
      'id, invoice_id, amount_applied, invoice:invoices(id, invoice_number, invoice_date, grand_total)',
    )
    .eq('payment_id', params.id)
    .order('created_at', { ascending: true });
  const allocations = (als ?? []) as unknown as AllocRow[];

  const canWrite = user.role === 'super_admin' || user.role === 'supervisor';

  return (
    <PaymentView payment={payment} allocations={allocations} canWrite={canWrite} locale={locale} />
  );
}

function PaymentView({
  payment,
  allocations,
  canWrite,
  locale,
}: {
  payment: PaymentRow;
  allocations: AllocRow[];
  canWrite: boolean;
  locale: Locale;
}) {
  const t = useTranslations('billing.payments');
  const tDet = useTranslations('billing.payments.detail');
  const tStatus = payment.status === 'cancelled' ? t('statusCancelled') : t('statusReceived');
  const dateStr = new Intl.DateTimeFormat(locale === 'gu' ? 'gu-IN' : 'en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(payment.payment_date));

  return (
    <>
      <PageHeader
        title={tDet('title')}
        subtitle={tStatus}
        action={
          <div className="flex items-center gap-2">
            <Link
              href={`/billing/payments/${payment.id}/print`}
              className="btn-primary !w-auto px-4"
            >
              {tDet('printButton')}
            </Link>
            {canWrite ? <PaymentActions id={payment.id} status={payment.status} /> : null}
          </div>
        }
      />

      <div className="mb-4 rounded-lg border border-neutral-200 bg-white p-3 text-sm text-neutral-700">
        <span className="text-neutral-500">{tDet('numberLabel')}: </span>
        <span className="font-mono text-base font-bold text-neutral-900">
          {payment.payment_number ?? '—'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Snapshot title={tDet('from')} snap={payment.seller_snapshot} />
        <Snapshot title={tDet('receivedFrom')} snap={payment.customer_snapshot} />
      </div>

      <div className="my-4 rounded-md border border-neutral-200 bg-white p-3 text-sm text-neutral-700">
        <dl className="grid grid-cols-2 gap-y-1 sm:grid-cols-4">
          <dt className="text-neutral-500">{tDet('dateLabel')}</dt>
          <dd className="text-neutral-900">{dateStr}</dd>
          <dt className="text-neutral-500">{tDet('methodLabel')}</dt>
          <dd className="text-neutral-900">{t(METHOD_KEYS[payment.payment_method])}</dd>
          <dt className="text-neutral-500">{tDet('amountLabel')}</dt>
          <dd className="font-semibold text-neutral-900">
            {formatRupees(Number(payment.amount), locale)}
          </dd>
          {payment.reference_no ? (
            <>
              <dt className="text-neutral-500">{tDet('referenceLabel')}</dt>
              <dd className="font-mono text-neutral-900">{payment.reference_no}</dd>
            </>
          ) : null}
        </dl>
      </div>

      <div className="mb-4 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">{tDet('invoiceColumn')}</th>
              <th className="px-3 py-2">{tDet('invoiceDateColumn')}</th>
              <th className="px-3 py-2 text-right">{tDet('grandTotalColumn')}</th>
              <th className="px-3 py-2 text-right">{tDet('amountAppliedColumn')}</th>
            </tr>
          </thead>
          <tbody>
            {allocations.map((a) => {
              const inv = a.invoice;
              const invDate = inv?.invoice_date
                ? new Intl.DateTimeFormat(locale === 'gu' ? 'gu-IN' : 'en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: '2-digit',
                  }).format(new Date(inv.invoice_date))
                : '—';
              return (
                <tr key={a.id} className="border-t border-neutral-200">
                  <td className="px-3 py-2">
                    {inv ? (
                      <Link
                        href={`/billing/invoices/${inv.id}`}
                        className="font-mono text-brand-700 hover:underline"
                      >
                        {inv.invoice_number ?? '—'}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-600">{invDate}</td>
                  <td className="px-3 py-2 text-right">
                    {inv ? formatRupees(Number(inv.grand_total), locale) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {formatRupees(Number(a.amount_applied), locale)}
                  </td>
                </tr>
              );
            })}
            {allocations.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-sm text-neutral-500">
                  {tDet('noAllocations')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {payment.notes ? (
        <div className="mb-4 rounded-md border border-neutral-200 bg-white p-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            {tDet('notesLabel')}
          </div>
          <div className="mt-1 whitespace-pre-wrap text-neutral-800">{payment.notes}</div>
        </div>
      ) : null}

      {payment.status === 'cancelled' && payment.cancellation_reason ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span className="font-semibold">{tDet('cancelReasonLabel')}: </span>
          {payment.cancellation_reason}
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
    snap.mobile ? `+91 ${snap.mobile}` : null,
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
