import { useTranslations } from 'next-intl';

export default function BillingInvoicesPage() {
  const tDept = useTranslations('departments');
  const t = useTranslations('departments.billing');
  return (
    <>
      <h1 className="text-2xl font-semibold text-neutral-900">{t('invoicesTitle')}</h1>
      <p className="mt-2 text-sm text-neutral-600">{t('invoicesHint')}</p>
      <div className="mt-6 rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
        {tDept('comingSoon')}
      </div>
    </>
  );
}
