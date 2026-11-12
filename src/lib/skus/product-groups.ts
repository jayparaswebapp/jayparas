import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Product groups for kite SKUs. A SKU with a product group is a kite SKU;
 * a SKU without one is rakhi. Each group belongs to one company (used only
 * for party discounts). See migration 20261111000001_kite_pricing.sql.
 */
export interface ProductGroupOption {
  id: string;
  name: string;
  company_name: string;
}

export async function loadProductGroupOptions(
  supabase: SupabaseClient,
  includeId?: string | null,
): Promise<ProductGroupOption[]> {
  const { data } = await supabase
    .from('product_groups')
    .select('id, name, is_active, deleted_at, company:kite_companies(name)')
    .is('deleted_at', null)
    .order('name', { ascending: true });

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    name: string;
    is_active: boolean;
    company: { name: string } | null;
  }>;

  return rows
    .filter((g) => g.is_active || g.id === includeId)
    .map((g) => ({ id: g.id, name: g.name, company_name: g.company?.name ?? '' }));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** '' / null → null (rakhi). Otherwise must be a uuid. Returns undefined if invalid. */
export function parseProductGroupId(raw: unknown): string | null | undefined {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (v === '') return null;
  return UUID_RE.test(v) ? v : undefined;
}

/** True if every id is an existing, non-deleted product group. */
export async function productGroupsExist(
  supabase: SupabaseClient,
  ids: string[],
): Promise<boolean> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return true;
  const { data } = await supabase
    .from('product_groups')
    .select('id')
    .in('id', unique)
    .is('deleted_at', null);
  return (data ?? []).length === unique.length;
}

/**
 * Tags SKUs as kite (with a group) or rakhi (no group). Call after the SKU
 * itself is saved.
 */
export async function setSkuProductGroup(
  supabase: SupabaseClient,
  skuIds: string[],
  productGroupId: string | null,
) {
  return supabase.rpc('set_sku_kite_fields', {
    p_sku_ids: skuIds,
    p_business_line: productGroupId ? 'kite' : 'rakhi',
    p_product_group_id: productGroupId,
    p_reason: '',
  });
}
