import { cookies } from 'next/headers';
import { LOCALE_COOKIE, defaultLocale, locales, type Locale } from '@/lib/i18n/config';

// Re-export pure helpers so existing server-side imports of `pickLocalised`
// and `formatRupees` from this module keep working. Client components should
// import from `./locale-shared` instead (see the note in that file).
export { pickLocalised, formatRupees } from './locale-shared';

export function getServerLocale(): Locale {
  const cookieValue = cookies().get(LOCALE_COOKIE)?.value;
  if (cookieValue && (locales as readonly string[]).includes(cookieValue)) {
    return cookieValue as Locale;
  }
  return defaultLocale;
}
