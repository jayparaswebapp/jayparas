import { useTranslations } from 'next-intl';

export function StatusBadge({
  isActive,
  isDeleted = false,
}: {
  isActive: boolean;
  isDeleted?: boolean;
}) {
  const t = useTranslations('common.status');
  if (isDeleted) {
    return (
      <span className="inline-flex items-center rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-700">
        {t('deleted')}
      </span>
    );
  }
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-200 text-neutral-700',
      ].join(' ')}
    >
      {isActive ? t('active') : t('inactive')}
    </span>
  );
}

export function RoleBadge({ role }: { role: string }) {
  const t = useTranslations('roles');
  return (
    <span className="inline-flex items-center rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-900">
      {t(role)}
    </span>
  );
}
