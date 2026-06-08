'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { rpcErrorMessageKey } from '@/lib/rpc/errors';
import type { ActionResult } from '@/lib/rpc/action-result';

const Schema = z.object({
  id: z.string().uuid(),
  name_en: z.string().trim().min(1, 'masterData.locations.errors.nameEnRequired'),
  name_gu: z.string().trim().min(1, 'masterData.locations.errors.nameGuRequired'),
  is_active: z.coerce.boolean(),
});

export async function updateLocationAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole(['super_admin']);

  const parsed = Schema.safeParse({
    id: formData.get('id'),
    name_en: formData.get('name_en'),
    name_gu: formData.get('name_gu'),
    is_active: formData.get('is_active') === 'on',
  });

  if (!parsed.success) {
    return {
      ok: false,
      messageKey: parsed.error.issues[0]?.message ?? 'common.errors.invalidInput',
    };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc('update_location', {
    p_id: parsed.data.id,
    p_name_en: parsed.data.name_en,
    p_name_gu: parsed.data.name_gu,
    p_is_active: parsed.data.is_active,
    p_reason: '',
  });

  if (error) {
    return { ok: false, messageKey: rpcErrorMessageKey(error) };
  }

  revalidatePath('/master-data/locations');
  redirect('/master-data/locations');
}
