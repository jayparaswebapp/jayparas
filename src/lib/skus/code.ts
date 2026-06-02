/**
 * Deterministic SKU code generation. See docs/data-model-inventory.md §1
 * "SKU code generation".
 *
 *   Single: ${design_name}-${design_no}-${pack_size, 2-digit}
 *           → DORI-1325-06
 *   Mix:    ${design_name}-${mix_code}-${pack_size}
 *           → FESTIVEMIX-FEST-12
 *
 * The code is generated once at create time and stored in skus.sku_code.
 * design_name / design_no / mix_code / pack_type / pack_size are locked
 * after create so the QR-encoded label on physical stock stays valid.
 *
 * Generation is intentionally a pure utility (no DB call): the live preview
 * on /skus/new updates as the user types, and the create RPC stores whatever
 * the client passes through after re-validating shape.
 */

export type PackType = 'single' | 'mix';

export interface SingleSkuInput {
  pack_type: 'single';
  design_name: string;
  design_no: string;
  pack_size: number;
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

export function generateSkuCode(input: SkuCodeInput): string {
  const name = normaliseName(input.design_name);
  if (input.pack_type === 'single') {
    const design = normaliseToken(input.design_no);
    const pack = String(input.pack_size).padStart(2, '0');
    return `${name}-${design}-${pack}`;
  }
  const mix = normaliseToken(input.mix_code);
  return `${name}-${mix}-${input.pack_size}`;
}
