import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { getServerLocale, pickLocalised } from '@/lib/format/locale';
import { PageHeader } from '@/components/page-header';
import { NewAccountForm, type ParentOption } from './new-account-form';

export const dynamic = 'force-dynamic';

interface AccountRow {
  id: string;
  code: string;
  name_en: string;
  name_gu: string;
  is_group: boolean;
}

export default async function NewAccountPage() {
  await requireRole(['super_admin', 'accountant']);
  const locale = getServerLocale();
  const supabase = createClient();

  const { data: rows } = await supabase
    .from('chart_of_accounts')
    .select('id, code, name_en, name_gu, is_group')
    .is('deleted_at', null)
    .eq('is_group', true)
    .order('code', { ascending: true });

  const parents: ParentOption[] = ((rows ?? []) as unknown as AccountRow[]).map((r) => ({
    id: r.id,
    label: `${r.code} · ${pickLocalised(locale, r.name_en, r.name_gu)}`,
  }));

  return <NewView parents={parents} />;
}

function NewView({ parents }: { parents: ParentOption[] }) {
  const t = useTranslations('accounting.coa');
  return (
    <>
      <PageHeader title={t('newAccountTitle')} subtitle={t('newAccountSubtitle')} />
      <NewAccountForm parents={parents} />
    </>
  );
}
