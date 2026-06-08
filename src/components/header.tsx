import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LocaleSwitcher } from './locale-switcher';

export function Header() {
  const t = useTranslations('app');
  const tNav = useTranslations('nav');
  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-screen-md items-center justify-between gap-4 px-4 py-3">
        <Link
          href="/dashboard"
          aria-label={tNav('home')}
          className="-mx-2 inline-flex min-h-tap items-center rounded-md px-2 text-lg font-semibold text-neutral-900 transition hover:bg-neutral-100"
        >
          {t('name')}
        </Link>
        <LocaleSwitcher />
      </div>
    </header>
  );
}
