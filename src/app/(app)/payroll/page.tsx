import { useTranslations } from 'next-intl';
import { DepartmentShell } from '@/components/department-shell';

export default function PayrollPage() {
  const t = useTranslations('departments');
  return (
    <DepartmentShell
      title={t('payroll.title')}
      hint={t('payroll.hint')}
      comingSoon={t('comingSoon')}
    />
  );
}
