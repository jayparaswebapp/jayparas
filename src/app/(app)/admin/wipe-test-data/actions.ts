'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { rpcErrorMessageKey } from '@/lib/rpc/errors';

const WipeSchema = z.object({
  confirm: z.string().trim(),
});

interface CountsSummary {
  invoices: number;
  invoice_lines: number;
  payments: number;
  payment_allocations: number;
  sales_returns: number;
  sales_return_lines: number;
  purchase_bills: number;
  purchase_bill_lines: number;
  journal_entries: number;
  journal_lines: number;
  job_orders: number;
  job_order_items: number;
  job_sub_assignments: number;
  job_receipts: number;
}

export type WipeResult = { ok: false; messageKey: string } | { ok: true; wiped: CountsSummary };

export async function wipeTestDataAction(
  _prev: WipeResult | null,
  formData: FormData,
): Promise<WipeResult> {
  await requireRole(['super_admin']);
  const parsed = WipeSchema.safeParse({ confirm: formData.get('confirm') });
  if (!parsed.success) {
    return { ok: false, messageKey: 'common.errors.invalidInput' };
  }
  // Belt-and-braces: the RPC also enforces exactly "WIPE", but rejecting
  // client-side saves a round-trip when the user hasn't typed it yet.
  if (parsed.data.confirm !== 'WIPE') {
    return { ok: false, messageKey: 'admin.wipe.errors.confirmationMissing' };
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc('wipe_test_data', {
    p_confirm: parsed.data.confirm,
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  // Invalidate every path that could show stale transactional data.
  revalidatePath('/', 'layout');

  const raw = (data ?? {}) as Record<string, unknown>;
  const num = (k: keyof CountsSummary) => Number(raw[k as string] ?? 0);
  return {
    ok: true,
    wiped: {
      invoices: num('invoices'),
      invoice_lines: num('invoice_lines'),
      payments: num('payments'),
      payment_allocations: num('payment_allocations'),
      sales_returns: num('sales_returns'),
      sales_return_lines: num('sales_return_lines'),
      purchase_bills: num('purchase_bills'),
      purchase_bill_lines: num('purchase_bill_lines'),
      journal_entries: num('journal_entries'),
      journal_lines: num('journal_lines'),
      job_orders: num('job_orders'),
      job_order_items: num('job_order_items'),
      job_sub_assignments: num('job_sub_assignments'),
      job_receipts: num('job_receipts'),
    },
  };
}
