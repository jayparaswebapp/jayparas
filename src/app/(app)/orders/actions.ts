'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { rpcErrorMessageKey } from '@/lib/rpc/errors';
import type { ActionResult } from '@/lib/rpc/action-result';
import { ORDER_BILL_ROLES, ORDER_ROLES } from '@/lib/orders/load';

const LineSchema = z.object({
  sku_id: z.string().uuid().nullable(),
  sku_snapshot: z
    .object({
      sku_code: z.string().optional(),
      design_name: z.string().optional(),
      pack_size: z.number().optional(),
      is_discountable: z.boolean().optional(),
    })
    .nullable(),
  description: z.string().trim().min(1),
  hsn_code: z.string().trim().max(10).default(''),
  uom: z.string().trim().min(1).default('Pcs'),
  rate: z.number().min(0),
  discount_pct: z.number().min(0).max(100),
  gst_pct: z.number().min(0).max(28),
  qty: z.number().positive(),
});

const PayloadSchema = z.object({
  id: z.string().uuid().optional(),
  business_line: z.enum(['rakhi', 'kite']),
  customer_id: z.string().uuid('orders.errors.partyRequired'),
  notes: z.string().max(500).optional(),
  lines: z.array(LineSchema).min(1, 'orders.errors.linesRequired').max(500),
});

export async function saveOrderAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(ORDER_ROLES);

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get('payload') ?? ''));
  } catch {
    return { ok: false, messageKey: 'common.errors.invalidInput' };
  }
  const parsed = PayloadSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? '';
    return {
      ok: false,
      messageKey: msg.startsWith('orders.') ? msg : 'common.errors.invalidInput',
    };
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc('save_order', {
    p_id: parsed.data.id ?? null,
    p_business_line: parsed.data.business_line,
    p_customer_id: parsed.data.customer_id,
    p_notes: parsed.data.notes ?? '',
    p_lines: parsed.data.lines,
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  const id = (data as { id?: string } | null)?.id;
  revalidatePath('/orders');
  return { ok: true, redirectTo: id ? `/orders/${id}` : '/orders' };
}

const IdSchema = z.object({ id: z.string().uuid() });

export async function cancelOrderAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(ORDER_ROLES);
  const parsed = IdSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { ok: false, messageKey: 'common.errors.invalidInput' };

  const supabase = createClient();
  const { error } = await supabase.rpc('cancel_order', { p_id: parsed.data.id });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/orders');
  revalidatePath(`/orders/${parsed.data.id}`);
  return { ok: true, redirectTo: `/orders/${parsed.data.id}` };
}

const PackingSchema = z.object({
  id: z.string().uuid(),
  lines: z.array(z.object({ line_id: z.string().uuid(), qty_packed: z.number().min(0) })).max(500),
  mark_ready: z.boolean(),
});

export async function saveOrderPackingAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(ORDER_ROLES);
  let lines: unknown;
  try {
    lines = JSON.parse(String(formData.get('lines') ?? '[]'));
  } catch {
    return { ok: false, messageKey: 'common.errors.invalidInput' };
  }
  const parsed = PackingSchema.safeParse({
    id: formData.get('id'),
    lines,
    mark_ready: formData.get('mark_ready') === '1',
  });
  if (!parsed.success) return { ok: false, messageKey: 'common.errors.invalidInput' };

  const supabase = createClient();
  const { error } = await supabase.rpc('save_order_packing', {
    p_id: parsed.data.id,
    p_lines: parsed.data.lines,
    p_mark_ready: parsed.data.mark_ready,
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/orders');
  revalidatePath(`/orders/${parsed.data.id}`);
  return { ok: true };
}

/** Ready order → draft bill (packed qty); unpacked qty → new pending order. */
export async function makeBillFromOrderAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(ORDER_BILL_ROLES);
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { ok: false, messageKey: 'common.errors.invalidInput' };

  const supabase = createClient();
  const { data, error } = await supabase.rpc('create_invoice_from_order', { p_id: id.data });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  const invoiceId = (data as { id?: string } | null)?.id;
  revalidatePath('/orders');
  revalidatePath(`/orders/${id.data}`);
  revalidatePath('/billing/invoices');
  return {
    ok: true,
    redirectTo: invoiceId ? `/billing/invoices/${invoiceId}` : `/orders/${id.data}`,
  };
}
