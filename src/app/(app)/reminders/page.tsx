import { useTranslations } from 'next-intl';
import { DepartmentShell } from '@/components/department-shell';

export default function RemindersPage() {
  const t = useTranslations('departments');
  return (
    <DepartmentShell
      title={t('reminders.title')}
      hint={t('reminders.hint')}
      comingSoon={t('comingSoon')}
    />
  );
}
