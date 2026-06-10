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
  description: z.string().trim().min(1, 'billing.invoices.errors.linesRequired'),
  hsn_code: z.string().trim().nullable().optional(),
  qty: z.coerce.number().gt(0, 'billing.invoices.errors.qtyRequired'),
  uom: z.string().trim().default('Pcs'),
  rate: z.coerce.number().min(0, 'billing.invoices.errors.rateRequired'),
  discount_pct: z.coerce.number().min(0).max(100).default(0),
  gst_pct: z.coerce.number().min(0).max(100).default(0),
});

const HeaderSchema = z.object({
  id: z.string().uuid().optional(),
  business_line: BusinessLine,
  customer_id: z.string().uuid().nullable().optional(),
  invoice_date: z.string().trim().min(1),
  place_of_supply: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  terms: z.string().trim().optional(),
  packing_charges: z.coerce.number().min(0).default(0),
  delivery_charges: z.coerce.number().min(0).default(0),
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
    customer_id: h.customer_id ?? '',
    invoice_date: h.invoice_date,
    due_date: '',
    place_of_supply: h.place_of_supply ?? '',
    notes: h.notes ?? '',
    terms: h.terms ?? '',
    packing_charges: h.packing_charges ?? 0,
    delivery_charges: h.delivery_charges ?? 0,
  };
}

/**
 * Sort + group lines into the order they should appear on the saved/printed
 * invoice: discountable items first (A→Z by design name / description),
 * then non-discountable items (A→Z). Stable within each group. The
 * "discountable" flag comes from sku_snapshot.is_discountable, frozen at
 * line-pick time. Manual lines (no SKU) have no snapshot so they default
 * to non-discountable.
 */
function sortAndGroupLines(lines: Payload['lines']): Payload['lines'] {
  const sortKey = (l: Payload['lines'][number]) =>
    (l.sku_snapshot?.design_name ?? l.description).trim().toLowerCase();
  const isDiscountable = (l: Payload['lines'][number]) => l.sku_snapshot?.is_discountable === true;
  const discountable = lines
    .filter(isDiscountable)
    .slice()
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const nonDiscountable = lines
    .filter((l) => !isDiscountable(l))
    .slice()
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  return [...discountable, ...nonDiscountable];
}

function linesToRpc(lines: Payload['lines']): Record<string, unknown>[] {
  return sortAndGroupLines(lines).map((l) => ({
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

export async function saveInvoiceDraftAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);

  const payload = parsePayload(formData);
  if (!payload.ok) return payload;

  if (payload.data.lines.length === 0) {
    return { ok: false, messageKey: 'billing.invoices.errors.linesRequired' };
  }

  const supabase = createClient();
  const issue = formData.get('and_issue') === '1';
  const id = payload.data.header.id;

  let invoiceId = id ?? '';
  if (!id) {
    const { data, error } = await supabase.rpc('create_invoice_draft', {
      p_header: headerToRpc(payload.data.header),
      p_lines: linesToRpc(payload.data.lines),
    });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
    invoiceId = (data as { id?: string } | null)?.id ?? '';
  } else {
    const { error } = await supabase.rpc('update_invoice_draft', {
      p_id: id,
      p_header: headerToRpc(payload.data.header),
      p_lines: linesToRpc(payload.data.lines),
    });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
    invoiceId = id;
  }

  if (issue && invoiceId) {
    const { error } = await supabase.rpc('issue_invoice', { p_id: invoiceId });
    if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  }

  revalidatePath('/billing/invoices');
  redirect(invoiceId ? `/billing/invoices/${invoiceId}` : '/billing/invoices');
}

const IdSchema = z.object({ id: z.string().uuid() });

export async function issueInvoiceAction(
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
  const { error } = await supabase.rpc('issue_invoice', { p_id: parsed.data.id });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/billing/invoices');
  revalidatePath(`/billing/invoices/${parsed.data.id}`);
  redirect(`/billing/invoices/${parsed.data.id}`);
}

export async function cancelInvoiceAction(
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
  const { error } = await supabase.rpc('cancel_invoice', { p_id: parsed.data.id });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/billing/invoices');
  revalidatePath(`/billing/invoices/${parsed.data.id}`);
  redirect(`/billing/invoices/${parsed.data.id}`);
}

export async function deleteInvoiceDraftAction(
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
  const { error } = await supabase.rpc('delete_invoice_draft', { p_id: parsed.data.id });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/billing/invoices');
  redirect('/billing/invoices');
}
