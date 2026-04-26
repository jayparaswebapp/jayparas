export const locales = ['gu', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'gu';
export const LOCALE_COOKIE = 'jp_locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}
