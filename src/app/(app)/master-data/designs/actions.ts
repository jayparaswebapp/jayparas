'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { rpcErrorMessageKey } from '@/lib/rpc/errors';
import { DESIGN_IMAGES_BUCKET } from '@/lib/storage/design-images';
import type { ActionResult } from '@/lib/rpc/action-result';

const SaveSchema = z.object({
  id: z.string().uuid().optional(),
  design_number: z.string().trim().min(1, 'masterData.designs.errors.designNumberRequired'),
  name_en: z.string().trim().optional(),
  name_gu: z.string().trim().optional(),
  rate: z.coerce.number().gt(0, 'masterData.designs.errors.rateRequired'),
  image_path: z.string().optional(),
  is_active: z.coerce.boolean(),
});

export async function saveDesignAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);

  const parsed = SaveSchema.safeParse({
    id: formData.get('id') || undefined,
    design_number: formData.get('design_number'),
    name_en: formData.get('name_en'),
    name_gu: formData.get('name_gu'),
    rate: formData.get('rate'),
    image_path: formData.get('image_path'),
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
    const { error } = await supabase.rpc('create_design', {
      p_design_number: parsed.data.design_number,
      p_name_en: parsed.data.name_en ?? '',
      p_name_gu: parsed.data.name_gu ?? '',
      p_rate: parsed.data.rate,
      p_image_path: parsed.data.image_path ?? '',
      p_reason: '',
    });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  } else {
    const { error } = await supabase.rpc('update_design', {
      p_id: parsed.data.id,
      p_design_number: parsed.data.design_number,
      p_name_en: parsed.data.name_en ?? '',
      p_name_gu: parsed.data.name_gu ?? '',
      p_rate: parsed.data.rate,
      p_image_path: parsed.data.image_path ?? '',
      p_is_active: parsed.data.is_active,
      p_reason: '',
    });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  }

  revalidatePath('/master-data/designs');
  redirect('/master-data/designs');
}

const DestructiveSchema = z.object({ id: z.string().uuid() });

export async function softDeleteDesignAction(
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
  const { error } = await supabase.rpc('soft_delete_design', {
    p_id: parsed.data.id,
    p_reason: '',
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/master-data/designs');
  redirect('/master-data/designs');
}

export async function restoreDesignAction(
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
  const { error } = await supabase.rpc('restore_design', {
    p_id: parsed.data.id,
    p_reason: '',
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/master-data/designs');
  redirect('/master-data/designs');
}

/**
 * Server-side helper: turn a stored image_path into a short-lived signed URL.
 * Called from server components to render thumbnails.
 */
export async function getDesignThumbnailUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const supabase = createClient();
  const { data } = await supabase.storage.from(DESIGN_IMAGES_BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
