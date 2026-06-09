'use server';

import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { extractBillFromImage, type ExtractedBill } from '@/lib/purchases/scan-bill';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

export type ScanBillSuccess = {
  ok: true;
  data: ExtractedBill;
  /** ID of the supplier in our DB whose GSTIN matches the invoice. Null if no match. */
  matchedSupplierId: string | null;
};

export type ScanBillError = {
  ok: false;
  error:
    | 'no_image'
    | 'image_too_large'
    | 'unsupported_image_type'
    | 'api_key_missing'
    | 'extraction_failed';
};

export type ScanBillResult = ScanBillSuccess | ScanBillError;

export async function scanBillAction(formData: FormData): Promise<ScanBillResult> {
  await requireRole(['super_admin', 'supervisor']);

  const file = formData.get('image');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'no_image' };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: 'image_too_large' };
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return { ok: false, error: 'unsupported_image_type' };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: 'api_key_missing' };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString('base64');
  const mimeType = (file.type === 'image/jpg' ? 'image/jpeg' : file.type) as
    | 'image/jpeg'
    | 'image/png'
    | 'image/webp';

  let extracted: ExtractedBill;
  try {
    extracted = await extractBillFromImage(base64, mimeType);
  } catch (err) {
    console.error('Bill extraction failed:', err);
    return { ok: false, error: 'extraction_failed' };
  }

  let matchedSupplierId: string | null = null;
  const gstin = extracted.supplier.gstin?.trim().toUpperCase() ?? null;
  if (gstin) {
    const supabase = createClient();
    const { data } = await supabase
      .from('suppliers')
      .select('id')
      .eq('gstin', gstin)
      .is('deleted_at', null)
      .maybeSingle();
    matchedSupplierId = data?.id ?? null;
  }

  return { ok: true, data: extracted, matchedSupplierId };
}
