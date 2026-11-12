import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { loadProductGroupOptions } from '@/lib/skus/product-groups';
import { MultipleSkusForm } from './multiple-skus-form';

export const dynamic = 'force-dynamic';

export default async function MultipleSkusPage() {
  await requireRole(['super_admin', 'supervisor']);
  const productGroups = await loadProductGroupOptions(createClient());
  return <MultipleSkusForm productGroups={productGroups} />;
}
