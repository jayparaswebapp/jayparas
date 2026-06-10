'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { rpcErrorKey, rpcErrorMessageKey } from '@/lib/rpc/errors';
import { generateSkuCode } from '@/lib/skus/code';

const PACK_SIZES = [1, 3, 4, 6, 12] as const;

const RowSchema = z.object({
  design_name: z.string().trim().min(1),
  design_no: z.string().trim().min(1),
  pack_size: z.coerce
    .number()
    .int()
    .refine((n) => (PACK_SIZES as readonly number[]).includes(n)),
  price: z.coerce.number().min(0),
  discount_pct: z.coerce.number().min(0).max(100).default(0),
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
  // Build [{ id, print_qty }] from successful inserts so we can redirect to
  // the print sheet with exactly the labels the user asked for.
  const printItems: Array<{ id: string; qty: number }> = [];

  for (let i = 0; i < parsed.data.rows.length; i += 1) {
    const row = parsed.data.rows[i]!;
    const sku_code = generateSkuCode({
      pack_type: 'single',
      design_name: row.design_name,
      design_no: row.design_no,
      pack_size: row.pack_size,
    });
    const { data, error } = await supabase.rpc('create_sku', {
      p_sku_code: sku_code,
      p_pack_type: 'single',
      p_design_no: row.design_no,
      p_mix_code: '',
      p_design_name: row.design_name,
      p_pack_size: row.pack_size,
      p_price: row.price,
      p_photo_path: '',
      p_reason: '',
      p_discount_pct: row.discount_pct,
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
