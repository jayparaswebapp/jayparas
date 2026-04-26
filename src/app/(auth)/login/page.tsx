import { useTranslations } from 'next-intl';
import { Header } from '@/components/header';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const t = useTranslations('login');
  return (
    <main className="flex min-h-screen flex-col bg-neutral-50">
      <Header />
      <div className="mx-auto w-full max-w-screen-sm flex-1 px-4 py-8">
        <div className="mx-auto max-w-sm">
          <h1 className="text-2xl font-semibold text-neutral-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-neutral-600">{t('subtitle')}</p>
          <div className="mt-6">
            <LoginForm next={searchParams.next} />
          </div>
        </div>
      </div>
    </main>
  );
}
