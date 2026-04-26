'use client';

import { useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { setLocaleAction } from '@/lib/i18n/actions';
import { locales, type Locale } from '@/lib/i18n/config';
import { cn } from '@/lib/utils';

export function LocaleSwitcher() {
  const current = useLocale() as Locale;
  const t = useTranslations('locale');
  const [isPending, startTransition] = useTransition();

  function pick(next: Locale) {
    if (next === current || isPending) return;
    const fd = new FormData();
    fd.set('locale', next);
    startTransition(() => {
      void setLocaleAction(fd);
    });
  }

  return (
    <div
      role="group"
      aria-label={t('switchTo')}
      className="inline-flex overflow-hidden rounded-lg border border-neutral-300 bg-white text-sm"
    >
      {locales.map((loc) => (
        <button
          key={loc}
          type="button"
          onClick={() => pick(loc)}
          aria-pressed={current === loc}
          disabled={isPending}
          className={cn(
            'min-h-tap min-w-tap px-3 py-2 transition',
            current === loc ? 'bg-brand-700 text-white' : 'text-neutral-700 hover:bg-neutral-100',
          )}
        >
          {loc === 'gu' ? t('gujarati') : t('english')}
        </button>
      ))}
    </div>
  );
}
