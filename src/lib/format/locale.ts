import { cookies } from 'next/headers';
import { LOCALE_COOKIE, defaultLocale, locales, type Locale } from '@/lib/i18n/config';

export function getServerLocale(): Locale {
  const cookieValue = cookies().get(LOCALE_COOKIE)?.value;
  if (cookieValue && (locales as readonly string[]).includes(cookieValue)) {
    return cookieValue as Locale;
  }
  return defaultLocale;
}

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
