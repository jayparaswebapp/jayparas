import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Header } from '@/components/header';
import { SubNav } from '@/components/sub-nav';
import { requireAppUser } from '@/lib/users/current';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireAppUser();
  const isSuperAdmin = user.role === 'super_admin';
  return <AdminLayoutView isSuperAdmin={isSuperAdmin}>{children}</AdminLayoutView>;
}

function AdminLayoutView({
  isSuperAdmin,
  children,
}: {
  isSuperAdmin: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('nav');
  const tAdmin = useTranslations('admin');
  const items = [
    { href: '/admin/users', label: t('users') },
    { href: '/admin/settings', label: t('settings') },
  ];
  if (isSuperAdmin) {
    items.push({ href: '/admin/wipe-test-data', label: tAdmin('wipeTab') });
  }
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <Header />
      <SubNav items={items} />
      <main className="mx-auto w-full max-w-screen-md flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
