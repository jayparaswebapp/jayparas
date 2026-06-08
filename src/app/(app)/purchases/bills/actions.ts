'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { rpcErrorMessageKey } from '@/lib/rpc/errors';
import type { ActionResult } from '@/lib/rpc/action-result';

const BusinessLine = z.enum(['rakhi', 'kite']);

const LineSchema = z.object({
  item_id: z.string().uuid().nullable().optional(),
  item_snapshot: z
    .object({
      item_code: z.string().optional(),
      name: z.string().optional(),
      uom: z.string().optional(),
    })
    .nullable()
    .optional(),
  description: z.string().trim().min(1, 'purchases.bills.errors.linesRequired'),
  hsn_code: z.string().trim().nullable().optional(),
  qty: z.coerce.number().gt(0, 'purchases.bills.errors.qtyRequired'),
  uom: z.string().trim().default('pcs'),
  rate: z.coerce.number().min(0, 'purchases.bills.errors.rateRequired'),
  discount_pct: z.coerce.number().min(0).max(100).default(0),
  gst_pct: z.coerce.number().min(0).max(100).default(0),
});

const HeaderSchema = z.object({
  id: z.string().uuid().optional(),
  business_line: BusinessLine,
  supplier_id: z.string().uuid().nullable().optional(),
  supplier_bill_number: z.string().trim().optional(),
  bill_date: z.string().trim().min(1),
  place_of_supply: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const PayloadSchema = z.object({
  header: HeaderSchema,
  lines: z.array(LineSchema),
});

type Payload = z.infer<typeof PayloadSchema>;

function parsePayload(
  formData: FormData,
): { ok: true; data: Payload } | { ok: false; messageKey: string } {
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
  return { ok: true, data: parsed.data };
}

function headerToRpc(h: Payload['header']): Record<string, unknown> {
  return {
    business_line: h.business_line,
    supplier_id: h.supplier_id ?? '',
    supplier_bill_number: h.supplier_bill_number ?? '',
    bill_date: h.bill_date,
    place_of_supply: h.place_of_supply ?? '',
    notes: h.notes ?? '',
  };
}

function linesToRpc(lines: Payload['lines']): Record<string, unknown>[] {
  return lines.map((l) => ({
    item_id: l.item_id ?? '',
    item_snapshot: l.item_snapshot ?? null,
    description: l.description,
    hsn_code: l.hsn_code ?? '',
    qty: l.qty,
    uom: l.uom || 'pcs',
    rate: l.rate,
    discount_pct: l.discount_pct ?? 0,
    gst_pct: l.gst_pct ?? 0,
  }));
}

export async function savePurchaseBillDraftAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);

  const payload = parsePayload(formData);
  if (!payload.ok) return payload;

  if (payload.data.lines.length === 0) {
    return { ok: false, messageKey: 'purchases.bills.errors.linesRequired' };
  }

  const supabase = createClient();
  const post = formData.get('and_post') === '1';
  const id = payload.data.header.id;

  let billId = id ?? '';
  if (!id) {
    const { data, error } = await supabase.rpc('create_purchase_bill_draft', {
      p_header: headerToRpc(payload.data.header),
      p_lines: linesToRpc(payload.data.lines),
    });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
    billId = (data as { id?: string } | null)?.id ?? '';
  } else {
    const { error } = await supabase.rpc('update_purchase_bill_draft', {
      p_id: id,
      p_header: headerToRpc(payload.data.header),
      p_lines: linesToRpc(payload.data.lines),
    });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
    billId = id;
  }

  if (post && billId) {
    const { error } = await supabase.rpc('post_purchase_bill', { p_id: billId });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  }

  revalidatePath('/purchases/bills');
  redirect(billId ? `/purchases/bills/${billId}` : '/purchases/bills');
}

const IdSchema = z.object({ id: z.string().uuid() });

export async function postPurchaseBillAction(
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
  const { error } = await supabase.rpc('post_purchase_bill', { p_id: parsed.data.id });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  revalidatePath('/purchases/bills');
  revalidatePath(`/purchases/bills/${parsed.data.id}`);
  redirect(`/purchases/bills/${parsed.data.id}`);
}

export async function cancelPurchaseBillAction(
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
  const { error } = await supabase.rpc('cancel_purchase_bill', { p_id: parsed.data.id });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  revalidatePath('/purchases/bills');
  revalidatePath(`/purchases/bills/${parsed.data.id}`);
  redirect(`/purchases/bills/${parsed.data.id}`);
}

export async function deletePurchaseBillDraftAction(
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
  const { error } = await supabase.rpc('delete_purchase_bill_draft', { p_id: parsed.data.id });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  revalidatePath('/purchases/bills');
  redirect('/purchases/bills');
}
