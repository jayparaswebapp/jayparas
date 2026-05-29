import type { SupabaseClient } from '@supabase/supabase-js';

export const SKU_PHOTOS_BUCKET = 'sku-photos';
export const MAX_SKU_PHOTO_BYTES = 4 * 1024 * 1024;
export const ALLOWED_SKU_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_SKU_PHOTO_EDGE_PX = 1024;

export type SkuPhotoValidation = { ok: true } | { ok: false; messageKey: string };

export function validateSkuPhotoFile(file: File): SkuPhotoValidation {
  if (file.size > MAX_SKU_PHOTO_BYTES) {
    return { ok: false, messageKey: 'skus.errors.photoTooLarge' };
  }
  if (!(ALLOWED_SKU_PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, messageKey: 'skus.errors.photoWrongType' };
  }
  return { ok: true };
}

function extensionFor(file: File | Blob, fallbackName?: string): string {
  const type = (file as File).type ?? '';
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  const name = fallbackName ?? '';
  const dot = name.lastIndexOf('.');
  if (dot >= 0) return name.slice(dot + 1).toLowerCase();
  return 'bin';
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Path convention (see ADR-009): `<random_hex_2>/<random_hex_12>.<ext>`.
 * Decoupled from the sku_id so the photo can be uploaded client-side before
 * the row exists (avoiding the 1 MB server-action body limit).
 */
export function buildSkuPhotoPath(file: File | Blob, fallbackName?: string): string {
  return `${randomHex(2)}/${randomHex(12)}.${extensionFor(file, fallbackName)}`;
}

/**
 * Optional client-side downscale before upload. Keeps the library grid quick
 * on mid-range phones and avoids 5–10 MB camera JPEGs hammering Storage.
 *
 * If the file is already within MAX_SKU_PHOTO_EDGE_PX, returns it unchanged
 * (no recompression). Returns the original file if the browser can't decode
 * the image (e.g. an exotic colour profile) rather than failing the upload.
 */
export async function maybeDownscalePhoto(file: File): Promise<File | Blob> {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_SKU_PHOTO_EDGE_PX) {
      bitmap.close();
      return file;
    }
    const scale = MAX_SKU_PHOTO_EDGE_PX / longest;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

export async function uploadSkuPhoto(
  supabase: SupabaseClient,
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; messageKey: string }> {
  const validation = validateSkuPhotoFile(file);
  if (!validation.ok) return validation;

  const blob = await maybeDownscalePhoto(file);
  const path = buildSkuPhotoPath(blob, file.name);
  const contentType =
    'type' in blob && blob.type
      ? blob.type
      : file.type === 'image/png'
        ? 'image/png'
        : 'image/jpeg';

  const { error } = await supabase.storage
    .from(SKU_PHOTOS_BUCKET)
    .upload(path, blob, { contentType, upsert: false });
  if (error) {
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.error('[storage] sku photo upload failed', error);
    }
    return { ok: false, messageKey: 'common.errors.unknownError' };
  }
  return { ok: true, path };
}

/**
 * Return the public URL for a stored SKU photo. The bucket is public at v1
 * (ADR-009) so no signing round-trip is needed for the library grid or
 * detail screen.
 */
export function getSkuPhotoPublicUrl(supabase: SupabaseClient, path: string | null): string | null {
  if (!path) return null;
  const { data } = supabase.storage.from(SKU_PHOTOS_BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? null;
}
