import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAllSkus } from '@/lib/skus/load-all';
import { loadKitePricing, type KitePricing } from '@/lib/billing/kite-pricing';
import type { CustomerOption, SkuOption } from '@/app/(app)/billing/invoices/invoice-form';

/** Products, parties and kite pricing for the order form. */
export async function loadOrderFormData(supabase: SupabaseClient): Promise<{
  customers: CustomerOption[];
  skus: SkuOption[];
  kitePricing: KitePricing;
}> {
  const [{ data: cs }, ss, kitePricing] = await Promise.all([
    supabase
      .from('billing_customers')
      .select('id, full_name, business_name, city, state')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('full_name', { ascending: true }),
    loadAllSkus<{
      id: string;
      sku_code: string;
      short_code: number | null;
      design_name: string;
      pack_size: number;
      price: number | string;
      discount_pct: number | string | null;
      is_discountable: boolean | null;
      rate_unit: string | null;
      business_line: string | null;
      product_group_id: string | null;
    }>(supabase, {
      columns:
        'id, sku_code, short_code, design_name, pack_size, price, discount_pct, is_discountable, rate_unit, business_line, product_group_id',
      orderBy: 'design_name',
    }),
    loadKitePricing(supabase),
  ]);

  const customers: CustomerOption[] = (cs ?? []).map((c) => {
    const base = c.business_name ? `${c.business_name} — ${c.full_name}` : c.full_name;
    const label = c.city ? `${base} (${c.city})` : base;
    return { id: c.id, label, city: c.city, state: c.state };
  });

  const skus: SkuOption[] = (ss ?? []).map((s) => ({
    id: s.id,
    sku_code: s.sku_code,
    short_code: s.short_code ?? null,
    design_name: s.design_name,
    pack_size: s.pack_size,
    price: Number(s.price),
    discount_pct: Number(s.discount_pct ?? 0),
    is_discountable: Boolean(s.is_discountable),
    rate_unit: s.rate_unit === 'pack' ? 'pack' : 'piece',
    business_line: s.business_line === 'kite' ? 'kite' : 'rakhi',
    product_group_id: s.product_group_id ?? null,
  }));

  return { customers, skus, kitePricing };
}

export type OrderStatus = 'new' | 'packing' | 'ready' | 'partial' | 'billed' | 'cancelled';

/** Roles allowed into the Orders section. Billing an order needs ORDER_BILL_ROLES. */
export const ORDER_ROLES = ['super_admin', 'supervisor', 'order_staff'] as const;
export const ORDER_BILL_ROLES = ['super_admin', 'supervisor'] as const;
