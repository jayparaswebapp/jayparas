'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { rpcErrorKey, rpcErrorMessageKey } from '@/lib/rpc/errors';
import type { ActionResult } from '@/lib/rpc/action-result';
import { generateSkuCode } from '@/lib/skus/code';

const PACK_SIZES = [1, 3, 4, 6, 12] as const;

const CreateSchema = z
  .object({
    pack_type: z.enum(['single', 'mix']),
    design_no: z.string().trim().optional(),
    mix_code: z.string().trim().optional(),
    design_name: z.string().trim().min(1, 'skus.errors.designNameRequired'),
    pack_size: z.coerce
      .number()
      .int()
      .refine((n) => (PACK_SIZES as readonly number[]).includes(n), {
        message: 'skus.errors.packSizeRequired',
      }),
    price: z.coerce.number().min(0, 'skus.errors.priceRequired'),
    photo_path: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.pack_type === 'single' && !val.design_no) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['design_no'],
        message: 'skus.errors.designNumberRequired',
      });
    }
    if (val.pack_type === 'mix' && !val.mix_code) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mix_code'],
        message: 'skus.errors.mixCodeRequired',
      });
    }
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
    pack_type: formData.get('pack_type'),
    design_no: formData.get('design_no') || undefined,
    mix_code: formData.get('mix_code') || undefined,
    design_name: formData.get('design_name'),
    pack_size: formData.get('pack_size'),
    price: formData.get('price'),
    photo_path: formData.get('photo_path'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  }

  const sku_code =
    parsed.data.pack_type === 'single'
      ? generateSkuCode({
          pack_type: 'single',
          design_name: parsed.data.design_name,
          design_no: parsed.data.design_no!,
          pack_size: parsed.data.pack_size,
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
  photo_path: z.string().optional(),
});

export async function updateSkuAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);

  const parsed = UpdateSchema.safeParse({
    id: formData.get('id'),
    design_name: formData.get('design_name'),
    price: formData.get('price'),
    photo_path: formData.get('photo_path'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc('update_sku', {
    p_id: parsed.data.id,
    p_design_name: parsed.data.design_name,
    p_price: parsed.data.price,
    p_photo_path: parsed.data.photo_path ?? '',
    p_reason: '',
  });

  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

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
