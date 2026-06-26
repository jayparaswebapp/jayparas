'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { rpcErrorMessageKey } from '@/lib/rpc/errors';
import type { ActionResult } from '@/lib/rpc/action-result';

// ── Job order create ───────────────────────────────────────────────────────
const ItemSchema = z.object({
  design_id: z.string().uuid({ message: 'jobWork.errors.designRequired' }),
  qty_issued: z.coerce.number().gt(0, 'jobWork.errors.qtyRequired'),
  rate_per_piece: z.coerce.number().min(0),
  notes: z.string().trim().optional(),
});
const HeaderSchema = z.object({
  lead_lady_id: z.string().uuid({ message: 'jobWork.errors.leadLadyRequired' }),
  location_id: z.string().uuid().optional().nullable(),
  issue_date: z.string().trim().min(1, 'jobWork.errors.issueDateRequired'),
  expected_return_date: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});
const PayloadSchema = z.object({
  header: HeaderSchema,
  items: z.array(ItemSchema).min(1, 'jobWork.errors.itemsRequired'),
});

export async function createJobOrderAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);
  const raw = formData.get('payload');
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, messageKey: 'common.errors.invalidInput' };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { ok: false, messageKey: 'common.errors.invalidInput' };
  }
  const parsed = PayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc('create_job_order', {
    p_header: {
      lead_lady_id: parsed.data.header.lead_lady_id,
      location_id: parsed.data.header.location_id ?? '',
      issue_date: parsed.data.header.issue_date,
      expected_return_date: parsed.data.header.expected_return_date ?? '',
      notes: parsed.data.header.notes ?? '',
    },
    p_items: parsed.data.items.map((i) => ({
      design_id: i.design_id,
      qty_issued: i.qty_issued,
      rate_per_piece: i.rate_per_piece,
      notes: i.notes ?? '',
    })),
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  const row = data as { id?: string } | null;
  if (!row?.id) return { ok: false, messageKey: 'common.errors.unknownError' };

  revalidatePath('/job-work');
  redirect(`/job-work/${row.id}`);
}

// ── Sub-assignment + receipt (per item, on detail page) ─────────────────────
const SubSchema = z.object({
  item_id: z.string().uuid(),
  labourer_id: z.string().uuid({ message: 'jobWork.errors.labourerRequired' }),
  qty: z.coerce.number().gt(0, 'jobWork.errors.qtyRequired'),
  date: z.string().trim().min(1),
  notes: z.string().trim().optional(),
});
export async function addSubAssignmentAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor', 'centre_manager']);
  const parsed = SubSchema.safeParse({
    item_id: formData.get('item_id'),
    labourer_id: formData.get('labourer_id'),
    qty: formData.get('qty'),
    date: formData.get('date'),
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success)
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  const orderId = String(formData.get('order_id') ?? '');

  const supabase = createClient();
  const { error } = await supabase.rpc('add_job_sub_assignment', {
    p_item_id: parsed.data.item_id,
    p_labourer_id: parsed.data.labourer_id,
    p_qty: parsed.data.qty,
    p_date: parsed.data.date,
    p_notes: parsed.data.notes ?? '',
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/job-work');
  if (orderId) revalidatePath(`/job-work/${orderId}`);
  return { ok: true };
}

const ReceiptSchema = z.object({
  item_id: z.string().uuid(),
  labourer_id: z.string().uuid().optional().nullable(),
  qty_accepted: z.coerce.number().min(0).default(0),
  qty_rejected: z.coerce.number().min(0).default(0),
  date: z.string().trim().min(1),
  notes: z.string().trim().optional(),
});
export async function addJobReceiptAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor', 'centre_manager']);
  const labourerRaw = formData.get('labourer_id');
  const parsed = ReceiptSchema.safeParse({
    item_id: formData.get('item_id'),
    labourer_id: typeof labourerRaw === 'string' && labourerRaw.length > 0 ? labourerRaw : null,
    qty_accepted: formData.get('qty_accepted') ?? 0,
    qty_rejected: formData.get('qty_rejected') ?? 0,
    date: formData.get('date'),
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success)
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  if (parsed.data.qty_accepted + parsed.data.qty_rejected <= 0) {
    return { ok: false, messageKey: 'jobWork.errors.receiptQtyRequired' };
  }
  const orderId = String(formData.get('order_id') ?? '');

  const supabase = createClient();
  const { error } = await supabase.rpc('add_job_receipt', {
    p_item_id: parsed.data.item_id,
    p_labourer_id: parsed.data.labourer_id ?? null,
    p_qty_accepted: parsed.data.qty_accepted,
    p_qty_rejected: parsed.data.qty_rejected,
    p_date: parsed.data.date,
    p_notes: parsed.data.notes ?? '',
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/job-work');
  if (orderId) revalidatePath(`/job-work/${orderId}`);
  return { ok: true };
}

// ── Close / cancel ──────────────────────────────────────────────────────────
const IdSchema = z.object({ id: z.string().uuid() });
const CancelSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1, 'common.errors.invalidInput'),
});

export async function closeJobOrderAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);
  const parsed = IdSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success)
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  const supabase = createClient();
  const { error } = await supabase.rpc('close_job_order', { p_id: parsed.data.id });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  revalidatePath('/job-work');
  revalidatePath(`/job-work/${parsed.data.id}`);
  redirect(`/job-work/${parsed.data.id}`);
}

