/**
 * Deterministic SKU code generation. See docs/data-model-inventory.md §1
 * "SKU code generation".
 *
 *   Single: JP-${design_no}-${pack_size, 2-digit}     → JP-1325-06
 *   Mix:    JP-MIX-${mix_code}-${pack_size}           → JP-MIX-FEST-12
 *
 * The code is generated once at create time and stored in skus.sku_code.
 * design_no / mix_code / pack_type / pack_size are locked after create so the
 * QR-encoded label on physical stock stays valid (see ADR-009).
 *
 * Generation is intentionally a pure utility (no DB call): the live preview
 * on /skus/new updates as the user types, and the create RPC stores whatever
 * the client passes through after re-validating shape.
 */

export type PackType = 'single' | 'mix';

export interface SingleSkuInput {
  pack_type: 'single';
  design_no: string;
  pack_size: number;
}

export interface MixSkuInput {
  pack_type: 'mix';
  mix_code: string;
  pack_size: number;
}

export type SkuCodeInput = SingleSkuInput | MixSkuInput;

function normaliseToken(s: string): string {
  return s.trim().toUpperCase();
}

export function generateSkuCode(input: SkuCodeInput): string {
  if (input.pack_type === 'single') {
    const design = normaliseToken(input.design_no);
    const pack = String(input.pack_size).padStart(2, '0');
    return `JP-${design}-${pack}`;
  }
  const mix = normaliseToken(input.mix_code);
  return `JP-MIX-${mix}-${input.pack_size}`;
}
