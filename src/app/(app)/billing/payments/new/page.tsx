import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { getServerLocale } from '@/lib/format/locale';
import { PageHeader } from '@/components/page-header';
import { PaymentForm, type CustomerOption, type InvoiceBalanceOption } from '../payment-form';

export const dynamic = 'force-dynamic';

export default async function NewPaymentPage() {
  await requireRole(['super_admin', 'supervisor']);
  const locale = getServerLocale();
  const supabase = createClient();

  const [{ data: cs }, { data: bs }] = await Promise.all([
    supabase
      .from('billing_customers')
      .select('id, full_name, business_name, city')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('full_name', { ascending: true }),
    supabase
      .from('invoice_balances')
      .select(
        'invoice_id, invoice_number, customer_id, invoice_date, grand_total, amount_paid, balance_due',
      )
      .gt('balance_due', 0)
      .order('invoice_date', { ascending: true }),
  ]);

  const customers: CustomerOption[] = (cs ?? []).map((c) => {
    const base = c.business_name ? `${c.business_name} — ${c.full_name}` : c.full_name;
    const label = c.city ? `${base} (${c.city})` : base;
    return { id: c.id, label };
  });
  const balances: InvoiceBalanceOption[] = (bs ?? []).map((b) => ({
    invoice_id: b.invoice_id as string,
    invoice_number: (b.invoice_number as string | null) ?? null,
    customer_id: b.customer_id as string,
    invoice_date: b.invoice_date as string,
    grand_total: Number(b.grand_total),
    amount_paid: Number(b.amount_paid),
    balance_due: Number(b.balance_due),
  }));

  return <NewView customers={customers} balances={balances} locale={locale} />;
}

function NewView({
  customers,
  balances,
  locale,
}: {
  customers: CustomerOption[];
  balances: InvoiceBalanceOption[];
  locale: 'en' | 'gu';
}) {
  const t = useTranslations('billing.payments.form');
  return (
    <>
      <PageHeader title={t('createTitle')} />
      <PaymentForm customers={customers} balances={balances} locale={locale} />
    </>
  );
}
