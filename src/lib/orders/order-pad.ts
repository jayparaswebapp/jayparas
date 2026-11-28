import type { SkuOption } from '@/app/(app)/billing/invoices/invoice-form';

/**
 * Order pad = the paper kite order sheet as a grid.
 *
 * Kite products are named "<Brand> <cord>/<size> <Mtr|Gms>. <code>", e.g.
 * "24 Carat 9/900 Mtr. 540B". Rows are brands, columns are size × cord.
 * Built from the product names, so a new product gets its box automatically.
 * Products that don't follow the pattern (ready kites, firki, ...) go in a
 * plain list grouped by product group.
 */

const NAME_RE = /^(.*?)\s*(\d+)\s*\/\s*(\d+)\s*(mtr|mts|mt|gms|gm)\b\.*\s*(.*)$/i;

/**
 * Row order of the paper order sheet (brand names as the grid shows them,
 * matched case-insensitively). Brands not listed follow, A–Z.
 */
const SHEET_ROWS = [
  'Griffin',
  'Bear',
  'Sankal',
  'Super Sankal',
  'Maha Sankal',
  '24 Carat',
  'Challenge',
  'Agni',
  'AK-56 Marvel',
  'Supreme Panda',
  'AK-56 Platinum Plus',
  'Gun',
  'Panda',
  'Panda (2)',
  'Panda (5)',
  'Rocket',
  'Krishna',
  'Kalachand',
  'NSG AK-56',
  'AK-56 Gold',
  'Tejas',
  'Chain',
  'Mashaal',
  'Tez',
  'Ninja',
  'Falcon',
  'AK-56',
  'King Panda',
  'AK-56 Diamond',
  'Rangeela Panda',
  'Yuva',
  'Organica Panda',
  'Titanium Panda',
  'Palladium',
  'Panda Gold',
  'Platinum Panda',
  'Vardhman',
].map((b) => b.toUpperCase());

function rowRank(key: string): number {
  const i = SHEET_ROWS.indexOf(key);
  return i >= 0 ? i : SHEET_ROWS.length;
}

/** Sheet order first; then other lengths, then other weights. */
const FIRST_SIZES = ['900 Mtr', '250 Gms', '500 Gms'];

export interface PadColumn {
  key: string; // `${size}|${cord}`
  size: string; // "900 Mtr"
  cord: number;
}

export interface PadSizeGroup {
  size: string;
  columns: PadColumn[];
}

export interface PadRow {
  key: string;
  brand: string;
  /** column key → products in that box (more than one = variants, e.g. No.1 / No.2). */
  cells: Record<string, { sku: SkuOption; variant: string }[]>;
}

export interface PadLayout {
  sizeGroups: PadSizeGroup[];
  rows: PadRow[];
  /** Products not in the grid, by group name. */
  others: { group: string; skus: SkuOption[] }[];
  /** product id → size group key it belongs to (for "pieces per box"). */
  sizeOf: Record<string, string>;
}

function niceBrand(raw: string): string {
  const b = raw.replace(/\s+/g, ' ').trim();
  // "GRIFFIN" → "Griffin"; leave mixed names like "NSG AK-56" alone.
  if (/^[A-Z]{3,}$/.test(b)) return b.charAt(0) + b.slice(1).toLowerCase();
  return b;
}

/** "548G- No.-2" → "No.2", "750A Blk" → "Blk"; else the text as-is. */
function variantLabel(rest: string): string {
  const parts: string[] = [];
  const no = /no\.?\s*-?\s*(\d+)/i.exec(rest);
  if (no) parts.push(`No.${no[1]}`);
  if (/\b(blk|black)\b/i.test(rest)) parts.push('Blk');
  if (/v\s*cone/i.test(rest)) parts.push('V Cone');
  return parts.length > 0 ? parts.join(' ') : rest;
}

export function parseKiteName(
  name: string,
): { brand: string; cord: number; size: string; rest: string } | null {
  const m = NAME_RE.exec(name.trim());
  if (!m) return null;
  const brand = niceBrand(m[1] ?? '');
  if (!brand) return null;
  const cord = Number(m[2]);
  const value = Number(m[3]);
  let unit = /^g/i.test(m[4] ?? '') ? 'Gms' : 'Mtr';
  // "9/250 Mtr" / "9/500 Mtr" in the product list mean grams.
  if (unit === 'Mtr' && (value === 250 || value === 500)) unit = 'Gms';
  return { brand, cord, size: `${value} ${unit}`, rest: (m[5] ?? '').trim() };
}

function sizeRank(size: string): [number, number, number] {
  const i = FIRST_SIZES.indexOf(size);
  const [v, u] = size.split(' ');
  return [i >= 0 ? i : 99, u === 'Mtr' ? 0 : 1, Number(v)];
}

export function buildPadLayout(skus: SkuOption[], groupName: (s: SkuOption) => string): PadLayout {
  const rows = new Map<string, PadRow>();
  const cordsBySize = new Map<string, Set<number>>();
  const others = new Map<string, SkuOption[]>();
  const sizeOf: Record<string, string> = {};

  for (const s of skus) {
    const p = parseKiteName(s.design_name);
    if (!p) {
      const g = groupName(s) || '—';
      others.set(g, [...(others.get(g) ?? []), s]);
      continue;
    }
    const rowKey = p.brand.toUpperCase();
    const colKey = `${p.size}|${p.cord}`;
    const row = rows.get(rowKey) ?? { key: rowKey, brand: p.brand, cells: {} };
    row.cells[colKey] = [
      ...(row.cells[colKey] ?? []),
      { sku: s, variant: variantLabel(p.rest) || s.sku_code },
    ];
    rows.set(rowKey, row);
    cordsBySize.set(p.size, (cordsBySize.get(p.size) ?? new Set()).add(p.cord));
    sizeOf[s.id] = p.size;
  }

  const sizeGroups: PadSizeGroup[] = Array.from(cordsBySize.entries())
    .sort((a, b) => {
      const ra = sizeRank(a[0]);
      const rb = sizeRank(b[0]);
      return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
    })
    .map(([size, cords]) => ({
      size,
      columns: Array.from(cords)
        .sort((x, y) => x - y)
        .map((cord) => ({ key: `${size}|${cord}`, size, cord })),
    }));

  return {
    sizeGroups,
    rows: Array.from(rows.values()).sort(
      (a, b) => rowRank(a.key) - rowRank(b.key) || a.brand.localeCompare(b.brand),
    ),
    others: Array.from(others.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([group, list]) => ({
        group,
        skus: list.sort((a, b) => a.design_name.localeCompare(b.design_name)),
      })),
    sizeOf,
  };
}
