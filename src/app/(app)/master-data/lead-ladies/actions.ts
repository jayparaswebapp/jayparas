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
  full_name: z.string().trim().min(1, 'masterData.leadLadies.errors.fullNameRequired'),
  mobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'masterData.leadLadies.errors.invalidMobile'),
  notes: z.string().trim().optional(),
  location_ids: z.array(z.string().uuid()).min(1, 'masterData.leadLadies.errors.locationsRequired'),
  is_active: z.coerce.boolean(),
});

export async function saveLeadLadyAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);

  const parsed = SaveSchema.safeParse({
    id: formData.get('id') || undefined,
    full_name: formData.get('full_name'),
    mobile: formData.get('mobile'),
    notes: formData.get('notes'),
    location_ids: formData.getAll('location_ids').map((v) => String(v)),
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
    const { error } = await supabase.rpc('create_lead_lady', {
      p_full_name: parsed.data.full_name,
      p_mobile: parsed.data.mobile,
      p_notes: parsed.data.notes ?? '',
      p_location_ids: parsed.data.location_ids,
      p_reason: '',
    });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  } else {
    const { error } = await supabase.rpc('update_lead_lady', {
      p_id: parsed.data.id,
      p_full_name: parsed.data.full_name,
      p_mobile: parsed.data.mobile,
      p_notes: parsed.data.notes ?? '',
      p_location_ids: parsed.data.location_ids,
      p_is_active: parsed.data.is_active,
      p_reason: '',
    });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  }

  revalidatePath('/master-data/lead-ladies');
  redirect('/master-data/lead-ladies');
}

const DestructiveSchema = z.object({ id: z.string().uuid() });

export async function softDeleteLeadLadyAction(
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
  const { error } = await supabase.rpc('soft_delete_lead_lady', {
    p_id: parsed.data.id,
    p_reason: '',
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/master-data/lead-ladies');
  redirect('/master-data/lead-ladies');
}

export async function restoreLeadLadyAction(
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
  const { error } = await supabase.rpc('restore_lead_lady', {
    p_id: parsed.data.id,
    p_reason: '',
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/master-data/lead-ladies');
  redirect('/master-data/lead-ladies');
}
