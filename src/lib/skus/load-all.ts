import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A single PostgREST request returns at most 1000 rows. Once the catalogue
 * passed 1000 SKUs, every screen that loaded "all SKUs" in one query started
 * silently dropping the tail of its sort order — SKUs were present in the
 * database and simply absent from the dropdown, with no error anywhere.
 *
 * These helpers page through instead, so the result is always complete.
 */
const PAGE_SIZE = 1000;

/** Hard stop so a bad filter can never spin forever. 50 pages = 50k rows. */
const MAX_PAGES = 50;

type Row = Record<string, unknown>;

export interface LoadAllSkusOptions {
  /** Comma-separated column list, same string you'd pass to .select(). */
  columns: string;
  /** Column to sort by. */
  orderBy: string;
  ascending?: boolean;
  /** Restrict to active SKUs. Defaults to true. */
  activeOnly?: boolean;
}

/**
 * Load every non-deleted SKU, paging past the 1000-row response cap.
 * Returns rows in the requested order. On error it returns what it has so
 * far rather than throwing, matching how these pages already treat a null
 * `data` — a short list is bad, but a crashed billing screen is worse.
 */
export async function loadAllSkus<T = Row>(
  supabase: SupabaseClient,
  { columns, orderBy, ascending = true, activeOnly = true }: LoadAllSkusOptions,
): Promise<T[]> {
  const out: T[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    let query = supabase
      .from('skus')
      .select(columns)
      .is('deleted_at', null)
      .order(orderBy, { ascending })
      // id keeps the order total, so rows can't shuffle between pages and
      // cause a row to be skipped or fetched twice.
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (activeOnly) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) break;

    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  return out;
}
