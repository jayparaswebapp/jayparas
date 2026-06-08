'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { rpcErrorMessageKey } from '@/lib/rpc/errors';
import type { ActionResult } from '@/lib/rpc/action-result';

const SaveSchema = z.object({
  id: z.string().uuid().optional(),
  item_code: z.string().trim().min(1, 'purchases.items.errors.itemCodeRequired'),
  name: z.string().trim().min(1, 'purchases.items.errors.nameRequired'),
  name_gu: z.string().trim().optional(),
  uom: z.string().trim().optional(),
  hsn_code: z.string().trim().optional(),
  default_rate: z.coerce.number().min(0).default(0),
  default_gst_pct: z.coerce
    .number()
    .min(0, 'purchases.items.errors.invalidGst')
    .max(100, 'purchases.items.errors.invalidGst')
    .default(0),
  notes: z.string().trim().optional(),
  is_active: z.coerce.boolean(),
});

export async function savePurchaseItemAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);

  const parsed = SaveSchema.safeParse({
    id: formData.get('id') || undefined,
    item_code: formData.get('item_code') ?? '',
    name: formData.get('name') ?? '',
    name_gu: formData.get('name_gu') ?? '',
    uom: formData.get('uom') ?? '',
    hsn_code: formData.get('hsn_code') ?? '',
    default_rate: formData.get('default_rate') ?? 0,
    default_gst_pct: formData.get('default_gst_pct') ?? 0,
    notes: formData.get('notes') ?? '',
    is_active: formData.get('is_active') === 'on',
  });

  if (!parsed.success) {
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  }

  const supabase = createClient();

  if (!parsed.data.id) {
    const { error } = await supabase.rpc('create_purchase_item', {
      p_item_code: parsed.data.item_code,
      p_name: parsed.data.name,
      p_name_gu: parsed.data.name_gu ?? '',
      p_uom: parsed.data.uom ?? '',
      p_hsn_code: parsed.data.hsn_code ?? '',
      p_default_rate: parsed.data.default_rate,
      p_default_gst_pct: parsed.data.default_gst_pct,
      p_notes: parsed.data.notes ?? '',
      p_reason: '',
    });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  } else {
    const { error } = await supabase.rpc('update_purchase_item', {
      p_id: parsed.data.id,
      p_item_code: parsed.data.item_code,
      p_name: parsed.data.name,
      p_name_gu: parsed.data.name_gu ?? '',
      p_uom: parsed.data.uom ?? '',
      p_hsn_code: parsed.data.hsn_code ?? '',
      p_default_rate: parsed.data.default_rate,
      p_default_gst_pct: parsed.data.default_gst_pct,
      p_notes: parsed.data.notes ?? '',
      p_is_active: parsed.data.is_active,
      p_reason: '',
    });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  }

  revalidatePath('/purchases/items');
  redirect('/purchases/items');
}

const DestructiveSchema = z.object({ id: z.string().uuid() });

export async function softDeletePurchaseItemAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);
  const parsed = DestructiveSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success)
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  const supabase = createClient();
  const { error } = await supabase.rpc('soft_delete_purchase_item', {
    p_id: parsed.data.id,
    p_reason: '',
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  revalidatePath('/purchases/items');
  redirect('/purchases/items');
}

export async function restorePurchaseItemAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin']);
  const parsed = DestructiveSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success)
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  const supabase = createClient();
  const { error } = await supabase.rpc('restore_purchase_item', {
    p_id: parsed.data.id,
    p_reason: '',
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  revalidatePath('/purchases/items');
  redirect('/purchases/items');
}
