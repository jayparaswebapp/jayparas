import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { getServerLocale, formatRupees } from '@/lib/format/locale';
import { getSkuPhotoPublicUrl } from '@/lib/storage/sku-photos';
import { labelUnit } from '@/lib/skus/label';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/badges';
import { QrCode } from '@/components/qr-code';
import { SkuEditForm } from './sku-edit-form';
import { SkuActiveToggle } from './sku-active-toggle';

export const dynamic = 'force-dynamic';

interface SkuRecord {
  id: string;
  sku_code: string;
  pack_type: 'single' | 'mix';
  design_no: string | null;
  mix_code: string | null;
  design_name: string;
  pack_size: number;
  price: number;
  photo_path: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export default async function SkuDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { created?: string };
}) {
  const user = await requireAppUser();
  const locale = getServerLocale();
  const supabase = createClient();

  const { data: row } = await supabase
    .from('skus')
    .select(
      'id, sku_code, pack_type, design_no, mix_code, design_name, pack_size, price, photo_path, is_active, created_at, updated_at',
    )
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!row) notFound();

  const sku: SkuRecord = {
    id: row.id,
    sku_code: row.sku_code,
    pack_type: row.pack_type as 'single' | 'mix',
    design_no: row.design_no,
    mix_code: row.mix_code,
    design_name: row.design_name,
    pack_size: row.pack_size,
    price: Number(row.price),
    photo_path: row.photo_path,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  const photoUrl = getSkuPhotoPublicUrl(supabase, sku.photo_path);
  const canEdit = user.role === 'super_admin' || user.role === 'supervisor';
  const canToggleActive = user.role === 'super_admin';
  const isSuperAdmin = user.role === 'super_admin';

  return (
    <SkuDetailView
      sku={sku}
      photoUrl={photoUrl}
      canEdit={canEdit}
      canToggleActive={canToggleActive}
      isSuperAdmin={isSuperAdmin}
      justCreated={searchParams.created === '1'}
      locale={locale}
    />
  );
}

function SkuDetailView({
  sku,
  photoUrl,
  canEdit,
  canToggleActive,
  isSuperAdmin,
  justCreated,
  locale,
}: {
  sku: SkuRecord;
  photoUrl: string | null;
  canEdit: boolean;
  canToggleActive: boolean;
  isSuperAdmin: boolean;
  justCreated: boolean;
  locale: 'gu' | 'en';
}) {
  const t = useTranslations('skus.detail');
  const tForm = useTranslations('skus.form');
  const tCard = useTranslations('skus.library.card');

  return (
    <>
      <PageHeader
        title={t('title')}
        action={
          <div className="flex items-center gap-2">
            <Link href={`/skus/${sku.id}/print`} className="btn-primary !w-auto px-4">
              {t('printLabel')}
            </Link>
          </div>
        }
      />

      {justCreated ? (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {tForm('previewLabel')}: <code className="font-mono">{sku.sku_code}</code>
        </div>
      ) : null}

      <div className="mb-5 flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:flex-row">
        <div className="h-32 w-32 shrink-0 overflow-hidden rounded-md bg-neutral-100 ring-1 ring-neutral-200">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-neutral-900">{sku.design_name}</h2>
            <StatusBadge isActive={sku.is_active} />
          </div>
          <div className="mt-0.5 text-sm text-neutral-700">
            {sku.pack_type === 'single'
              ? `${tCard('designLabel')} ${sku.design_no}`
              : `${tCard('mixLabel')} ${sku.mix_code}`}{' '}
            · {labelUnit(sku.pack_size)}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-sm text-neutral-700">
              {sku.sku_code}
            </code>
            <span className="text-sm font-medium text-neutral-700">
              {formatRupees(sku.price, locale)}
            </span>
          </div>
          <div className="mt-3">
            <QrCode value={sku.sku_code} size="80px" />
          </div>
        </div>
      </div>

      <div className="mb-5 rounded-lg border border-neutral-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-medium text-neutral-700">{t('lockedSection')}</h3>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-neutral-500">{tForm('packTypeLabel')}</dt>
          <dd className="text-neutral-900">{labelUnit(sku.pack_size)}</dd>
          <dt className="text-neutral-500">
            {sku.pack_type === 'single' ? tForm('designNumberLabel') : tForm('mixCodeLabel')}
          </dt>
          <dd className="text-neutral-900">
            {sku.pack_type === 'single' ? sku.design_no : sku.mix_code}
          </dd>
          <dt className="text-neutral-500">{tForm('skuCodeLabel')}</dt>
          <dd>
            <code className="font-mono text-neutral-900">{sku.sku_code}</code>
          </dd>
        </dl>
        <p className="mt-2 text-xs text-neutral-500">{tForm('lockedHint')}</p>
      </div>

      {canEdit ? (
        <div className="mb-5 rounded-lg border border-neutral-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-medium text-neutral-700">{t('editableSection')}</h3>
          <SkuEditForm
            initial={{
              id: sku.id,
              design_name: sku.design_name,
              price: String(sku.price),
              photo_path: sku.photo_path,
            }}
            photoUrl={photoUrl}
            isSuperAdmin={isSuperAdmin}
          />
        </div>
      ) : null}

      {canToggleActive ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <SkuActiveToggle id={sku.id} isActive={sku.is_active} />
        </div>
      ) : null}
    </>
  );
}
