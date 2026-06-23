import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { getServerLocale } from '@/lib/format/locale';
import { PageHeader } from '@/components/page-header';
import {
  InvoiceForm,
  type CustomerOption,
  type InvoiceFormValues,
  type SkuOption,
} from '../invoice-form';

export const dynamic = 'force-dynamic';

export default async function NewInvoicePage() {
  await requireRole(['super_admin', 'supervisor']);
  const locale = getServerLocale();
  const supabase = createClient();

  const [{ data: cs }, { data: ss }, { data: company }] = await Promise.all([
    supabase
      .from('billing_customers')
      .select('id, full_name, business_name, city, state')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('full_name', { ascending: true }),
    supabase
      .from('skus')
      .select(
        'id, sku_code, design_name, pack_size, price, discount_pct, is_discountable, rate_unit',
      )
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('design_name', { ascending: true }),
    supabase.from('company_info').select('state').maybeSingle(),
  ]);

  const customers: CustomerOption[] = (cs ?? []).map((c) => {
    const base = c.business_name ? `${c.business_name} — ${c.full_name}` : c.full_name;
    const label = c.city ? `${base} (${c.city})` : base;
    return { id: c.id, label, city: c.city, state: c.state };
  });
  const skus: SkuOption[] = (ss ?? []).map((s) => ({
    id: s.id,
    sku_code: s.sku_code,
    design_name: s.design_name,
    pack_size: s.pack_size,
    price: Number(s.price),
    discount_pct: Number(s.discount_pct ?? 0),
    is_discountable: Boolean(s.is_discountable),
    rate_unit: (s.rate_unit === 'pack' ? 'pack' : 'piece') as 'pack' | 'piece',
  }));

  const initial: InvoiceFormValues = {
    business_line: 'rakhi',
    customer_id: null,
    invoice_date: new Date().toISOString().slice(0, 10),
    place_of_supply: '',
    notes: '',
    terms: '',
    packing_charges: '0',
    delivery_charges: '0',
    lines: [],
  };

  return (
    <NewView
      initial={initial}
      customers={customers}
      skus={skus}
      sellerState={company?.state ?? null}
      locale={locale}
    />
  );
}

function NewView({
  initial,
  customers,
  skus,
  sellerState,
  locale,
}: {
  initial: InvoiceFormValues;
  customers: CustomerOption[];
  skus: SkuOption[];
  sellerState: string | null;
  locale: 'en' | 'gu';
}) {
  const t = useTranslations('billing.invoices.form');
  return (
    <>
      <PageHeader title={t('createTitle')} />
      <InvoiceForm
        initial={initial}
        customers={customers}
        skus={skus}
        sellerState={sellerState}
        locale={locale}
      />
    </>
  );
}
