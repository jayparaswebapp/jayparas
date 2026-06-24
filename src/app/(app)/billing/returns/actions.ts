'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { rpcErrorMessageKey } from '@/lib/rpc/errors';
import type { ActionResult } from '@/lib/rpc/action-result';

const LineSchema = z.object({
  invoice_line_id: z.string().uuid().nullable().optional(),
  sku_id: z.string().uuid().nullable().optional(),
  sku_snapshot: z
    .object({
      sku_code: z.string().optional(),
      design_name: z.string().optional(),
      pack_size: z.number().int().optional(),
      is_discountable: z.boolean().optional(),
    })
    .nullable()
    .optional(),
  description: z.string().trim().min(1, 'billing.returns.errors.linesRequired'),
  hsn_code: z.string().trim().nullable().optional(),
  qty: z.coerce.number().gt(0, 'billing.returns.errors.qtyRequired'),
  uom: z.string().trim().default('Pcs'),
  rate: z.coerce.number().min(0),
  discount_pct: z.coerce.number().min(0).max(100).default(0),
  gst_pct: z.coerce.number().min(0).max(100).default(0),
});

const HeaderSchema = z.object({
  id: z.string().uuid().optional(),
  invoice_id: z.string().uuid({ message: 'billing.returns.errors.invoiceRequired' }),
  return_date: z.string().trim().min(1, 'billing.returns.errors.dateRequired'),
  reason: z.string().trim().optional(),
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
    invoice_id: h.invoice_id,
    return_date: h.return_date,
    reason: h.reason ?? '',
    notes: h.notes ?? '',
  };
}

function linesToRpc(lines: Payload['lines']): Record<string, unknown>[] {
  return lines.map((l) => ({
    invoice_line_id: l.invoice_line_id ?? '',
    sku_id: l.sku_id ?? '',
    sku_snapshot: l.sku_snapshot ?? null,
    description: l.description,
    hsn_code: l.hsn_code ?? '',
    qty: l.qty,
    uom: l.uom || 'Pcs',
    rate: l.rate,
    discount_pct: l.discount_pct ?? 0,
    gst_pct: l.gst_pct ?? 0,
  }));
}

export async function saveSalesReturnDraftAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);

  const payload = parsePayload(formData);
  if (!payload.ok) return payload;

  if (payload.data.lines.length === 0) {
    return { ok: false, messageKey: 'billing.returns.errors.linesRequired' };
  }

  const supabase = createClient();
  const issue = formData.get('and_issue') === '1';
  const id = payload.data.header.id;

  let returnId = id ?? '';
  if (!id) {
    const { data, error } = await supabase.rpc('create_sales_return_draft', {
      p_header: headerToRpc(payload.data.header),
      p_lines: linesToRpc(payload.data.lines),
    });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
    returnId = (data as { id?: string } | null)?.id ?? '';
  } else {
    const { error } = await supabase.rpc('update_sales_return_draft', {
      p_id: id,
      p_header: headerToRpc(payload.data.header),
      p_lines: linesToRpc(payload.data.lines),
    });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
    returnId = id;
  }

  if (issue && returnId) {
    const { error } = await supabase.rpc('issue_sales_return', { p_id: returnId });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  }

  revalidatePath('/billing/returns');
  revalidatePath('/billing/invoices');
  redirect(returnId ? `/billing/returns/${returnId}` : '/billing/returns');
}

const IdSchema = z.object({ id: z.string().uuid() });
const CancelSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1, 'common.errors.invalidInput'),
});

export async function issueSalesReturnAction(
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
  const { error } = await supabase.rpc('issue_sales_return', { p_id: parsed.data.id });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/billing/returns');
  revalidatePath('/billing/invoices');
  revalidatePath(`/billing/returns/${parsed.data.id}`);
  redirect(`/billing/returns/${parsed.data.id}`);
}

export async function cancelSalesReturnAction(
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
  const { error } = await supabase.rpc('cancel_sales_return', {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/billing/returns');
  revalidatePath('/billing/invoices');
  revalidatePath(`/billing/returns/${parsed.data.id}`);
  redirect(`/billing/returns/${parsed.data.id}`);
}

export async function deleteSalesReturnDraftAction(
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
  const { error } = await supabase.rpc('delete_sales_return_draft', { p_id: parsed.data.id });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/billing/returns');
  redirect('/billing/returns');
}
