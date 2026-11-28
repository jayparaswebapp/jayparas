import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { getServerLocale } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader } from '@/components/page-header';
import type { KitePricing } from '@/lib/billing/kite-pricing';
import type { CustomerOption, SkuOption } from '@/app/(app)/billing/invoices/invoice-form';
import { loadOrderFormData, ORDER_ROLES } from '@/lib/orders/load';
import { OrderPad } from './order-pad';

export const dynamic = 'force-dynamic';

export default async function OrderPadPage() {
  await requireRole(ORDER_ROLES);
  const locale = getServerLocale();
  const data = await loadOrderFormData(createClient());
  return (
    <OrderPadView
      customers={data.customers}
      skus={data.skus.filter((s) => s.business_line === 'kite')}
      kitePricing={data.kitePricing}
      locale={locale}
    />
  );
}

function OrderPadView({
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
  const t = useTranslations('orders.pad');
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('intro')} />
      <OrderPad customers={customers} skus={skus} kitePricing={kitePricing} locale={locale} />
    </>
  );
}
