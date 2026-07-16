'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { rpcErrorKey, rpcErrorMessageKey } from '@/lib/rpc/errors';
import type { ActionResult } from '@/lib/rpc/action-result';
import { generateSkuCode } from '@/lib/skus/code';
import { requireAppUser } from '@/lib/users/current';

/**
 * Single is the only pack_type writable from the UI now. Mix is kept as a
 * legacy code path in the DB (existing rows) but no form ships it.
 *
 * design_no was retired — the new SKU form combines it into design_name.
 * The Zod schema accepts the field but treats it as optional so bulk-create
 * payloads from older code keep validating.
 *
 * pack_size is a positive int with no enum whitelist — the wholesale shop
 * needs custom sizes (20, 100, 500) for bulk packs on top of the standard
 * tile options. Anything > 9999 is almost certainly a typo, so we cap there.
 */
const CreateSchema = z.object({
  pack_type: z.enum(['single', 'mix']).default('single'),
  design_no: z.string().trim().optional(),
  mix_code: z.string().trim().optional(),
  design_name: z.string().trim().min(1, 'skus.errors.designNameRequired'),
  pack_size: z.coerce
    .number()
    .int()
    .min(1, { message: 'skus.errors.packSizeRequired' })
    .max(9999, { message: 'skus.errors.packSizeRequired' }),
  price: z.coerce.number().min(0, 'skus.errors.priceRequired'),
  discount_pct: z.coerce.number().min(0).max(100).default(0),
  is_discountable: z
    .union([z.literal('on'), z.literal('true'), z.literal('false'), z.literal('')])
    .optional()
    .transform((v) => v === 'on' || v === 'true'),
  rate_unit: z.enum(['pack', 'piece']).default('piece'),
  photo_path: z.string().optional(),
});

export type CreateSkuResult =
  | { ok: true; id: string }
  | { ok: false; messageKey: string; duplicate?: { id: string; sku_code: string } | null };

