import type { SupabaseClient } from '@supabase/supabase-js';

export const DESIGN_IMAGES_BUCKET = 'design-images';
export const MAX_DESIGN_IMAGE_BYTES = 2 * 1024 * 1024;
export const ALLOWED_DESIGN_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type DesignImageValidation = { ok: true } | { ok: false; messageKey: string };

export function validateDesignImageFile(file: File): DesignImageValidation {
  if (file.size > MAX_DESIGN_IMAGE_BYTES) {
    return { ok: false, messageKey: 'masterData.designs.errors.imageTooLarge' };
  }
  if (!(ALLOWED_DESIGN_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, messageKey: 'masterData.designs.errors.imageWrongType' };
  }
  return { ok: true };
}

function extensionFor(file: File): string {
  if (file.type === 'image/jpeg') return 'jpg';
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  // Should be impossible after validation, but keep deterministic.
  return 'bin';
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build the storage path for a design image (per ADR-007).
 * Format: <random_hex_4>/<random_hex_12>.<ext>
 *
 * The path is decoupled from the design_id so a new image can be uploaded
 * client-side before the design row exists (avoiding Next.js's 1 MB server
 * action body limit). The 2-level prefix groups objects in the bucket UI.
 */
export function buildDesignImagePath(file: File): string {
  return `${randomHex(2)}/${randomHex(12)}.${extensionFor(file)}`;
}

/**
 * Upload a design image. Caller must already have validated the file.
 * Returns the storage path on success or an error message key.
 */
export async function uploadDesignImage(
  supabase: SupabaseClient,
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; messageKey: string }> {
  const validation = validateDesignImageFile(file);
  if (!validation.ok) return validation;
  const path = buildDesignImagePath(file);
  const { error } = await supabase.storage
    .from(DESIGN_IMAGES_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.error('[storage] design image upload failed', error);
    }
    return { ok: false, messageKey: 'common.errors.unknownError' };
  }
  return { ok: true, path };
}

/**
 * Generate a short-lived signed URL for rendering a design image.
 * Returns null if signing fails (caller should render a placeholder).
 */
export async function getDesignImageSignedUrl(
  supabase: SupabaseClient,
  path: string,
  ttlSeconds = 3600,
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(DESIGN_IMAGES_BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
