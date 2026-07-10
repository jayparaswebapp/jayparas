'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { rpcErrorMessageKey } from '@/lib/rpc/errors';
import type { ActionResult } from '@/lib/rpc/action-result';

// ── Journal entry create ────────────────────────────────────────────────────
const LineSchema = z.object({
  account_id: z.string().uuid({ message: 'accounting.errors.accountMissing' }),
  debit: z.coerce.number().min(0).default(0),
  credit: z.coerce.number().min(0).default(0),
  note: z.string().trim().optional(),
});

const PayloadSchema = z.object({
  header: z.object({
    entry_date: z.string().trim().min(1, 'accounting.errors.dateRequired'),
    narration: z.string().trim().optional(),
  }),
  lines: z.array(LineSchema).min(2, 'accounting.errors.linesRequired'),
});

export async function createJournalEntryAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'accountant']);
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

  // Pre-flight balance check on the client-computed payload so we can show a
  // friendly error before hitting the RPC. The RPC also enforces this.
  let sumDr = 0;
  let sumCr = 0;
  for (const l of parsed.data.lines) {
    if ((l.debit > 0 && l.credit > 0) || (l.debit === 0 && l.credit === 0)) {
      return { ok: false, messageKey: 'accounting.errors.lineDrXorCr' };
    }
    sumDr += l.debit;
    sumCr += l.credit;
  }
  if (Math.abs(sumDr - sumCr) > 0.005) {
    return { ok: false, messageKey: 'accounting.errors.unbalanced' };
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc('create_journal_entry', {
    p_header: {
      entry_date: parsed.data.header.entry_date,
      narration: parsed.data.header.narration ?? '',
      source_type: 'manual',
    },
    p_lines: parsed.data.lines.map((l) => ({
      account_id: l.account_id,
      debit: l.debit,
      credit: l.credit,
      note: l.note ?? '',
    })),
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };

  const row = data as { id?: string } | null;
  if (!row?.id) return { ok: false, messageKey: 'common.errors.unknownError' };

  revalidatePath('/accounting');
  revalidatePath('/accounting/journal');
  redirect(`/accounting/journal/${row.id}`);
}

// ── Cancel journal entry ────────────────────────────────────────────────────
const CancelSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1, 'common.errors.invalidInput'),
});

export async function cancelJournalEntryAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'accountant']);
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
  const { error } = await supabase.rpc('cancel_journal_entry', {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  revalidatePath('/accounting');
  revalidatePath('/accounting/journal');
  revalidatePath(`/accounting/journal/${parsed.data.id}`);
  redirect(`/accounting/journal/${parsed.data.id}`);
}

// ── Create account ──────────────────────────────────────────────────────────
const CreateAccountSchema = z.object({
  code: z.string().trim().min(1, 'accounting.errors.codeRequired'),
  name_en: z.string().trim().min(1, 'accounting.errors.nameRequired'),
  name_gu: z.string().trim().min(1, 'accounting.errors.nameRequired'),
  parent_id: z.string().uuid({ message: 'accounting.errors.parentRequired' }),
  is_group: z.coerce.boolean().default(false),
});

export async function createAccountAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'accountant']);
  const parsed = CreateAccountSchema.safeParse({
    code: formData.get('code'),
    name_en: formData.get('name_en'),
    name_gu: formData.get('name_gu'),
    parent_id: formData.get('parent_id'),
    is_group: formData.get('is_group') === 'on',
  });
  if (!parsed.success)
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };

  const supabase = createClient();
  const { error } = await supabase.rpc('create_account', {
    p_code: parsed.data.code,
    p_name_en: parsed.data.name_en,
    p_name_gu: parsed.data.name_gu,
    p_parent_id: parsed.data.parent_id,
    p_is_group: parsed.data.is_group,
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  revalidatePath('/accounting/coa');
  redirect('/accounting/coa');
}

// ── Update account (rename / toggle active) ─────────────────────────────────
const UpdateAccountSchema = z.object({
  id: z.string().uuid(),
  name_en: z.string().trim().min(1, 'accounting.errors.nameRequired'),
  name_gu: z.string().trim().min(1, 'accounting.errors.nameRequired'),
  is_active: z.coerce.boolean().optional(),
  notes: z.string().trim().optional(),
});

export async function updateAccountAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin', 'accountant']);
  const parsed = UpdateAccountSchema.safeParse({
    id: formData.get('id'),
    name_en: formData.get('name_en'),
    name_gu: formData.get('name_gu'),
    is_active: formData.get('is_active') === 'on',
    notes: formData.get('notes') || '',
  });
  if (!parsed.success)
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  const supabase = createClient();
  const { error } = await supabase.rpc('update_account', {
    p_id: parsed.data.id,
    p_name_en: parsed.data.name_en,
    p_name_gu: parsed.data.name_gu,
    p_is_active: parsed.data.is_active ?? true,
    p_notes: parsed.data.notes ?? '',
  });
  if (error) return { ok: false, messageKey: rpcErrorMessageKey(error) };
  revalidatePath('/accounting/coa');
  return { ok: true };
}
