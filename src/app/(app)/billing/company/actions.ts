'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { rpcErrorMessageKey } from '@/lib/rpc/errors';
import type { ActionResult } from '@/lib/rpc/action-result';

const SaveSchema = z.object({
  legal_name: z.string().trim().min(1, 'billing.company.errors.legalNameRequired'),
  address_line1: z.string().trim().optional(),
  address_line2: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  pincode: z.string().trim().optional(),
  gstin: z.string().trim().optional(),
  pan: z.string().trim().optional(),
  mobile: z.string().trim().optional(),
  email: z.string().trim().optional(),
  bank_name: z.string().trim().optional(),
  bank_account_no: z.string().trim().optional(),
  bank_ifsc: z.string().trim().optional(),
  default_terms: z.string().trim().optional(),
  default_due_days: z.coerce.number().int().min(0).default(0),
});

export async function saveCompanyInfoAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin']);

  const parsed = SaveSchema.safeParse({
    legal_name: formData.get('legal_name') ?? '',
    address_line1: formData.get('address_line1') ?? '',
    address_line2: formData.get('address_line2') ?? '',
    city: formData.get('city') ?? '',
    state: formData.get('state') ?? '',
    pincode: formData.get('pincode') ?? '',
    gstin: formData.get('gstin') ?? '',
    pan: formData.get('pan') ?? '',
    mobile: formData.get('mobile') ?? '',
    email: formData.get('email') ?? '',
    bank_name: formData.get('bank_name') ?? '',
    bank_account_no: formData.get('bank_account_no') ?? '',
    bank_ifsc: formData.get('bank_ifsc') ?? '',
    default_terms: formData.get('default_terms') ?? '',
    default_due_days: formData.get('default_due_days') ?? 0,
  });

  if (!parsed.success) {
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc('upsert_company_info', {
    p_legal_name: parsed.data.legal_name,
    p_address_line1: parsed.data.address_line1 ?? '',
    p_address_line2: parsed.data.address_line2 ?? '',
    p_city: parsed.data.city ?? '',
    p_state: parsed.data.state ?? '',
    p_pincode: parsed.data.pincode ?? '',
    p_gstin: parsed.data.gstin ?? '',
    p_pan: parsed.data.pan ?? '',
    p_mobile: parsed.data.mobile ?? '',
    p_email: parsed.data.email ?? '',
    p_bank_name: parsed.data.bank_name ?? '',
    p_bank_account_no: parsed.data.bank_account_no ?? '',
    p_bank_ifsc: parsed.data.bank_ifsc ?? '',
    p_default_terms: parsed.data.default_terms ?? '',
    p_default_due_days: parsed.data.default_due_days,
  });

  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/billing/company');
  return { ok: true };
}
