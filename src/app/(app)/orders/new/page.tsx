import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { getServerLocale } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader } from '@/components/page-header';
import type { KitePricing } from '@/lib/billing/kite-pricing';
import type { CustomerOption, SkuOption } from '@/app/(app)/billing/invoices/invoice-form';
import { loadOrderFormData, ORDER_ROLES } from '@/lib/orders/load';
import { OrderForm } from '../order-form';

export const dynamic = 'force-dynamic';

export default async function NewOrderPage() {
  await requireRole(ORDER_ROLES);
  const locale = getServerLocale();
  const data = await loadOrderFormData(createClient());
  return <NewOrderView {...data} locale={locale} />;
}

function NewOrderView({
  customers,
  skus,
  kitePricing,
  locale,
}: {
  customers: CustomerOption[];
  skus: SkuOption[];
  kitePricing: KitePricing;
  locale: Locale;
}) {
  const t = useTranslations('orders.form');
  return (
    <>
      <PageHeader title={t('createTitle')} />
      <OrderForm
        initial={{ business_line: 'kite', customer_id: '', notes: '', lines: [] }}
        customers={customers}
        skus={skus}
        kitePricing={kitePricing}
        locale={locale}
      />
    </>
  );
}
