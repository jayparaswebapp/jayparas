import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { GroupForm, type GroupFormValues } from '../group-form';
import { DestructiveActions } from './destructive-actions';

export const dynamic = 'force-dynamic';

export default async function EditCustomerGroupPage({ params }: { params: { id: string } }) {
  await requireRole(['super_admin', 'supervisor']);
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

  return <EditView initial={initial} isDeleted={!!row.deleted_at} groupId={row.id} />;
}

function EditView({
  initial,
  isDeleted,
  groupId,
}: {
  initial: GroupFormValues;
  isDeleted: boolean;
  groupId: string;
}) {
  const t = useTranslations('billing.groups.form');
  const tGroup = useTranslations('billing.ledger.group');
  return (
    <>
      <PageHeader
        title={t('editTitle')}
        action={
          !isDeleted ? (
            <Link href={`/billing/groups/${groupId}/ledger`} className="btn-primary !w-auto px-4">
              {tGroup('viewLedgerButton')}
            </Link>
          ) : null
        }
      />
      {isDeleted ? (
        <DestructiveActions groupId={initial.id!} isDeleted />
      ) : (
        <>
          <GroupForm initial={initial} />
          <div className="mt-6 border-t border-neutral-200 pt-4">
            <DestructiveActions groupId={initial.id!} isDeleted={false} />
          </div>
        </>
      )}
    </>
  );
}