export async function createSkuAction(
  _prev: CreateSkuResult | null,
  formData: FormData,
): Promise<CreateSkuResult> {
  await requireRole(['super_admin', 'supervisor']);

  const parsed = CreateSchema.safeParse({
    pack_type: formData.get('pack_type') ?? 'single',
    design_no: formData.get('design_no') || undefined,
    mix_code: formData.get('mix_code') || undefined,
    design_name: formData.get('design_name'),
    pack_size: formData.get('pack_size'),
    price: formData.get('price'),
    discount_pct: formData.get('discount_pct') ?? 0,
    is_discountable: formData.get('is_discountable') ?? '',
    rate_unit: formData.get('rate_unit') ?? 'piece',
    photo_path: formData.get('photo_path'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  }

  // Mix is the legacy path — current UI only emits 'single' but accept 'mix'
  // for backward-compatible bulk callers, requiring mix_code.
  if (parsed.data.pack_type === 'mix' && !parsed.data.mix_code) {
    return { ok: false, messageKey: 'skus.errors.mixCodeRequired' };
  }

  const sku_code =
    parsed.data.pack_type === 'single'
      ? generateSkuCode({
          pack_type: 'single',
          design_name: parsed.data.design_name,
          pack_size: parsed.data.pack_size,
          rate_unit: parsed.data.rate_unit,
        })
      : generateSkuCode({
          pack_type: 'mix',
          design_name: parsed.data.design_name,
          mix_code: parsed.data.mix_code!,
          pack_size: parsed.data.pack_size,
        });

  const supabase = createClient();
  const { data, error } = await supabase.rpc('create_sku', {
    p_sku_code: sku_code,
    p_pack_type: parsed.data.pack_type,
    p_design_no: parsed.data.design_no ?? '',
    p_mix_code: parsed.data.mix_code ?? '',
    p_design_name: parsed.data.design_name,
    p_pack_size: parsed.data.pack_size,
    p_price: parsed.data.price,
    p_photo_path: parsed.data.photo_path ?? '',
    p_reason: '',
    p_discount_pct: parsed.data.discount_pct,
    p_is_discountable: parsed.data.is_discountable,
    p_rate_unit: parsed.data.rate_unit,
  });

  if (error) {
    const key = rpcErrorKey(error);
    if (key === 'sku_duplicate') {
      const { data: existing } = await supabase
        .from('skus')
        .select('id, sku_code')
        .eq('sku_code', sku_code)
        .is('deleted_at', null)
        .maybeSingle();
      return {
        ok: false,
        messageKey: 'skus.errors.duplicate',
        duplicate: existing ? { id: existing.id, sku_code: existing.sku_code } : null,
      };
    }
    return { ok: false, messageKey: rpcErrorMessageKey(error) };
  }

  const row = data as { id?: string } | null;
  if (!row?.id) return { ok: false, messageKey: 'common.errors.unknownError' };

  revalidatePath('/skus');
  redirect(`/skus/${row.id}?created=1`);
}

const UpdateSchema = z.object({
  id: z.string().uuid(),
  design_name: z.string().trim().min(1, 'skus.errors.designNameRequired'),
  price: z.coerce.number().min(0, 'skus.errors.priceRequired'),
  discount_pct: z.coerce.number().min(0).max(100).default(0),
  is_discountable: z
    .union([z.literal('on'), z.literal('true'), z.literal('false'), z.literal('')])
    .optional()
    .transform((v) => v === 'on' || v === 'true'),
  photo_path: z.string().optional(),
  // Super-admin only — locked fields the base update_sku RPC won't touch.
  // Kept optional so the field is safe to submit as blank for supervisors.
  pack_size: z.coerce.number().int().min(1).max(9999).optional(),
  rate_unit: z.enum(['pack', 'piece']).optional(),
});

export async function updateSkuAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);
  const user = await requireAppUser();

  const parsed = UpdateSchema.safeParse({
    id: formData.get('id'),
    design_name: formData.get('design_name'),
    price: formData.get('price'),
    discount_pct: formData.get('discount_pct') ?? 0,
    is_discountable: formData.get('is_discountable') ?? '',
    photo_path: formData.get('photo_path'),
    pack_size: formData.get('pack_size') || undefined,
    rate_unit: formData.get('rate_unit') || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  }

  const supabase = createClient();

  // First, run the normal update — design name, price, discount, etc. This
  // path stays gated by the RPC's SECURITY DEFINER + audit context so
  // supervisors don't have to worry about role-check logic here.
  const { error } = await supabase.rpc('update_sku', {
    p_id: parsed.data.id,
    p_design_name: parsed.data.design_name,
    p_price: parsed.data.price,
    p_photo_path: parsed.data.photo_path ?? '',
    p_reason: '',
    p_discount_pct: parsed.data.discount_pct,
    p_is_discountable: parsed.data.is_discountable,
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  // Then, if the request came from a super_admin AND locked fields are being
  // changed, do a direct table update on pack_size / rate_unit and regenerate
  // sku_code. We deliberately do this OUTSIDE update_sku so extending that
  // RPC (used from many places) isn't required just for the super-admin
  // override. RLS on the skus table only allows super_admin/supervisor
  // writes; the extra role-check here is belt-and-braces since we know the
  // caller is one of those two.
  const wantsLockedChange =
    user.role === 'super_admin' &&
    (parsed.data.pack_size !== undefined || parsed.data.rate_unit !== undefined);
  if (wantsLockedChange) {
    const { data: current } = await supabase
      .from('skus')
      .select('pack_size, rate_unit, design_name, pack_type')
      .eq('id', parsed.data.id)
      .maybeSingle();
    if (current) {
      const nextPackSize = parsed.data.pack_size ?? (current.pack_size as number);
      const nextRateUnit =
        parsed.data.rate_unit ?? ((current.rate_unit as string) === 'pack' ? 'pack' : 'piece');
      const changed =
        nextPackSize !== current.pack_size ||
        nextRateUnit !== ((current.rate_unit as string) === 'pack' ? 'pack' : 'piece');
      if (changed) {
        // Only 'single' SKUs have their code driven by pack_size + rate_unit
        // via generateSkuCode(); mix SKUs use a different encoding that
        // we're not exposing on the edit form.
        const nextCode =
          current.pack_type === 'single'
            ? generateSkuCode({
                pack_type: 'single',
                design_name: parsed.data.design_name,
                pack_size: nextPackSize,
                rate_unit: nextRateUnit,
              })
            : null;
        if (nextCode) {
          // Reject a code collision with another active row before we try
          // the update — the unique index would trip anyway but a friendly
          // error is nicer than a raw Postgres one.
          const { data: dupe } = await supabase
            .from('skus')
            .select('id')
            .eq('sku_code', nextCode)
            .is('deleted_at', null)
            .neq('id', parsed.data.id)
            .maybeSingle();
          if (dupe) {
            return { ok: false, messageKey: 'skus.errors.duplicate' };
          }
        }
        const patch: Record<string, unknown> = {
          pack_size: nextPackSize,
          rate_unit: nextRateUnit,
        };
        if (nextCode) patch.sku_code = nextCode;
        const { error: lockedErr } = await supabase
          .from('skus')
          .update(patch)
          .eq('id', parsed.data.id);
        if (lockedErr) return { ok: false, messageKey: rpcErrorMessageKey(lockedErr) };
      }
    }
  }

  revalidatePath('/skus');
  revalidatePath(`/skus/${parsed.data.id}`);
  redirect(`/skus/${parsed.data.id}`);
}

const ActiveSchema = z.object({
  id: z.string().uuid(),
  is_active: z.enum(['true', 'false']),
});

export async function setSkuActiveAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin']);
  const parsed = ActiveSchema.safeParse({
    id: formData.get('id'),
    is_active: formData.get('is_active'),
  });
  if (!parsed.success) {
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc('set_sku_active', {
    p_id: parsed.data.id,
    p_is_active: parsed.data.is_active === 'true',
    p_reason: '',
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/skus');
  revalidatePath(`/skus/${parsed.data.id}`);
  redirect(`/skus/${parsed.data.id}`);
}
