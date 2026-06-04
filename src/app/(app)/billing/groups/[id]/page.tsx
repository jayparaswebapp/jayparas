import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { GroupForm, type GroupFormValues } from '../group-form';
import { DestructiveActions } from './destructive-actions';

export const dynamic = 'force-dynamic';

export default async function EditCustomerGroupPage({ params }: { params: { id: string } }) {
  const user = await requireRole(['super_admin', 'supervisor']);
  const supabase = createClient();

  const { data: row } = await supabase
    .from('customer_groups')
    .select('id, name, city, notes, is_active, deleted_at')
    .eq('id', params.id)
    .maybeSingle();

  if (!row) notFound();

  const initial: GroupFormValues = {
    id: row.id,
    name: row.name,
    city: row.city,
    notes: row.notes,
    is_active: row.is_active,
  };

  return (
    <EditView
      initial={initial}
      isDeleted={!!row.deleted_at}
      isSuperAdmin={user.role === 'super_admin'}
    />
  );
}

function EditView({
  initial,
  isDeleted,
  isSuperAdmin,
}: {
  initial: GroupFormValues;
  isDeleted: boolean;
  isSuperAdmin: boolean;
}) {
  const t = useTranslations('billing.groups.form');
  return (
    <>
      <PageHeader title={t('editTitle')} />
      {isDeleted ? (
        <DestructiveActions groupId={initial.id!} isDeleted />
      ) : (
        <>
          <GroupForm initial={initial} isSuperAdmin={isSuperAdmin} />
          <div className="mt-6 border-t border-neutral-200 pt-4">
            <DestructiveActions groupId={initial.id!} isDeleted={false} />
          </div>
        </>
      )}
    </>
  );
}
