import { useTranslations } from 'next-intl';
import { DepartmentShell } from '@/components/department-shell';

export default function JobWorkPage() {
  const t = useTranslations('departments');
  return (
    <DepartmentShell
      title={t('jobWork.title')}
      hint={t('jobWork.hint')}
      comingSoon={t('comingSoon')}
    />
  );
}
