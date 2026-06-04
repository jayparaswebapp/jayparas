/**
 * Maps RPC error keys raised by the SECURITY DEFINER functions in
 * migration 20260427000008_rpc_mutations.sql to next-intl message keys.
 *
 * Per ADR-005, the RPC layer is the single source of truth for audit-context
 * propagation; here we close the loop by translating its error contract into
 * bilingual UI messages.
 *
 * Add a new entry here whenever an RPC raises a new error key.
 */

export const RPC_ERROR_KEYS = [
  'session_invalid',
  'permission_denied',
  'reason_required',
  'mobile_taken',
  'design_number_taken',
  'sku_duplicate',
  'gstin_taken',
  'group_name_taken',
  'not_found',
  'self_modification_forbidden',
  'centre_manager_locations_exist',
  'setting_locked',
  'invalid_input',
] as const;

export type RpcErrorKey = (typeof RPC_ERROR_KEYS)[number];

const RPC_TO_I18N: Record<RpcErrorKey, string> = {
  session_invalid: 'common.errors.sessionInvalid',
  permission_denied: 'common.errors.permissionDenied',
  reason_required: 'common.errors.reasonRequired',
  mobile_taken: 'common.errors.mobileAlreadyExists',
  design_number_taken: 'common.errors.designNumberAlreadyExists',
  sku_duplicate: 'skus.errors.duplicate',
  gstin_taken: 'common.errors.gstinAlreadyExists',
  group_name_taken: 'common.errors.groupNameAlreadyExists',
  not_found: 'common.errors.notFound',
  self_modification_forbidden: 'common.errors.cannotModifySelf',
  centre_manager_locations_exist: 'common.errors.centreManagerLocationsExist',
  setting_locked: 'common.errors.settingLocked',
  invalid_input: 'common.errors.invalidInput',
};

export const FALLBACK_ERROR_KEY = 'common.errors.unknownError';

function isRpcErrorKey(value: string): value is RpcErrorKey {
  return (RPC_ERROR_KEYS as readonly string[]).includes(value);
}

/** Extract a stable RPC error key from a Supabase rpc() error, or null. */
export function rpcErrorKey(error: unknown): RpcErrorKey | null {
  if (!error || typeof error !== 'object') return null;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return null;
  return isRpcErrorKey(message) ? message : null;
}

/**
 * Translate an unknown Supabase RPC error into a next-intl message key.
 * Logs the raw error to console.error when falling back, so debug info is
 * visible in the browser without leaking Postgres text into the UI.
 */
export function rpcErrorMessageKey(error: unknown): string {
  const key = rpcErrorKey(error);
  if (key) return RPC_TO_I18N[key];
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line no-console
    console.error('[rpc] unmapped error', error);
  }
  return FALLBACK_ERROR_KEY;
}