export async function cancelJobOrderAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);
  const parsed = CancelSchema.safeParse({
    id: formData.get('id'),
    reason: formData.get('reason'),
  });
  if (!parsed.success)
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  const supabase = createClient();
  const { error } = await supabase.rpc('cancel_job_order', {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  revalidatePath('/job-work');
  revalidatePath(`/job-work/${parsed.data.id}`);
  redirect(`/job-work/${parsed.data.id}`);
}

// ── Labourers CRUD (direct table writes, RLS gates roles) ───────────────────
const LabourerSchema = z.object({
  id: z.string().uuid().optional(),
  lead_lady_id: z.string().uuid(),
  full_name: z.string().trim().min(1, 'jobWork.errors.labourerNameRequired'),
  mobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'jobWork.errors.invalidMobile')
    .optional()
    .or(z.literal('')),
  notes: z.string().trim().optional(),
  is_active: z.coerce.boolean().optional(),
});
export async function saveLabourerAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);
  const parsed = LabourerSchema.safeParse({
    id: formData.get('id') || undefined,
    lead_lady_id: formData.get('lead_lady_id'),
    full_name: formData.get('full_name'),
    mobile: formData.get('mobile') || '',
    notes: formData.get('notes') || '',
    is_active: formData.get('is_active') === 'on' || !formData.get('is_active'),
  });
  if (!parsed.success)
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };

  const supabase = createClient();
  const mobile = parsed.data.mobile ? parsed.data.mobile : null;
  if (parsed.data.id) {
    const { error } = await supabase
      .from('labourers')
      .update({
        full_name: parsed.data.full_name,
        mobile,
        notes: parsed.data.notes || null,
        is_active: parsed.data.is_active ?? true,
      })
      .eq('id', parsed.data.id);
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  } else {
    const { error } = await supabase.from('labourers').insert({
      lead_lady_id: parsed.data.lead_lady_id,
      full_name: parsed.data.full_name,
      mobile,
      notes: parsed.data.notes || null,
    });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  }

  revalidatePath(`/master-data/lead-ladies/${parsed.data.lead_lady_id}`);
  return { ok: true };
}

export async function softDeleteLabourerAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);
  const parsed = IdSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success)
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  const llId = String(formData.get('lead_lady_id') ?? '');
  const supabase = createClient();
  const { error } = await supabase
    .from('labourers')
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq('id', parsed.data.id);
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  if (llId) revalidatePath(`/master-data/lead-ladies/${llId}`);
  return { ok: true };
}
