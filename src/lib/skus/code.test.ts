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

// --- single packs ---

assert.equal(
  generateSkuCode({ pack_type: 'single', design_name: 'Dori', design_no: '1325', pack_size: 6 }),
  'DORI-1325-06',
  'single: Dori / 1325 / 6 → DORI-1325-06',
);

assert.equal(
  generateSkuCode({ pack_type: 'single', design_name: 'Dori', design_no: '1325', pack_size: 12 }),
  'DORI-1325-12',
  'single: pack_size 12 should not zero-pad past two digits',
);

assert.equal(
  generateSkuCode({ pack_type: 'single', design_name: 'Dori', design_no: '7', pack_size: 3 }),
  'DORI-7-03',
  'single: short design_no kept as-is; pack_size 3 → 03',
);

assert.equal(
  generateSkuCode({ pack_type: 'single', design_name: 'Dori', design_no: ' 1325 ', pack_size: 6 }),
  'DORI-1325-06',
  'single: design_no is trimmed',
);

assert.equal(
  generateSkuCode({
    pack_type: 'single',
    design_name: 'Festive Necklace',
    design_no: '85',
    pack_size: 6,
  }),
  'FESTIVENECKLACE-85-06',
  'single: design_name spaces collapsed and upper-cased',
);

assert.equal(
  generateSkuCode({ pack_type: 'single', design_name: 'dori', design_no: '85', pack_size: 1 }),
  'DORI-85-01',
  'single: pack_size 1 → 01',
);

// --- mix packs ---

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
