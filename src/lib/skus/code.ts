/**
 * Deterministic SKU code generation. See docs/data-model-inventory.md §1
 * "SKU code generation".
 *
 *   Single (v2): ${design_name}-${pack_code}
 *                → DORI-06     (6-pcs pack, rate per piece)
 *                → DORI-DOZ    (1-dozen pack, rate per dozen)
 *                → DORI-12P    (12-pcs pack, rate per piece)
 *   Single (v1, kept for backward compat with existing rows):
 *                ${design_name}-${design_no}-${pack_size, 2-digit}
 *                → DORI-1325-06
 *   Mix (legacy, no UI for new mix SKUs):
 *                ${design_name}-${mix_code}-${pack_size}
 *                → FESTIVEMIX-FEST-12
 *
 * The code is generated once at create time and stored in skus.sku_code.
 * design_name / pack_size / rate_unit are locked after create so the
 * QR-encoded label on physical stock stays valid.
 *
 * Generation is intentionally a pure utility (no DB call): the live preview
 * on /skus/new updates as the user types, and the create RPC stores whatever
 * the client passes through after re-validating shape.
 */

export type PackType = 'single' | 'mix';
export type RateUnit = 'pack' | 'piece';

export interface SingleSkuInput {
  pack_type: 'single';
  design_name: string;
  /** Legacy field — ignored when generating v2 codes but still in the type
   *  for older call sites that pass it. */
  design_no?: string;
  pack_size: number;
  rate_unit?: RateUnit;
}

export interface MixSkuInput {
  pack_type: 'mix';
  design_name: string;
  mix_code: string;
  pack_size: number;
}

export type SkuCodeInput = SingleSkuInput | MixSkuInput;

function normaliseToken(s: string): string {
  return s.trim().toUpperCase();
}

function normaliseName(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * pack_size + rate_unit → pack-code suffix:
 *   pack_size <12:                 zero-padded number  "01" "03" "04" "06"
 *   pack_size 12, rate_unit=pack:  "DOZ"   (sold as one dozen, rate per dozen)
 *   pack_size 12, rate_unit=piece: "12P"   (sold loose, rate per piece × 12)
 *   anything else (forward-compat): zero-padded number
 */
function packCodeSuffix(pack_size: number, rate_unit: RateUnit): string {
  if (pack_size === 12 && rate_unit === 'pack') return 'DOZ';
  if (pack_size === 12 && rate_unit === 'piece') return '12P';
  return String(pack_size).padStart(2, '0');
}

export function generateSkuCode(input: SkuCodeInput): string {
  const name = normaliseName(input.design_name);
  if (input.pack_type === 'single') {
    const pack = packCodeSuffix(input.pack_size, input.rate_unit ?? 'piece');
    return `${name}-${pack}`;
  }
  const mix = normaliseToken(input.mix_code);
  return `${name}-${mix}-${input.pack_size}`;
}
