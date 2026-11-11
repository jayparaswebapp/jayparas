import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { KiteSetupView, type CompanyRow, type GroupRow } from './kite-setup-view';

export const dynamic = 'force-dynamic';

export default async function KiteSetupPage() {
  await requireRole(['super_admin', 'supervisor']);
  const supabase = createClient();

  const [{ data: companyRows }, { data: groupRows }, { data: skuRows }] = await Promise.all([
    supabase
      .from('kite_companies')
      .select('id, name, is_active')
      .is('deleted_at', null)
      .order('name', { ascending: true }),
    supabase
      .from('product_groups')
      .select('id, name, company_id, is_active')
      .is('deleted_at', null)
      .order('name', { ascending: true }),
    supabase
      .from('skus')
      .select('product_group_id')
      .eq('business_line', 'kite')
      .is('deleted_at', null)
      .not('product_group_id', 'is', null),
  ]);

  const skuCount = new Map<string, number>();
  for (const r of skuRows ?? []) {
    if (!r.product_group_id) continue;
    skuCount.set(r.product_group_id, (skuCount.get(r.product_group_id) ?? 0) + 1);
  }

  const groups: GroupRow[] = (groupRows ?? []).map((g) => ({
    ...g,
    sku_count: skuCount.get(g.id) ?? 0,
  }));

  const groupCount = new Map<string, number>();
  for (const g of groups) groupCount.set(g.company_id, (groupCount.get(g.company_id) ?? 0) + 1);

  const companies: CompanyRow[] = (companyRows ?? []).map((c) => ({
    ...c,
    group_count: groupCount.get(c.id) ?? 0,
  }));

  return <View companies={companies} groups={groups} />;
}

function View({ companies, groups }: { companies: CompanyRow[]; groups: GroupRow[] }) {
  const t = useTranslations('billing.kiteSetup');
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <KiteSetupView companies={companies} groups={groups} />
    </>
  );
}
