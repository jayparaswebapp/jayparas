import { requireRole } from '@/lib/users/current';
import { MultipleSkusForm } from './multiple-skus-form';

export const dynamic = 'force-dynamic';

export default async function MultipleSkusPage() {
  await requireRole(['super_admin', 'supervisor']);
  return <MultipleSkusForm />;
}
