import { useTranslations } from 'next-intl';
import { LocaleSwitcher } from './locale-switcher';

export function Header() {
  const t = useTranslations('app');
  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-screen-md items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-neutral-900">{t('name')}</div>
          <div className="truncate text-xs text-neutral-500">{t('tagline')}</div>
        </div>
        <LocaleSwitcher />
      </div>
    </header>
  );
}
