import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, formatRupees } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { indianAmountInWords } from '@/lib/format/amount-words';
import { PrintToolbar } from './print-toolbar';

export const dynamic = 'force-dynamic';

type Method = 'cash' | 'upi' | 'bank_transfer';
type Status = 'received' | 'cancelled';

interface PaymentRow {
  id: string;
  payment_number: string | null;
  payment_date: string;
  payment_method: Method;
  amount: number;
  reference_no: string | null;
  notes: string | null;
  status: Status;
  customer_snapshot: Record<string, string | null> | null;
  seller_snapshot: Record<string, string | null> | null;
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

export default async function PaymentPrintPage({ params }: { params: { id: string } }) {
  await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const { data: pay } = await supabase
    .from('payments')
    .select(
      'id, payment_number, payment_date, payment_method, amount, reference_no, notes, status, customer_snapshot, seller_snapshot',
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

  // Pull current balance per invoice to show on the receipt — useful for the
  // customer to see "after this payment, you still owe X on invoice Y".
  const invoiceIds = allocations.map((a) => a.invoice_id);
  const balanceById = new Map<string, number>();
  if (invoiceIds.length > 0) {
    const { data: bs } = await supabase
      .from('invoice_balances')
      .select('invoice_id, balance_due')
      .in('invoice_id', invoiceIds);
    for (const row of bs ?? []) {
      balanceById.set(row.invoice_id as string, Number(row.balance_due));
    }
  }

  return (
    <PrintView
      payment={payment}
      allocations={allocations}
      balanceById={balanceById}
      locale={locale}
    />
  );
}

function fmtDate(s: string | null, locale: Locale): string {
  if (!s) return '';
  return new Intl.DateTimeFormat(locale === 'gu' ? 'gu-IN' : 'en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  })
    .format(new Date(s))
    .replace(/ /g, '-');
}

function PrintView({
  payment,
  allocations,
  balanceById,
  locale,
}: {
  payment: PaymentRow;
  allocations: AllocRow[];
  balanceById: Map<string, number>;
  locale: Locale;
}) {
  const t = useTranslations('billing.payments.print');
  const tPay = useTranslations('billing.payments');
  const seller = payment.seller_snapshot ?? {};
  const customer = payment.customer_snapshot ?? {};

  const numericFont: React.CSSProperties = {
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    fontVariantNumeric: 'tabular-nums',
  };

  const sellerAddr = [seller.address_line1, seller.address_line2, seller.city, seller.state]
    .filter(Boolean)
    .join(', ');
  const sellerPincode = seller.pincode ?? '';

  const customerAddr = [
    customer.address_line1,
    customer.address_line2,
    customer.city,
    customer.state,
    customer.pincode,
  ]
    .filter(Boolean)
    .join(', ');

  const amountWords = indianAmountInWords(Number(payment.amount));
  const totalAllocated = allocations.reduce((acc, a) => acc + Number(a.amount_applied), 0);
  const remainingBalanceAcrossInvoices = allocations.reduce(
    (acc, a) => acc + (balanceById.get(a.invoice_id) ?? 0),
    0,
  );

  return (
    <div className="print-clean min-h-screen bg-neutral-100 print:bg-white">
      <PrintToolbar paymentId={payment.id} />

      <div
        className="relative mx-auto my-6 max-w-4xl bg-white p-8 text-[12px] text-neutral-900 shadow print:my-0 print:max-w-none print:p-6 print:shadow-none"
        style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
      >
        {payment.status === 'cancelled' ? (
          <div className="mb-3 rounded border-2 border-dashed border-red-400 bg-red-50 p-2 text-center text-sm font-semibold text-red-800">
            {t('cancelledWatermark')}
          </div>
        ) : null}

        <div className="mb-1 text-right text-[10px] text-neutral-600">{t('pageLabel')}</div>

        {/* TITLE */}
        <div className="relative border-b-2 border-black pb-2 text-center">
          <div className="text-2xl font-bold tracking-widest">{t('docTitle')}</div>
          <div className="absolute right-0 top-0 border border-black px-2 py-0.5 text-[10px] tracking-widest">
            {t('originalCopy')}
          </div>
        </div>

        {/* SELLER */}
        <div className="mt-3 text-center">
          <div className="text-lg font-bold tracking-wide">{seller.legal_name ?? '—'}</div>
          <div className="text-xs text-neutral-700">
            {sellerAddr}
            {sellerPincode ? `-${sellerPincode}` : ''}
          </div>
          <div className="mt-0.5 text-xs text-neutral-700">
            {seller.mobile ? `${t('mobileLabel')}: +91 ${seller.mobile}` : null}
            {seller.email ? ` | ${t('emailLabel')}: ${seller.email}` : null}
          </div>
          <div className="text-xs text-neutral-700">
            {seller.gstin ? `${t('gstinLabel')} - ${seller.gstin}` : null}
            {seller.pan ? ` | ${t('panLabel')} - ${seller.pan}` : null}
          </div>
        </div>

        {/* RECEIPT META */}
        <div className="mt-3 grid grid-cols-2 border border-black text-xs">
          <div className="border-r border-black p-2">
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">
              {t('receivedFromLabel')}
            </div>
            <div className="font-bold">{customer.business_name ?? customer.full_name ?? '—'}</div>
            {customer.business_name && customer.full_name ? (
              <div className="text-neutral-700">{customer.full_name}</div>
            ) : null}
            <div className="text-neutral-700">{customerAddr || '—'}</div>
            <div className="mt-1 text-neutral-700">
              {customer.gstin ? `${t('gstinLabel')}: ${customer.gstin}` : ''}
              {customer.gstin && customer.mobile ? ' | ' : ''}
              {customer.mobile ? `${t('mobileLabel')}: +91 ${customer.mobile}` : ''}
            </div>
          </div>
          <div className="p-2">
            <table className="w-full text-xs">
              <tbody>
                <tr>
                  <td className="py-0.5 text-neutral-600">{t('numberLabel')}</td>
                  <td className="py-0.5 font-mono font-semibold">
                    : {payment.payment_number ?? '—'}
                  </td>
                </tr>
                <tr>
                  <td className="py-0.5 text-neutral-600">{t('dateLabel')}</td>
                  <td className="py-0.5">: {fmtDate(payment.payment_date, locale)}</td>
                </tr>
                <tr>
                  <td className="py-0.5 text-neutral-600">{t('methodLabel')}</td>
                  <td className="py-0.5">: {tPay(METHOD_KEYS[payment.payment_method])}</td>
                </tr>
                {payment.reference_no ? (
                  <tr>
                    <td className="py-0.5 text-neutral-600">{t('referenceLabel')}</td>
                    <td className="py-0.5 font-mono">: {payment.reference_no}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {/* AMOUNT */}
        <div className="mt-3 rounded border border-black p-3 text-center">
          <div className="text-[11px] uppercase tracking-wide text-neutral-600">
            {t('amountReceivedLabel')}
          </div>
          <div className="text-2xl font-bold" style={numericFont}>
            {formatRupees(Number(payment.amount), locale)}
          </div>
          <div className="text-xs italic text-neutral-700">{amountWords}</div>
        </div>

        {/* INVOICES SETTLED */}
        <table className="mt-3 w-full border-collapse border border-black text-xs">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border border-black p-1">{t('snoLabel')}</th>
              <th className="border border-black p-1 text-left">{t('invoiceColumn')}</th>
              <th className="border border-black p-1">{t('invoiceDateColumn')}</th>
              <th className="border border-black p-1 text-right">{t('invoiceTotalColumn')}</th>
              <th className="border border-black p-1 text-right">{t('appliedColumn')}</th>
              <th className="border border-black p-1 text-right">{t('balanceColumn')}</th>
            </tr>
          </thead>
          <tbody>
            {allocations.map((a, idx) => {
              const inv = a.invoice;
              const balance = balanceById.get(a.invoice_id) ?? 0;
              return (
                <tr key={a.id}>
                  <td className="border border-black p-1 text-center" style={numericFont}>
                    {idx + 1}
                  </td>
                  <td className="border border-black p-1 font-mono">
                    {inv?.invoice_number ?? '—'}
                  </td>
                  <td className="border border-black p-1 text-center" style={numericFont}>
                    {fmtDate(inv?.invoice_date ?? null, locale)}
                  </td>
                  <td className="border border-black p-1 text-right" style={numericFont}>
                    {inv ? Number(inv.grand_total).toFixed(2) : '—'}
                  </td>
                  <td
                    className="border border-black p-1 text-right font-semibold"
                    style={numericFont}
                  >
                    {Number(a.amount_applied).toFixed(2)}
                  </td>
                  <td className="border border-black p-1 text-right" style={numericFont}>
                    {balance.toFixed(2)}
                  </td>
                </tr>
              );
            })}
            <tr className="font-semibold">
              <td colSpan={4} className="border border-black p-1 text-right">
                {t('totalAppliedLabel')}
              </td>
              <td className="border border-black p-1 text-right" style={numericFont}>
                {totalAllocated.toFixed(2)}
              </td>
              <td className="border border-black p-1 text-right" style={numericFont}>
                {remainingBalanceAcrossInvoices.toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>

        {payment.notes ? (
          <div className="mt-3 border-t border-neutral-300 pt-2 text-xs">
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">
              {t('notesLabel')}
            </div>
            <div className="whitespace-pre-wrap">{payment.notes}</div>
          </div>
        ) : null}

        {/* FOOTER */}
        <div className="mt-6 grid grid-cols-2 border-t border-neutral-300 pt-3 text-xs">
          <div>
            <div className="italic">{t('thankYou')}</div>
          </div>
          <div className="text-right">
            <div className="mb-10">
              {t('forLabel')} <strong>{seller.legal_name ?? '—'}</strong>
            </div>
            <div className="border-t border-black pt-1">{t('signatoryLabel')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
