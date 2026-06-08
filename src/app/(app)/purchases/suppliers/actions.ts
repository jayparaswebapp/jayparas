'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { rpcErrorMessageKey } from '@/lib/rpc/errors';
import type { ActionResult } from '@/lib/rpc/action-result';

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const optionalTrim = (key: string) =>
  z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? '' : v))
    .refine(() => true, key);

const SaveSchema = z.object({
  id: z.string().uuid().optional(),
  full_name: z.string().trim().min(1, 'purchases.suppliers.errors.fullNameRequired'),
  business_name: optionalTrim('common.errors.invalidInput'),
  mobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'purchases.suppliers.errors.invalidMobile'),
  email: z
    .string()
    .trim()
    .transform((v) => v.toLowerCase())
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
      message: 'purchases.suppliers.errors.invalidEmail',
    }),
  gstin: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => v === '' || GSTIN_REGEX.test(v), {
      message: 'purchases.suppliers.errors.invalidGstin',
    }),
  pan: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => v === '' || PAN_REGEX.test(v), {
      message: 'purchases.suppliers.errors.invalidPan',
    }),
  address_line1: optionalTrim('common.errors.invalidInput'),
  address_line2: optionalTrim('common.errors.invalidInput'),
  city: optionalTrim('common.errors.invalidInput'),
  state: optionalTrim('common.errors.invalidInput'),
  pincode: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{6}$/.test(v), {
      message: 'purchases.suppliers.errors.invalidPincode',
    }),
  notes: optionalTrim('common.errors.invalidInput'),
  is_active: z.coerce.boolean(),
});

export async function saveSupplierAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);

  const parsed = SaveSchema.safeParse({
    id: formData.get('id') || undefined,
    full_name: formData.get('full_name') ?? '',
    business_name: formData.get('business_name') ?? '',
    mobile: formData.get('mobile') ?? '',
    email: formData.get('email') ?? '',
    gstin: formData.get('gstin') ?? '',
    pan: formData.get('pan') ?? '',
    address_line1: formData.get('address_line1') ?? '',
    address_line2: formData.get('address_line2') ?? '',
    city: formData.get('city') ?? '',
    state: formData.get('state') ?? '',
    pincode: formData.get('pincode') ?? '',
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
    const { error } = await supabase.rpc('create_supplier', {
      p_full_name: parsed.data.full_name,
      p_business_name: parsed.data.business_name,
      p_mobile: parsed.data.mobile,
      p_email: parsed.data.email,
      p_gstin: parsed.data.gstin,
      p_pan: parsed.data.pan,
      p_address_line1: parsed.data.address_line1,
      p_address_line2: parsed.data.address_line2,
      p_city: parsed.data.city,
      p_state: parsed.data.state,
      p_pincode: parsed.data.pincode,
      p_notes: parsed.data.notes,
      p_reason: '',
    });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  } else {
    const { error } = await supabase.rpc('update_supplier', {
      p_id: parsed.data.id,
      p_full_name: parsed.data.full_name,
      p_business_name: parsed.data.business_name,
      p_mobile: parsed.data.mobile,
      p_email: parsed.data.email,
      p_gstin: parsed.data.gstin,
      p_pan: parsed.data.pan,
      p_address_line1: parsed.data.address_line1,
      p_address_line2: parsed.data.address_line2,
      p_city: parsed.data.city,
      p_state: parsed.data.state,
      p_pincode: parsed.data.pincode,
      p_notes: parsed.data.notes,
      p_is_active: parsed.data.is_active,
      p_reason: '',
    });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  }

  revalidatePath('/purchases/suppliers');
  redirect('/purchases/suppliers');
}

const DestructiveSchema = z.object({ id: z.string().uuid() });

export async function softDeleteSupplierAction(
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
  const { error } = await supabase.rpc('soft_delete_supplier', {
    p_id: parsed.data.id,
    p_reason: '',
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  revalidatePath('/purchases/suppliers');
  redirect('/purchases/suppliers');
}

export async function restoreSupplierAction(
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
  const { error } = await supabase.rpc('restore_supplier', {
    p_id: parsed.data.id,
    p_reason: '',
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  revalidatePath('/purchases/suppliers');
  redirect('/purchases/suppliers');
}
