import { useTranslations } from 'next-intl';
import { DepartmentShell } from '@/components/department-shell';

export default function BarcodesPage() {
  const t = useTranslations('departments');
  return (
    <DepartmentShell
      title={t('barcode.title')}
      hint={t('barcode.hint')}
      comingSoon={t('comingSoon')}
    />
  );
}
