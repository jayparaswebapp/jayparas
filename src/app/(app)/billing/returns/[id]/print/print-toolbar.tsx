'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

export function PrintToolbar({ returnId }: { returnId: string }) {
  const t = useTranslations('billing.returns.print');
  return (
    <div className="sticky top-0 z-10 border-b border-neutral-200 bg-white p-3 print:hidden">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
        <Link href={`/billing/returns/${returnId}`} className="btn-ghost border border-neutral-300">
          ← {t('backButton')}
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="btn-primary !w-auto bg-brand-700 px-4"
        >
          {t('printNowButton')}
        </button>
      </div>
    </div>
  );
}
