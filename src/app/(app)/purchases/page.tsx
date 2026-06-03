import { useTranslations } from 'next-intl';
import { DepartmentShell } from '@/components/department-shell';

export default function PurchasesPage() {
  const t = useTranslations('departments');
  return (
    <DepartmentShell
      title={t('purchase.title')}
      hint={t('purchase.hint')}
      comingSoon={t('comingSoon')}
    />
  );
}
