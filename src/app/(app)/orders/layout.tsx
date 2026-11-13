import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Header } from '@/components/header';
import { SubNav } from '@/components/sub-nav';

export default function OrdersLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('departments.orders');
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <Header />
      <SubNav
        items={[
          { href: '/orders', label: t('listTitle') },
          { href: '/orders/new', label: t('newTitle') },
        ]}
      />
      <main className="mx-auto w-full max-w-screen-md flex-1 px-4 py-6 xl:max-w-screen-xl">
        {children}
      </main>
    </div>
  );
}
