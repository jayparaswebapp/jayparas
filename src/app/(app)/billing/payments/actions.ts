'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { rpcErrorKey, rpcErrorMessageKey } from '@/lib/rpc/errors';
import type { ActionResult } from '@/lib/rpc/action-result';

const AllocationSchema = z.object({
  invoice_id: z.string().uuid(),
  amount_applied: z.coerce.number().gt(0),
});

const HeaderSchema = z.object({
  customer_id: z.string().uuid({ message: 'billing.payments.errors.customerRequired' }),
  payment_date: z.string().trim().min(1, 'billing.payments.errors.dateRequired'),
  payment_method: z.enum(['cash', 'upi', 'bank_transfer']),
  amount: z.coerce.number().gt(0, 'billing.payments.errors.amountRequired'),
  reference_no: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const PayloadSchema = z.object({
  header: HeaderSchema,
  allocations: z.array(AllocationSchema).min(1, 'billing.payments.errors.allocationsRequired'),
});

export async function createPaymentAction(
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

  // Cross-field: sum(allocations) must equal amount (form should already
  // enforce this, but defence-in-depth — the RPC also checks).
  const allocSum = parsed.data.allocations.reduce((acc, a) => acc + a.amount_applied, 0);
  if (Math.abs(allocSum - parsed.data.header.amount) > 0.005) {
    return { ok: false, messageKey: 'billing.payments.errors.allocationSumMismatch' };
  }
  // UPI / bank methods need a reference number; cash can leave it blank.
  if (
    (parsed.data.header.payment_method === 'upi' ||
      parsed.data.header.payment_method === 'bank_transfer') &&
    !parsed.data.header.reference_no
  ) {
    return { ok: false, messageKey: 'billing.payments.errors.referenceRequired' };
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc('create_payment', {
    p_header: {
      customer_id: parsed.data.header.customer_id,
      payment_date: parsed.data.header.payment_date,
      payment_method: parsed.data.header.payment_method,
      amount: parsed.data.header.amount,
      reference_no: parsed.data.header.reference_no ?? '',
      notes: parsed.data.header.notes ?? '',
    },
    p_allocations: parsed.data.allocations,
  });

  if (error) {
    const key = rpcErrorKey(error);
    const friendlyKey =
      key === 'invoice_overallocated'
        ? 'billing.payments.errors.invoiceOverallocated'
        : key === 'payment_overallocated'
          ? 'billing.payments.errors.allocationSumMismatch'
          : key === 'invoice_customer_mismatch'
            ? 'billing.payments.errors.invoiceCustomerMismatch'
            : key === 'invoice_not_payable'
              ? 'billing.payments.errors.invoiceNotPayable'
              : key === 'payment_customer_missing'
                ? 'billing.payments.errors.customerRequired'
                : rpcErrorMessageKey(error);
    return { ok: false, messageKey: friendlyKey };
  }

  const row = data as { id?: string } | null;
  if (!row?.id) return { ok: false, messageKey: 'common.errors.unknownError' };

  revalidatePath('/billing/payments');
  redirect(`/billing/payments/${row.id}`);
}

const CancelSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1, 'common.errors.invalidInput'),
});

export async function cancelPaymentAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'supervisor']);
  const parsed = CancelSchema.safeParse({
    id: formData.get('id'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc('cancel_payment', {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  revalidatePath('/billing/payments');
  revalidatePath(`/billing/payments/${parsed.data.id}`);
  redirect(`/billing/payments/${parsed.data.id}`);
}
