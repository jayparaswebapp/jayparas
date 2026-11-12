import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { loadProductGroupOptions, type ProductGroupOption } from '@/lib/skus/product-groups';
import { SkuCreateForm } from '../sku-create-form';

export const dynamic = 'force-dynamic';

export default async function NewSkuPage() {
  await requireRole(['super_admin', 'supervisor']);
  const productGroups = await loadProductGroupOptions(createClient());
  return <NewSkuView productGroups={productGroups} />;
}

function NewSkuView({ productGroups }: { productGroups: ProductGroupOption[] }) {
  const t = useTranslations('skus.form');
  return (
    <>
      <PageHeader title={t('createTitle')} />
      <SkuCreateForm productGroups={productGroups} />
    </>
  );
}
