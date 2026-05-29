/**
 * Client-safe locale helpers. Lives separate from `./locale.ts` because that
 * file imports `next/headers` (server-only) for `getServerLocale`, which
 * webpack drags into every client component that depends on it. Splitting
 * keeps the pure helpers usable from both sides without inflating client
 * bundles or breaking the App Router build.
 */

import type { Locale } from '@/lib/i18n/config';

export function pickLocalised(
  locale: Locale,
  enValue: string | null | undefined,
  guValue: string | null | undefined,
): string {
  if (locale === 'gu') return guValue || enValue || '';
  return enValue || guValue || '';
}

export function formatRupees(amount: number, locale: Locale): string {
  const fmt = new Intl.NumberFormat(locale === 'gu' ? 'gu-IN' : 'en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `₹ ${fmt.format(amount)}`;
}
