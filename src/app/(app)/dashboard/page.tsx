import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/header';
import { signOutAction } from '@/lib/auth/login';
import { formatRupees, getServerLocale } from '@/lib/format/locale';
import type { Locale } from '@/lib/i18n/config';

export const dynamic = 'force-dynamic';

const DEPARTMENTS = [
  { key: 'orders', href: '/orders' },
  { key: 'jobWork', href: '/job-work' },
  { key: 'barcode', href: '/barcodes' },
  { key: 'billing', href: '/billing' },
  { key: 'purchase', href: '/purchases' },
  { key: 'accounting', href: '/accounting' },
  { key: 'reminders', href: '/reminders' },
  { key: 'payroll', href: '/payroll' },
] as const;

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return (
      <DebugCard
        title="No authenticated user on /dashboard"
        details={{
          userError: userError?.message ?? null,
          user: user ?? null,
        }}
      />
    );
  }

  const { data: appUser, error: appUserError } = await supabase
    .from('app_users')
    .select('full_name, role')
    .eq('auth_user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (appUserError || !appUser) {
    return (
      <DebugCard
        title="app_users row missing or unreadable"
        details={{
          auth_user_id: user.id,
          email: user.email,
          appUserError: appUserError?.message ?? null,
          appUser,
        }}
      />
    );
  }

  // Orders waiting for work (New / Packing / Ready) with estimated value.
  let orderSummary: OrderSummary | null = null;
  if (['super_admin', 'supervisor', 'order_staff'].includes(appUser.role)) {
    const { data: os } = await supabase
      .from('orders')
      .select('status, estimated_total')
      .in('status', ['new', 'packing', 'ready'])
      .is('deleted_at', null)
      .limit(5000);
    orderSummary = {
      new: { count: 0, total: 0 },
      packing: { count: 0, total: 0 },
      ready: { count: 0, total: 0 },
    };
    for (const o of (os ?? []) as { status: OrderStage; estimated_total: number }[]) {
      const s = orderSummary[o.status];
      if (!s) continue;
      s.count += 1;
      s.total += Number(o.estimated_total) || 0;
    }
  }

  return (
    <DashboardView
      name={appUser.full_name}
      role={appUser.role}
      orderSummary={orderSummary}
      locale={getServerLocale()}
    />
  );
}

type OrderStage = 'new' | 'packing' | 'ready';
type OrderSummary = Record<OrderStage, { count: number; total: number }>;

function OrderSummaryCard({ summary, locale }: { summary: OrderSummary; locale: Locale }) {
  const t = useTranslations('dashboard.orderSummary');
  const tStatus = useTranslations('orders.status');
  const stages: OrderStage[] = ['new', 'packing', 'ready'];
  const count = stages.reduce((a, s) => a + summary[s].count, 0);
  const total = stages.reduce((a, s) => a + summary[s].total, 0);
  const tone: Record<OrderStage, string> = {
    new: 'border-sky-200 bg-sky-50 text-sky-900',
    packing: 'border-amber-200 bg-amber-50 text-amber-900',
    ready: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  };
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          {t('title')}
        </h2>
        <Link href="/orders" className="text-brand-800 text-sm underline">
          {t('viewAll')}
        </Link>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-3">
        {stages.map((s) => (
          <Link
            key={s}
            href={`/orders?tab=${s}`}
            className={`block rounded-lg border p-3 transition hover:shadow-sm ${tone[s]}`}
          >
            <div className="text-xs font-medium uppercase tracking-wide">{tStatus(s)}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{summary[s].count}</div>
            <div className="text-xs tabular-nums opacity-80">
              {formatRupees(summary[s].total, locale)}
            </div>
          </Link>
        ))}
      </div>
      <div className="mt-2 flex items-baseline justify-between rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm">
        <span className="text-neutral-700">{t('openTotal', { count })}</span>
        <span className="font-semibold tabular-nums text-neutral-900">
          {formatRupees(total, locale)}
        </span>
      </div>
    </section>
  );
}

function DebugCard({ title, details }: { title: string; details: Record<string, unknown> }) {
  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-8">
      <div className="mx-auto max-w-screen-md space-y-4">
        <h1 className="text-xl font-semibold text-neutral-900">{title}</h1>
        <pre className="overflow-auto rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          {JSON.stringify(details, null, 2)}
        </pre>
      </div>
    </main>
  );
}

function DashboardView({
  name,
  role,
  orderSummary,
  locale,
}: {
  name: string;
  role: string;
  orderSummary: OrderSummary | null;
  locale: Locale;
}) {
  const t = useTranslations('dashboard');
  const tDept = useTranslations('departments');
  const tShortcuts = useTranslations('dashboard.shortcuts');
  const tRoles = useTranslations('roles');
  const canSeeAdmin = role === 'super_admin';
  // Order staff only work in Orders; hide sections they can't open.
  const isOrderStaff = role === 'order_staff';
  const departments = isOrderStaff ? DEPARTMENTS.filter((d) => d.key === 'orders') : DEPARTMENTS;
  return (
    <main className="flex min-h-screen flex-col bg-neutral-50">
      <Header />
      <div className="mx-auto w-full max-w-screen-md flex-1 px-4 py-8">
        <h1 className="text-2xl font-semibold text-neutral-900">{t('greeting', { name })}</h1>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-brand-100 px-3 py-1 text-sm text-brand-900">
          <span className="font-medium">{t('roleLabel')}:</span>
          <span>{tRoles(role)}</span>
        </div>

        {orderSummary ? <OrderSummaryCard summary={orderSummary} locale={locale} /> : null}

        <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">
          {tDept('sectionTitle')}
        </h2>
        <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {departments.map((dept) => (
            <li key={dept.key}>
              <Link
                href={dept.href}
                className="hover:border-brand-300 block rounded-lg border border-neutral-200 bg-white p-4 transition hover:bg-brand-50/30"
              >
                <div className="text-base font-semibold text-neutral-900">
                  {tDept(`${dept.key}.title`)}
                </div>
                <div className="mt-0.5 text-sm text-neutral-600">{tDept(`${dept.key}.hint`)}</div>
              </Link>
            </li>
          ))}
        </ul>

        {isOrderStaff ? null : (
          <>
            <h2 className="mt-10 text-sm font-medium uppercase tracking-wide text-neutral-500">
              {tDept('setupTitle')}
            </h2>
            <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <li>
                <Link
                  href="/master-data/locations"
                  className="hover:border-brand-300 block rounded-lg border border-neutral-200 bg-white p-4 transition hover:bg-brand-50/30"
                >
                  <div className="text-base font-semibold text-neutral-900">
                    {tShortcuts('masterData')}
                  </div>
                  <div className="mt-0.5 text-sm text-neutral-600">
                    {tShortcuts('masterDataHint')}
                  </div>
                </Link>
              </li>
              {canSeeAdmin ? (
                <li>
                  <Link
                    href="/admin/users"
                    className="hover:border-brand-300 block rounded-lg border border-neutral-200 bg-white p-4 transition hover:bg-brand-50/30"
                  >
                    <div className="text-base font-semibold text-neutral-900">
                      {tShortcuts('admin')}
                    </div>
                    <div className="mt-0.5 text-sm text-neutral-600">{tShortcuts('adminHint')}</div>
                  </Link>
                </li>
              ) : null}
            </ul>
          </>
        )}

        <form action={signOutAction} className="mt-10">
          <button type="submit" className="btn-ghost border border-neutral-300">
            {t('signOut')}
          </button>
        </form>
      </div>
    </main>
  );
}
