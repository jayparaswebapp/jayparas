import { redirect } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/header';
import { signOutAction } from '@/lib/auth/login';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: appUser } = await supabase
    .from('app_users')
    .select('full_name, role')
    .eq('auth_user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!appUser) {
    // Auth user exists but no app_users row — sign them out cleanly.
    await supabase.auth.signOut();
    redirect('/login');
  }

  return <DashboardView name={appUser.full_name} role={appUser.role} />;
}

function DashboardView({ name, role }: { name: string; role: string }) {
  const t = useTranslations('dashboard');
  const tRoles = useTranslations('roles');
  return (
    <main className="flex min-h-screen flex-col bg-neutral-50">
      <Header />
      <div className="mx-auto w-full max-w-screen-md flex-1 px-4 py-8">
        <h1 className="text-2xl font-semibold text-neutral-900">
          {t('greeting', { name })}
        </h1>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-brand-100 px-3 py-1 text-sm text-brand-900">
          <span className="font-medium">{t('roleLabel')}:</span>
          <span>{tRoles(role)}</span>
        </div>
        <p className="mt-6 text-sm text-neutral-600">{t('comingSoon')}</p>

        <form action={signOutAction} className="mt-8">
          <button type="submit" className="btn-ghost border border-neutral-300">
            {t('signOut')}
          </button>
        </form>
      </div>
    </main>
  );
}
