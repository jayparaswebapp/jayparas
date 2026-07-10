import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Header } from '@/components/header';
import { SubNav } from '@/components/sub-nav';

export default function AccountingLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('accounting.nav');
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <Header />
      <SubNav
        items={[
          { href: '/accounting', label: t('dayBook') },
          { href: '/accounting/journal', label: t('journal') },
          { href: '/accounting/coa', label: t('coa') },
        ]}
      />
      <main className="mx-auto w-full max-w-screen-lg flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
