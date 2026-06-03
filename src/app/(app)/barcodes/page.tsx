import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Header } from '@/components/header';

export default function BarcodesPage() {
  const tDept = useTranslations('departments');
  const tBarcode = useTranslations('departments.barcode');
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <Header />
      <main className="mx-auto w-full max-w-screen-md flex-1 px-4 py-8">
        <h1 className="text-2xl font-semibold text-neutral-900">{tBarcode('title')}</h1>
        <p className="mt-2 text-sm text-neutral-600">{tBarcode('hint')}</p>

        <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">
          {tDept('sectionTitle')}
        </h2>
        <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <li>
            <Link
              href="/skus"
              className="hover:border-brand-300 block rounded-lg border border-neutral-200 bg-white p-4 transition hover:bg-brand-50/30"
            >
              <div className="text-base font-semibold text-neutral-900">
                {tBarcode('skusTitle')}
              </div>
              <div className="mt-0.5 text-sm text-neutral-600">{tBarcode('skusHint')}</div>
            </Link>
          </li>
          <li>
            <Link
              href="/skus/print"
              className="hover:border-brand-300 block rounded-lg border border-neutral-200 bg-white p-4 transition hover:bg-brand-50/30"
            >
              <div className="text-base font-semibold text-neutral-900">
                {tBarcode('printTitle')}
              </div>
              <div className="mt-0.5 text-sm text-neutral-600">{tBarcode('printHint')}</div>
            </Link>
          </li>
        </ul>

        <div className="mt-6 rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
          {tDept('comingSoon')}
        </div>
      </main>
    </div>
  );
}
