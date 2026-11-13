import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Everything the invoice form needs to price kite lines:
 *   - product group → name, company, default HSN + GST %
 *   - party → company → discount %  (missing = 0%)
 *
 * Only used to fill NEW lines (and lines re-priced when the party changes).
 * Saved bill lines keep their own rate / discount / HSN / GST, so changing
 * any of these later never touches a bill already made.
 */
export interface KitePricing {
  groups: Record<string, { name: string; company_id: string; hsn_code: string; gst_pct: number }>;
  discounts: Record<string, Record<string, number>>;
}

export const EMPTY_KITE_PRICING: KitePricing = { groups: {}, discounts: {} };

/**
 * Party discounts can pass PostgREST's 1000-row response cap (parties ×
 * companies), so read them in pages — a silently missing row would bill a
 * party at 0% without any error.
 */
async function loadAllDiscounts(
  supabase: SupabaseClient,
): Promise<Array<{ customer_id: string; company_id: string; discount_pct: number | string }>> {
  const PAGE = 1000;
  const out: Array<{ customer_id: string; company_id: string; discount_pct: number | string }> = [];
  for (let page = 0; page < 50; page += 1) {
    const { data, error } = await supabase
      .from('customer_company_discounts')
      .select('customer_id, company_id, discount_pct')
      .order('id', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error || !data) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

export async function loadKitePricing(supabase: SupabaseClient): Promise<KitePricing> {
  const [{ data: gs }, ds] = await Promise.all([
    supabase
      .from('product_groups')
      .select('id, name, company_id, hsn_code, gst_pct')
      .is('deleted_at', null),
    loadAllDiscounts(supabase),
  ]);

  const groups: KitePricing['groups'] = {};
  for (const g of gs ?? []) {
    groups[g.id] = {
      name: g.name,
      company_id: g.company_id,
      hsn_code: g.hsn_code ?? '',
      gst_pct: Number(g.gst_pct ?? 0),
    };
  }

  const discounts: KitePricing['discounts'] = {};
  for (const d of ds) {
    (discounts[d.customer_id] ??= {})[d.company_id] = Number(d.discount_pct);
  }

  return { groups, discounts };
}
