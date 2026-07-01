'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { rpcErrorKey, rpcErrorMessageKey } from '@/lib/rpc/errors';
import { generateSkuCode } from '@/lib/skus/code';

const RowSchema = z.object({
  design_name: z.string().trim().min(1),
  // Any positive int is accepted so custom bulk packs (20, 100, 500 …) work
  // alongside the standard tile options; the same rule the single-create
  // action uses (see ../actions.ts).
  pack_size: z.coerce.number().int().min(1).max(9999),
  rate_unit: z.enum(['pack', 'piece']).default('piece'),
  price: z.coerce.number().min(0),
  discount_pct: z.coerce.number().min(0).max(100).default(0),
  is_discountable: z.boolean().default(false),
  print_qty: z.coerce.number().int().min(0).default(0),
});

const PayloadSchema = z.object({
  rows: z.array(RowSchema).min(1).max(200),
});

export type CreateMultipleResult =
  | { ok: true; createdCount: number }
  | { ok: false; messageKey: string; rowIndex?: number; duplicateSkuCode?: string };

export async function createMultipleSkusAction(
  _prev: CreateMultipleResult | null,
  formData: FormData,
): Promise<CreateMultipleResult> {
  await requireRole(['super_admin', 'supervisor']);

  const rawPayload = formData.get('payload');
  if (typeof rawPayload !== 'string') {
    return { ok: false, messageKey: 'common.errors.invalidInput' };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawPayload);
  } catch {
    return { ok: false, messageKey: 'common.errors.invalidInput' };
  }
  const parsed = PayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false, messageKey: 'skus.multiple.errors.invalidRow' };
  }

  const supabase = createClient();

  // Pre-compute every row's deterministic sku_code, then run two duplicate
  // checks BEFORE inserting anything. Without this, an inserted-and-then-
  // failed-mid-loop run would leave orphan SKUs in the DB and skip the
  // redirect to the print sheet — the user retries, hits the duplicate from
  // their own leftover insert, and never gets their labels.
  const rowsWithCodes = parsed.data.rows.map((row, idx) => ({
    idx,
    row,
    sku_code: generateSkuCode({
      pack_type: 'single',
      design_name: row.design_name,
      pack_size: row.pack_size,
      rate_unit: row.rate_unit,
    }),
  }));

  // 1. Intra-batch: same code appearing on two rows in this submission.
  const seenInBatch = new Map<string, number>();
  for (const item of rowsWithCodes) {
    const earlier = seenInBatch.get(item.sku_code);
    if (earlier !== undefined) {
      return {
        ok: false,
        messageKey: 'skus.errors.duplicate',
        rowIndex: item.idx,
        duplicateSkuCode: item.sku_code,
      };
    }
    seenInBatch.set(item.sku_code, item.idx);
  }

  // 2. Vs. DB: any of these codes already an active SKU?
  const allCodes = rowsWithCodes.map((r) => r.sku_code);
  const { data: existing } = await supabase
    .from('skus')
    .select('sku_code')
    .in('sku_code', allCodes)
    .is('deleted_at', null);
  if (existing && existing.length > 0) {
    const taken = new Set((existing as Array<{ sku_code: string }>).map((r) => r.sku_code));
    const conflict = rowsWithCodes.find((r) => taken.has(r.sku_code));
    if (conflict) {
      return {
        ok: false,
        messageKey: 'skus.errors.duplicate',
        rowIndex: conflict.idx,
        duplicateSkuCode: conflict.sku_code,
      };
    }
  }

  // Build [{ id, print_qty }] from successful inserts so we can redirect to
  // the print sheet with exactly the labels the user asked for.
  const printItems: Array<{ id: string; qty: number }> = [];

  for (const { idx: i, row, sku_code } of rowsWithCodes) {
    const { data, error } = await supabase.rpc('create_sku', {
      p_sku_code: sku_code,
      p_pack_type: 'single',
      p_design_no: '',
      p_mix_code: '',
      p_design_name: row.design_name,
      p_pack_size: row.pack_size,
      p_price: row.price,
      p_photo_path: '',
      p_reason: '',
      p_discount_pct: row.discount_pct,
      p_is_discountable: row.is_discountable,
      p_rate_unit: row.rate_unit,
    });
    if (error) {
      const key = rpcErrorKey(error);
      if (key === 'sku_duplicate') {
        return {
          ok: false,
          messageKey: 'skus.errors.duplicate',
          rowIndex: i,
          duplicateSkuCode: sku_code,
        };
      }
      return { ok: false, messageKey: rpcErrorMessageKey(error), rowIndex: i };
    }
    const inserted = data as { id?: string } | null;
    if (!inserted?.id) {
      return { ok: false, messageKey: 'common.errors.unknownError', rowIndex: i };
    }
    if (row.print_qty > 0) {
      printItems.push({ id: inserted.id, qty: row.print_qty });
    }
  }

  revalidatePath('/skus');

  if (printItems.length === 0) {
    redirect('/skus?bulk_created=' + parsed.data.rows.length);
  }

  const itemsParam = printItems.map((p) => `${p.id}:${p.qty}`).join(',');
  redirect(`/skus/print/sheet?items=${itemsParam}`);
}
