import Link from 'next/link';
import { useTranslations } from 'next-intl';

const SECTIONS = [
  { key: 'customers', href: '/billing/customers' },
  { key: 'invoices', href: '/billing/invoices' },
  { key: 'payments', href: '/billing/payments' },
  { key: 'returns', href: '/billing/returns' },
] as const;

export default function BillingPage() {
  const t = useTranslations('departments.billing');
  return (
    <>
      <h1 className="text-2xl font-semibold text-neutral-900">{t('title')}</h1>
      <p className="mt-2 text-sm text-neutral-600">{t('hint')}</p>

      <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <li key={section.key}>
            <Link
              href={section.href}
              className="hover:border-brand-300 block rounded-lg border border-neutral-200 bg-white p-4 transition hover:bg-brand-50/30"
            >
              <div className="text-base font-semibold text-neutral-900">
                {t(`${section.key}Title`)}
              </div>
              <div className="mt-0.5 text-sm text-neutral-600">{t(`${section.key}Hint`)}</div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
