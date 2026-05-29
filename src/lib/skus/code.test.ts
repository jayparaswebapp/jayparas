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
  generateSkuCode({ pack_type: 'single', design_no: '1325', pack_size: 6 }),
  'JP-1325-06',
  'single: 1325 / 6 → JP-1325-06',
);

assert.equal(
  generateSkuCode({ pack_type: 'single', design_no: '1325', pack_size: 12 }),
  'JP-1325-12',
  'single: pack_size 12 should not zero-pad past two digits',
);

assert.equal(
  generateSkuCode({ pack_type: 'single', design_no: '7', pack_size: 3 }),
  'JP-7-03',
  'single: short design_no kept as-is; pack_size 3 → 03',
);

assert.equal(
  generateSkuCode({ pack_type: 'single', design_no: ' 1325 ', pack_size: 6 }),
  'JP-1325-06',
  'single: design_no is trimmed',
);

// --- mix packs ---

assert.equal(
  generateSkuCode({ pack_type: 'mix', mix_code: 'FEST', pack_size: 12 }),
  'JP-MIX-FEST-12',
  'mix: FEST / 12 → JP-MIX-FEST-12',
);

assert.equal(
  generateSkuCode({ pack_type: 'mix', mix_code: 'fest', pack_size: 12 }),
  'JP-MIX-FEST-12',
  'mix: mix_code is upper-cased',
);

assert.equal(
  generateSkuCode({ pack_type: 'mix', mix_code: ' fest ', pack_size: 6 }),
  'JP-MIX-FEST-6',
  'mix: mix_code is trimmed; pack_size is not zero-padded',
);

// eslint-disable-next-line no-console
console.log('All SKU code tests passed.');
