'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { Header } from '@/components/header';
import { SubNav } from '@/components/sub-nav';

export default function SkusLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('nav');
  const pathname = usePathname();

  // The label print sheet renders bare — no Header, SubNav, or min-h-screen
  // wrapper. The wrapping flex column with min-h-screen makes Chrome's
  // pagination engine pad the document to viewport height, which produces
  // extra blank pages and so extra blank stickers fed by the thermal printer.
  // Returning children directly keeps the print page inside only the root
  // html/body, where the @media print rules in print-sheet.tsx fully
  // control document height.
  if (pathname === '/skus/print/sheet') {
    return <>{children}</>;
  }

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
