'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { rpcErrorKey, rpcErrorMessageKey } from '@/lib/rpc/errors';
import type { ActionResult } from '@/lib/rpc/action-result';

/**
 * Kite Setup: Companies (discount buckets) and Product Groups (shown on the
 * kite bill). Each group belongs to exactly one company. See migration
 * 20261111000001_kite_pricing.sql.
 */

const PATH = '/billing/kite-setup';

function errorKey(error: unknown): string {
  // group_name_taken's shared message talks about "city" (customer groups),
  // so product groups get their own message.
  if (rpcErrorKey(error) === 'group_name_taken') return 'billing.kiteSetup.errors.groupNameTaken';
  return rpcErrorMessageKey(error);
}

const CompanySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'billing.kiteSetup.errors.nameRequired'),
  is_active: z.boolean(),
});

export async function saveKiteCompanyAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);
  const parsed = CompanySchema.safeParse({
    id: formData.get('id') || undefined,
    name: formData.get('name') ?? '',
    is_active: formData.get('is_active') === 'on',
  });
  if (!parsed.success) {
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc('save_kite_company', {
    p_id: parsed.data.id ?? null,
    p_name: parsed.data.name,
    p_is_active: parsed.data.is_active,
    p_reason: '',
  });
  if (error) return { ok: false, messageKey: errorKey(error) };

  revalidatePath(PATH);
  return { ok: true };
}

const GroupSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'billing.kiteSetup.errors.nameRequired'),
   company_id: z.string().uuid('billing.kiteSetup.errors.companyRequired'),
  is_active: z.boolean(),
  hsn_code: z.string().trim().max(10, 'billing.kiteSetup.errors.hsnInvalid'),
  gst_pct: z.coerce
    .number({ invalid_type_error: 'billing.kiteSetup.errors.gstInvalid' })
    .min(0, 'billing.kiteSetup.errors.gstInvalid')
    .max(28, 'billing.kiteSetup.errors.gstInvalid'),
});

export async function saveProductGroupAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);
  const parsed = GroupSchema.safeParse({
    id: formData.get('id') || undefined,
    name: formData.get('name') ?? '',
      company_id: formData.get('company_id') ?? '',
    is_active: formData.get('is_active') === 'on',
    hsn_code: formData.get('hsn_code') ?? '',
    gst_pct: formData.get('gst_pct') || 0,
  });
  if (!parsed.success) {
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc('save_product_group', {
    p_id: parsed.data.id ?? null,
    p_name: parsed.data.name,
      p_company_id: parsed.data.company_id,
    p_is_active: parsed.data.is_active,
    p_reason: '',
    p_hsn_code: parsed.data.hsn_code,
    p_gst_pct: parsed.data.gst_pct,
  });
  if (error) return { ok: false, messageKey: errorKey(error) };

  revalidatePath(PATH);
  return { ok: true };
}

const DeleteSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['company', 'group']),
});

export async function deleteKiteSetupItemAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);
  const parsed = DeleteSchema.safeParse({ id: formData.get('id'), kind: formData.get('kind') });
  if (!parsed.success) return { ok: false, messageKey: 'common.errors.invalidInput' };

  const supabase = createClient();
  const fn =
    parsed.data.kind === 'company' ? 'soft_delete_kite_company' : 'soft_delete_product_group';
  const { error } = await supabase.rpc(fn, { p_id: parsed.data.id, p_reason: '' });
  if (error) return { ok: false, messageKey: errorKey(error) };

  revalidatePath(PATH);
  return { ok: true };
}
