import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { getServerLocale } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';
import { PageHeader } from '@/components/page-header';
import { BillForm, type BillFormValues, type ItemOption, type SupplierOption } from '../bill-form';

export const dynamic = 'force-dynamic';

export default async function NewBillPage() {
  await requireRole(['super_admin', 'supervisor']);
  const locale = getServerLocale();
  const supabase = createClient();

  const [{ data: ss }, { data: its }, { data: company }] = await Promise.all([
    supabase
      .from('suppliers')
      .select('id, full_name, business_name, state')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('full_name', { ascending: true }),
    supabase
      .from('purchase_items')
      .select('id, item_code, name, uom, hsn_code, default_rate, default_gst_pct')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('item_code', { ascending: true }),
    supabase.from('company_info').select('state').maybeSingle(),
  ]);

  const suppliers: SupplierOption[] = (ss ?? []).map((s) => {
    const base = s.business_name ? `${s.business_name} — ${s.full_name}` : s.full_name;
    return { id: s.id, label: base, state: s.state };
  });
  const items: ItemOption[] = (its ?? []).map((it) => ({
    id: it.id,
    item_code: it.item_code,
    name: it.name,
    uom: it.uom,
    hsn_code: it.hsn_code,
    default_rate: Number(it.default_rate),
    default_gst_pct: Number(it.default_gst_pct),
  }));

  const initial: BillFormValues = {
    business_line: 'rakhi',
    supplier_id: null,
    supplier_bill_number: '',
    bill_date: new Date().toISOString().slice(0, 10),
    place_of_supply: '',
    notes: '',
    lines: [],
  };

  return (
    <NewView
      initial={initial}
      suppliers={suppliers}
      items={items}
      buyerState={company?.state ?? null}
      locale={locale}
    />
  );
}

function NewView({
  initial,
  suppliers,
  items,
  buyerState,
  locale,
}: {
  initial: BillFormValues;
  suppliers: SupplierOption[];
  items: ItemOption[];
  buyerState: string | null;
  locale: Locale;
}) {
  const t = useTranslations('purchases.bills.form');
  return (
    <>
      <PageHeader title={t('createTitle')} />
      <BillForm
        initial={initial}
        suppliers={suppliers}
        items={items}
        buyerState={buyerState}
        locale={locale}
      />
    </>
  );
}
