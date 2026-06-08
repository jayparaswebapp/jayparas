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
  full_name: z.string().trim().min(1, 'billing.customers.errors.fullNameRequired'),
  business_name: optionalTrim('billing.customers.errors.invalidInput'),
  mobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'billing.customers.errors.invalidMobile'),
  email: z
    .string()
    .trim()
    .transform((v) => v.toLowerCase())
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
      message: 'billing.customers.errors.invalidEmail',
    }),
  gstin: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => v === '' || GSTIN_REGEX.test(v), {
      message: 'billing.customers.errors.invalidGstin',
    }),
  pan: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => v === '' || PAN_REGEX.test(v), {
      message: 'billing.customers.errors.invalidPan',
    }),
  address_line1: optionalTrim('billing.customers.errors.invalidInput'),
  address_line2: optionalTrim('billing.customers.errors.invalidInput'),
  city: optionalTrim('billing.customers.errors.invalidInput'),
  state: optionalTrim('billing.customers.errors.invalidInput'),
  pincode: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{6}$/.test(v), {
      message: 'billing.customers.errors.invalidPincode',
    }),
  notes: optionalTrim('billing.customers.errors.invalidInput'),
  group_id: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
      {
        message: 'common.errors.invalidInput',
      },
    )
    .transform((v) => (v === '' ? null : v)),
  is_active: z.coerce.boolean(),
});

export async function saveBillingCustomerAction(
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
    group_id: formData.get('group_id') ?? '',
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
    const { error } = await supabase.rpc('create_billing_customer', {
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
      p_group_id: parsed.data.group_id,
      p_reason: '',
    });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  } else {
    const { error } = await supabase.rpc('update_billing_customer', {
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
      p_group_id: parsed.data.group_id,
      p_is_active: parsed.data.is_active,
      p_reason: '',
    });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  }

  revalidatePath('/billing/customers');
  redirect('/billing/customers');
}

const DestructiveSchema = z.object({ id: z.string().uuid() });

export async function softDeleteBillingCustomerAction(
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
  const { error } = await supabase.rpc('soft_delete_billing_customer', {
    p_id: parsed.data.id,
    p_reason: '',
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/billing/customers');
  redirect('/billing/customers');
}

export async function restoreBillingCustomerAction(
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
  const { error } = await supabase.rpc('restore_billing_customer', {
    p_id: parsed.data.id,
    p_reason: '',
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/billing/customers');
  redirect('/billing/customers');
}
