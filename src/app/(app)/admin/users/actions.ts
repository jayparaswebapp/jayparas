'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/users/current';
import { rpcErrorMessageKey } from '@/lib/rpc/errors';
import { mobileToSyntheticEmail } from '@/lib/auth/synthetic-email';
import type { ActionResult } from '@/lib/rpc/action-result';

const RoleEnum = z.enum(['super_admin', 'supervisor', 'centre_manager', 'accountant']);

const CreateSchema = z.object({
  full_name: z.string().trim().min(1, 'admin.users.errors.fullNameRequired'),
  mobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'admin.users.errors.invalidMobile'),
  pin: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'admin.users.errors.invalidPin'),
  role: RoleEnum,
  location_ids: z.array(z.string().uuid()),
  reason: z.string().trim().min(1, 'common.errors.reasonRequired'),
});

const UpdateSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().trim().min(1, 'admin.users.errors.fullNameRequired'),
  role: RoleEnum,
  is_active: z.coerce.boolean(),
  location_ids: z.array(z.string().uuid()),
  reason: z.string().trim().min(1, 'common.errors.reasonRequired'),
});

const DestructiveSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1, 'common.errors.reasonRequired'),
});

const ResetPinSchema = z.object({
  id: z.string().uuid(),
  pin: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'admin.users.errors.invalidPin'),
  pin_confirm: z.string().trim(),
  reason: z.string().trim().min(1, 'common.errors.reasonRequired'),
});

export async function createAppUserAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin']);

  const parsed = CreateSchema.safeParse({
    full_name: formData.get('full_name'),
    mobile: formData.get('mobile'),
    pin: formData.get('pin'),
    role: formData.get('role'),
    location_ids: formData.getAll('location_ids').map((v) => String(v)),
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  }

  if (parsed.data.role === 'centre_manager' && parsed.data.location_ids.length === 0) {
    return { ok: false, messageKey: 'admin.users.errors.centreManagerLocationsRequired' };
  }

  const admin = createAdminClient();
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: mobileToSyntheticEmail(parsed.data.mobile),
    password: parsed.data.pin,
    email_confirm: true,
  });
  if (authError || !created.user) {
    return { ok: false, messageKey: 'common.errors.unknownError' };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc('create_app_user', {
    p_auth_user_id: created.user.id,
    p_full_name: parsed.data.full_name,
    p_mobile: parsed.data.mobile,
    p_role: parsed.data.role,
    p_location_ids: parsed.data.location_ids,
    p_reason: parsed.data.reason,
  });

  if (error) {
    // Roll back the orphan auth user.
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, messageKey: rpcErrorMessageKey(error) };
  }

  revalidatePath('/admin/users');
  redirect('/admin/users');
}

export async function updateAppUserAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin']);

  const parsed = UpdateSchema.safeParse({
    id: formData.get('id'),
    full_name: formData.get('full_name'),
    role: formData.get('role'),
    is_active: formData.get('is_active') === 'on',
    location_ids: formData.getAll('location_ids').map((v) => String(v)),
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  }

  if (parsed.data.role === 'centre_manager' && parsed.data.location_ids.length === 0) {
    return { ok: false, messageKey: 'admin.users.errors.centreManagerLocationsRequired' };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc('update_app_user', {
    p_id: parsed.data.id,
    p_full_name: parsed.data.full_name,
    p_role: parsed.data.role,
    p_is_active: parsed.data.is_active,
    p_location_ids: parsed.data.location_ids,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/admin/users');
  redirect('/admin/users');
}

export async function softDeleteAppUserAction(
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
  const { error } = await supabase.rpc('soft_delete_app_user', {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/admin/users');
  redirect('/admin/users');
}

export async function restoreAppUserAction(
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
  const { error } = await supabase.rpc('restore_app_user', {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/admin/users');
  redirect('/admin/users');
}

/**
 * Reset PIN — invokes the reset-user-pin Edge Function which:
 *   1) re-checks caller is super_admin and target != caller
 *   2) calls auth.admin.updateUserById with the new password
 *   3) writes an audit row via log_pin_reset RPC
 */
export async function resetUserPinAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin']);

  const parsed = ResetPinSchema.safeParse({
    id: formData.get('id'),
    pin: formData.get('pin'),
    pin_confirm: formData.get('pin_confirm'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  }
  if (parsed.data.pin !== parsed.data.pin_confirm) {
    return { ok: false, messageKey: 'admin.users.errors.pinMismatch' };
  }

  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke('reset-user-pin', {
    body: {
      target_id: parsed.data.id,
      new_pin: parsed.data.pin,
      reason: parsed.data.reason,
    },
  });

  if (error) {
    const fnMessage =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : '';
    return { ok: false, messageKey: rpcErrorMessageKey({ message: fnMessage }) };
  }

  revalidatePath('/admin/users');
  redirect(`/admin/users/${parsed.data.id}`);
}
