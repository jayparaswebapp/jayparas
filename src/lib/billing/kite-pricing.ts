import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Everything the invoice / order forms need to price kite lines:
 *   - product group → name, company, default HSN + GST %
 *   - company → % for party type A / B / C (set once in Kite setup)
 *   - party → type (A/B/C, default C)
 *   - party → company → own % (overrides the type % for that party only)
 *
 * Only used to fill NEW lines (and lines re-priced when the party changes).
 * Saved bill lines keep their own rate / discount / HSN / GST, so changing
 * any of these later never touches a bill already made.
 */
export type PriceTier = 'A' | 'B' | 'C';

export interface KitePricing {
  groups: Record<string, { name: string; company_id: string; hsn_code: string; gst_pct: number }>;
  /** Party's own % per company (override). */
  discounts: Record<string, Record<string, number>>;
  /** Company → % by party type. */
  tierRates: Record<string, Record<PriceTier, number>>;
  /** Party → type; parties not listed are C. */
  tiers: Record<string, PriceTier>;
}

export const EMPTY_KITE_PRICING: KitePricing = {
  groups: {},
  discounts: {},
  tierRates: {},
  tiers: {},
};

/** Discount % for a party on a company: party's own % if set, else its type's %. */
export function kiteDiscountFor(
  p: KitePricing,
  customerId: string | null | undefined,
  companyId: string,
): number {
  if (!customerId) return 0;
  const own = p.discounts[customerId]?.[companyId];
  if (own !== undefined) return own;
  const tier = p.tiers[customerId] ?? 'C';
  return p.tierRates[companyId]?.[tier] ?? 0;
}

/** Parties of type A / B (everyone else is C) — paged past the 1000-row cap. */
async function loadNonCTiers(supabase: SupabaseClient): Promise<Record<string, PriceTier>> {
  const PAGE = 1000;
  const out: Record<string, PriceTier> = {};
  for (let page = 0; page < 50; page += 1) {
    const { data, error } = await supabase
      .from('billing_customers')
      .select('id, price_tier')
      .neq('price_tier', 'C')
      .order('id', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error || !data) break;
    for (const r of data as { id: string; price_tier: PriceTier }[]) out[r.id] = r.price_tier;
    if (data.length < PAGE) break;
  }
  return out;
}

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
  const [{ data: gs }, ds, { data: cs }, tiers] = await Promise.all([
    supabase
      .from('product_groups')
      .select('id, name, company_id, hsn_code, gst_pct')
      .is('deleted_at', null),
    loadAllDiscounts(supabase),
    supabase.from('kite_companies').select('id, disc_a, disc_b, disc_c').is('deleted_at', null),
    loadNonCTiers(supabase),
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

  const tierRates: KitePricing['tierRates'] = {};
  for (const c of (cs ?? []) as {
    id: string;
    disc_a: number | string;
    disc_b: number | string;
    disc_c: number | string;
  }[]) {
    tierRates[c.id] = { A: Number(c.disc_a), B: Number(c.disc_b), C: Number(c.disc_c) };
  }

  return { groups, discounts, tierRates, tiers };
}
