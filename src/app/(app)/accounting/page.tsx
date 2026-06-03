import { useTranslations } from 'next-intl';
import { DepartmentShell } from '@/components/department-shell';

export default function AccountingPage() {
  const t = useTranslations('departments');
  return (
    <DepartmentShell
      title={t('accounting.title')}
      hint={t('accounting.hint')}
      comingSoon={t('comingSoon')}
    />
  );
}
