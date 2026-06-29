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
  'mobile_taken',
  'design_number_taken',
  'sku_duplicate',
  'gstin_taken',
  'group_name_taken',
  'supplier_mobile_taken',
  'supplier_gstin_taken',
  'item_code_taken',
  'invoice_not_editable',
  'company_info_missing',
  'invoice_lines_required',
  'invoice_customer_missing',
  'purchase_bill_not_editable',
  'purchase_supplier_missing',
  'purchase_lines_required',
  'purchase_company_missing',
  'invoice_overallocated',
  'payment_overallocated',
  'invoice_customer_mismatch',
  'invoice_not_payable',
  'payment_customer_missing',
  'payment_already_cancelled',
  'sales_return_invoice_missing',
  'sales_return_invoice_not_issued',
  'sales_return_not_editable',
  'sales_return_lines_required',
  'sales_return_exceeds_invoice',
  'sales_return_customer_missing',
  'sales_return_already_cancelled',
  'sales_return_not_cancellable',
  'job_order_ll_missing',
  'job_order_location_missing',
  'job_order_items_required',
  'job_order_qty_required',
  'job_order_design_required',
  'job_order_not_open',
  'job_order_already_cancelled',
  'job_sub_qty_required',
  'job_labourer_missing',
  'job_labourer_wrong_ll',
  'job_sub_exceeds_issued',
  'job_receipt_qty_required',
  'job_receipt_exceeds_labourer',
  'job_receipt_exceeds_issued',
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
  mobile_taken: 'common.errors.mobileAlreadyExists',
  design_number_taken: 'common.errors.designNumberAlreadyExists',
  sku_duplicate: 'skus.errors.duplicate',
  gstin_taken: 'common.errors.gstinAlreadyExists',
  group_name_taken: 'common.errors.groupNameAlreadyExists',
  supplier_mobile_taken: 'purchases.suppliers.errors.mobileTaken',
  supplier_gstin_taken: 'purchases.suppliers.errors.gstinTaken',
  item_code_taken: 'purchases.items.errors.codeTaken',
  invoice_not_editable: 'billing.invoices.errors.notEditable',
  company_info_missing: 'billing.invoices.errors.companyMissing',
  invoice_lines_required: 'billing.invoices.errors.linesRequired',
  invoice_customer_missing: 'billing.invoices.errors.customerMissing',
  purchase_bill_not_editable: 'purchases.bills.errors.notEditable',
  purchase_supplier_missing: 'purchases.bills.errors.supplierMissing',
  purchase_lines_required: 'purchases.bills.errors.linesRequired',
  purchase_company_missing: 'purchases.bills.errors.companyMissing',
  invoice_overallocated: 'billing.payments.errors.invoiceOverallocated',
  payment_overallocated: 'billing.payments.errors.allocationSumMismatch',
  invoice_customer_mismatch: 'billing.payments.errors.invoiceCustomerMismatch',
  invoice_not_payable: 'billing.payments.errors.invoiceNotPayable',
  payment_customer_missing: 'billing.payments.errors.customerRequired',
  payment_already_cancelled: 'common.errors.invalidInput',
  sales_return_invoice_missing: 'billing.returns.errors.invoiceMissing',
  sales_return_invoice_not_issued: 'billing.returns.errors.invoiceNotIssued',
  sales_return_not_editable: 'billing.returns.errors.notEditable',
  sales_return_lines_required: 'billing.returns.errors.linesRequired',
  sales_return_exceeds_invoice: 'billing.returns.errors.exceedsInvoice',
  sales_return_customer_missing: 'billing.returns.errors.customerMissing',
  sales_return_already_cancelled: 'billing.returns.errors.alreadyCancelled',
  sales_return_not_cancellable: 'billing.returns.errors.notCancellable',
  job_order_ll_missing: 'jobWork.errors.leadLadyRequired',
  job_order_location_missing: 'jobWork.errors.locationMissing',
  job_order_items_required: 'jobWork.errors.itemsRequired',
  job_order_qty_required: 'jobWork.errors.qtyRequired',
  job_order_design_required: 'jobWork.errors.designRequired',
  job_order_not_open: 'jobWork.errors.notOpen',
  job_order_already_cancelled: 'jobWork.errors.alreadyCancelled',
  job_sub_qty_required: 'jobWork.errors.qtyRequired',
  job_labourer_missing: 'jobWork.errors.labourerRequired',
  job_labourer_wrong_ll: 'jobWork.errors.labourerWrongLl',
  job_sub_exceeds_issued: 'jobWork.errors.subExceedsIssued',
  job_receipt_qty_required: 'jobWork.errors.receiptQtyRequired',
  job_receipt_exceeds_labourer: 'jobWork.errors.receiptExceedsLabourer',
  job_receipt_exceeds_issued: 'jobWork.errors.receiptExceedsIssued',
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
