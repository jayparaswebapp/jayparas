/**
 * Unit tests for the SKU code generator.
 *
 * Run with: npm run test:skus
 * (which executes `tsx src/lib/skus/code.test.ts`.)
 *
 * Intentionally minimal: no test framework, just node:assert. The generator
 * is a pure utility and only has two branches (single / mix) to cover.
 */

import assert from 'node:assert/strict';
import { generateSkuCode } from './code';

// --- v2 single packs (design_no dropped, suffix derives from pack_size + rate_unit) ---

assert.equal(
  generateSkuCode({ pack_type: 'single', design_name: 'Dori', pack_size: 6, rate_unit: 'piece' }),
  'DORI-06',
  'single v2: pack_size 6 → 06',
);

assert.equal(
  generateSkuCode({ pack_type: 'single', design_name: 'Dori', pack_size: 3, rate_unit: 'piece' }),
  'DORI-03',
  'single v2: pack_size 3 → 03',
);

assert.equal(
  generateSkuCode({ pack_type: 'single', design_name: 'Dori', pack_size: 1, rate_unit: 'piece' }),
  'DORI-01',
  'single v2: pack_size 1 → 01',
);

assert.equal(
  generateSkuCode({ pack_type: 'single', design_name: 'Dori', pack_size: 12, rate_unit: 'pack' }),
  'DORI-DOZ',
  'single v2: pack_size 12 + rate_unit pack → DOZ suffix',
);

assert.equal(
  generateSkuCode({ pack_type: 'single', design_name: 'Dori', pack_size: 12, rate_unit: 'piece' }),
  'DORI-12P',
  'single v2: pack_size 12 + rate_unit piece → 12P suffix',
);

assert.equal(
  generateSkuCode({
    pack_type: 'single',
    design_name: 'Festive Necklace',
    pack_size: 6,
    rate_unit: 'piece',
  }),
  'FESTIVENECKLACE-06',
  'single v2: design_name spaces collapsed and upper-cased',
);

assert.equal(
  generateSkuCode({ pack_type: 'single', design_name: 'dori', pack_size: 1, rate_unit: 'piece' }),
  'DORI-01',
  'single v2: design_name is normalised even when lowercase',
);

// rate_unit is optional in the input type (legacy bulk-create call sites that
// don't pass it). When omitted, treat as 'piece'.
assert.equal(
  generateSkuCode({ pack_type: 'single', design_name: 'Dori', pack_size: 6 }),
  'DORI-06',
  'single v2: rate_unit omitted defaults to piece',
);

// --- mix packs (legacy code path, no UI to create new ones but generator still supports) ---

assert.equal(
  generateSkuCode({
    pack_type: 'mix',
    design_name: 'Festive mix',
    mix_code: 'FEST',
    pack_size: 12,
  }),
  'FESTIVEMIX-FEST-12',
  'mix: Festive mix / FEST / 12 → FESTIVEMIX-FEST-12',
);

assert.equal(
  generateSkuCode({
    pack_type: 'mix',
    design_name: 'Festive mix',
    mix_code: 'fest',
    pack_size: 12,
  }),
  'FESTIVEMIX-FEST-12',
  'mix: mix_code is upper-cased',
);

assert.equal(
  generateSkuCode({
    pack_type: 'mix',
    design_name: 'Festive mix',
    mix_code: ' fest ',
    pack_size: 6,
  }),
  'FESTIVEMIX-FEST-6',
  'mix: mix_code is trimmed; pack_size is not zero-padded for mix',
);

// eslint-disable-next-line no-console
console.log('All SKU code tests passed.');
