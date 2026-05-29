/**
 * Unit tests for the label-line helpers. Pure functions, no DOM needed.
 *
 * Run with: npm run test:skus
 */

import assert from 'node:assert/strict';
import { labelItemName, labelRate, labelUnit, type SkuLabelInput } from './label';

function makeSingle(overrides: Partial<SkuLabelInput> = {}): SkuLabelInput {
  return {
    pack_type: 'single',
    design_no: '85',
    mix_code: null,
    design_name: 'Dori',
    pack_size: 12,
    price: 132,
    sku_code: 'JP-85-12',
    ...overrides,
  };
}

function makeMix(overrides: Partial<SkuLabelInput> = {}): SkuLabelInput {
  return {
    pack_type: 'mix',
    design_no: null,
    mix_code: 'FEST',
    design_name: 'Festive mix',
    pack_size: 12,
    price: 300,
    sku_code: 'JP-MIX-FEST-12',
    ...overrides,
  };
}

// --- labelItemName ---

assert.equal(labelItemName(makeSingle()), 'Dori 85', 'single: name + design_no');
assert.equal(labelItemName(makeMix()), 'Festive mix FEST', 'mix: name + mix_code');
assert.equal(
  labelItemName(makeSingle({ design_no: '' })),
  'Dori',
  'single: empty design_no falls back to name only',
);

// --- labelRate ---

assert.equal(labelRate(132), '₹132/-', 'whole rupees use the /- suffix');
assert.equal(labelRate(240), '₹240/-');
assert.equal(labelRate(0), '₹0/-', 'zero rupees still uses /-');
assert.equal(labelRate(132.5), '₹132.50', 'paise show two decimals');
assert.equal(labelRate(132.05), '₹132.05', 'sub-rupee paise preserved');

// --- labelUnit ---

assert.equal(labelUnit(12), '1 Doz', 'pack 12 → 1 Doz');
assert.equal(labelUnit(24), '2 Doz', 'pack 24 → 2 Doz');
assert.equal(labelUnit(6), '6 Pcs', 'pack 6 → 6 Pcs (not 1/2 Doz)');
assert.equal(labelUnit(3), '3 Pcs', 'pack 3 → 3 Pcs');
assert.equal(labelUnit(5), '5 Pcs', 'non-standard pack falls through to Pcs');

// eslint-disable-next-line no-console
console.log('All SKU label-line tests passed.');
