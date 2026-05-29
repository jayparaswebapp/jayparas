import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Header } from '@/components/header';
import { SubNav } from '@/components/sub-nav';

export default function SkusLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('nav');
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <Header />
      <SubNav
        items={[
          { href: '/skus', label: t('skusLibrary') },
          { href: '/skus/new', label: t('skusNew') },
          { href: '/skus/print', label: t('skusPrint') },
        ]}
      />
      <main className="mx-auto w-full max-w-screen-md flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
