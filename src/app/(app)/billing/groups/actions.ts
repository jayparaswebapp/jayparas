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
  name: z.string().trim().min(1, 'billing.groups.errors.nameRequired'),
  city: z.string().trim().min(1, 'billing.groups.errors.cityRequired'),
  notes: z.string().trim().optional(),
  is_active: z.coerce.boolean(),
  reason: z.string().trim().optional(),
});

export async function saveCustomerGroupAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireRole(['super_admin', 'supervisor']);
  const isSuperAdmin = user.role === 'super_admin';

  const parsed = SaveSchema.safeParse({
    id: formData.get('id') || undefined,
    name: formData.get('name') ?? '',
    city: formData.get('city') ?? '',
    notes: formData.get('notes') ?? '',
    is_active: formData.get('is_active') === 'on',
    reason: formData.get('reason'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  }

  if (isSuperAdmin && (!parsed.data.reason || parsed.data.reason.length === 0)) {
    return { ok: false, messageKey: 'common.errors.reasonRequired' };
  }

  const supabase = createClient();
  const reason = parsed.data.reason ?? '';

  if (!parsed.data.id) {
    const { error } = await supabase.rpc('create_customer_group', {
      p_name: parsed.data.name,
      p_city: parsed.data.city,
      p_notes: parsed.data.notes ?? '',
      p_reason: reason,
    });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  } else {
    const { error } = await supabase.rpc('update_customer_group', {
      p_id: parsed.data.id,
      p_name: parsed.data.name,
      p_city: parsed.data.city,
      p_notes: parsed.data.notes ?? '',
      p_is_active: parsed.data.is_active,
      p_reason: reason,
    });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  }

  revalidatePath('/billing/groups');
  revalidatePath('/billing/customers');
  redirect('/billing/groups');
}

const DestructiveSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1, 'common.errors.reasonRequired'),
});

export async function softDeleteCustomerGroupAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);
  const parsed = DestructiveSchema.safeParse({
    id: formData.get('id'),
    reason: formData.get('reason'),
  });
  if (!parsed.success)
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };

  const supabase = createClient();
  const { error } = await supabase.rpc('soft_delete_customer_group', {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/billing/groups');
  revalidatePath('/billing/customers');
  redirect('/billing/groups');
}

export async function restoreCustomerGroupAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin']);
  const parsed = DestructiveSchema.safeParse({
    id: formData.get('id'),
    reason: formData.get('reason'),
  });
  if (!parsed.success)
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };

  const supabase = createClient();
  const { error } = await supabase.rpc('restore_customer_group', {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/billing/groups');
  revalidatePath('/billing/customers');
  redirect('/billing/groups');
}
