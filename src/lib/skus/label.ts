/**
 * Pure helpers for the three label rows. The label has a fixed 25×15 mm cell
 * (see label-grid.ts) with QR on the right; these helpers compose the three
 * left-side text rows from a SKU row.
 *
 * Mapping conventions (locked at v1):
 *   item name → "<design_name> <design_no>" for single packs, "<design_name>
 *               <mix_code>" for mix packs. The trailing token mirrors what's
 *               encoded into the QR so a human can sanity-check by eye.
 *   rate      → "₹132/-" for whole rupees, "₹132.50" when paise are present.
 *               The "/-" suffix matches the Indian rupee shorthand the user
 *               drew on the spec.
 *   unit      → "1 Doz" for whole-dozen multiples, "N pcs" otherwise.
 */

export interface SkuLabelInput {
  pack_type: 'single' | 'mix';
  design_no: string | null;
  mix_code: string | null;
  design_name: string;
  pack_size: number;
  price: number;
  sku_code: string;
}

export function labelItemName(sku: SkuLabelInput): string {
  const ident = sku.pack_type === 'single' ? sku.design_no : sku.mix_code;
  if (ident && ident.length > 0) return `${sku.design_name} ${ident}`;
  return sku.design_name;
}

export function labelRate(price: number): string {
  const isWhole = Number.isInteger(price);
  if (isWhole) return `₹${price}/-`;
  return `₹${price.toFixed(2)}`;
}

export function labelUnit(pack_size: number): string {
  if (pack_size > 0 && pack_size % 12 === 0) {
    const dozens = pack_size / 12;
    return `${dozens} Doz`;
  }
  return `${pack_size} pcs`;
}
