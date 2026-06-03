import { useTranslations } from 'next-intl';
import { DepartmentShell } from '@/components/department-shell';

export default function BillingPage() {
  const t = useTranslations('departments');
  return (
    <DepartmentShell
      title={t('billing.title')}
      hint={t('billing.hint')}
      comingSoon={t('comingSoon')}
    />
  );
}
