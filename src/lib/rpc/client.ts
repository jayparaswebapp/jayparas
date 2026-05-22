'use server';

import { createClient } from '@/lib/supabase/server';
import { rpcErrorMessageKey } from './errors';

export type RpcResult<T> = { ok: true; data: T } | { ok: false; messageKey: string };

/**
 * Thin server-action wrapper around supabase.rpc(). Returns a discriminated
 * union the UI can switch on without unwrapping a thrown error.
 *
 * Usage:
 *   const result = await callRpc<typeof DesignRow>('create_design', { ... });
 *   if (!result.ok) toast(t(result.messageKey));
 */
export async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    return { ok: false, messageKey: rpcErrorMessageKey(error) };
  }
  return { ok: true, data: data as T };
}
