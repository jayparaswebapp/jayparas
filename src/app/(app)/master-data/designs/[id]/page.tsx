import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { DesignForm } from '../design-form';
import { DestructiveActions } from './destructive-actions';
import { getDesignThumbnailUrl } from '../actions';

export const dynamic = 'force-dynamic';

export default async function EditDesignPage({ params }: { params: { id: string } }) {
  const user = await requireRole(['super_admin', 'supervisor']);
  const supabase = createClient();

  const { data: row } = await supabase
    .from('designs')
    .select(
      'id, design_number, name_en, name_gu, current_rate_per_guss, image_path, is_active, deleted_at',
    )
    .eq('id', params.id)
    .maybeSingle();

  if (!row) notFound();

  const thumb = await getDesignThumbnailUrl(row.image_path);

  return (
    <EditView
      design={{
        id: row.id,
        design_number: row.design_number,
        name_en: row.name_en,
        name_gu: row.name_gu,
        current_rate_per_guss: String(row.current_rate_per_guss),
        image_path: row.image_path,
        is_active: row.is_active,
      }}
      isDeleted={!!row.deleted_at}
      imageSignedUrl={thumb}
      isSuperAdmin={user.role === 'super_admin'}
    />
  );
}

function EditView({
  design,
  isDeleted,
  imageSignedUrl,
  isSuperAdmin,
}: {
  design: {
    id: string;
    design_number: string;
    name_en: string | null;
    name_gu: string | null;
    current_rate_per_guss: string;
    image_path: string | null;
    is_active: boolean;
  };
  isDeleted: boolean;
  imageSignedUrl: string | null;
  isSuperAdmin: boolean;
}) {
  const t = useTranslations('masterData.designs.form');
  return (
    <>
      <PageHeader title={t('editTitle')} />
      {isDeleted ? (
        <DestructiveActions designId={design.id} isDeleted />
      ) : (
        <>
          <DesignForm
            initial={design}
            imageSignedUrl={imageSignedUrl}
            isSuperAdmin={isSuperAdmin}
          />
          <div className="mt-6 border-t border-neutral-200 pt-4">
            <DestructiveActions designId={design.id} isDeleted={false} />
          </div>
        </>
      )}
    </>
  );
}
