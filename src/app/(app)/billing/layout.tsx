import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Header } from '@/components/header';
import { SubNav } from '@/components/sub-nav';

export default function BillingLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('departments.billing');
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <Header />
      <SubNav
        items={[
          { href: '/billing/customers', label: t('customersTitle') },
          { href: '/billing/groups', label: t('groupsTitle') },
          { href: '/billing/invoices', label: t('invoicesTitle') },
          { href: '/billing/payments', label: t('paymentsTitle') },
          { href: '/billing/returns', label: t('returnsTitle') },
        ]}
      />
      <main className="mx-auto w-full max-w-screen-md flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
