import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { getServerLocale, pickLocalised } from '@/lib/format/locale';
import { PageHeader } from '@/components/page-header';
import { JournalEntryForm, type AccountOption } from './journal-entry-form';

export const dynamic = 'force-dynamic';

interface AccountRow {
  id: string;
  code: string;
  name_en: string;
  name_gu: string;
  account_type: string;
  is_group: boolean;
  is_active: boolean;
}

export default async function NewJournalEntryPage() {
  await requireRole(['super_admin', 'accountant']);
  const locale = getServerLocale();
  const supabase = createClient();

  const { data: rows } = await supabase
    .from('chart_of_accounts')
    .select('id, code, name_en, name_gu, account_type, is_group, is_active')
    .is('deleted_at', null)
    .eq('is_group', false)
    .eq('is_active', true)
    .order('code', { ascending: true });

  const accounts: AccountOption[] = ((rows ?? []) as unknown as AccountRow[]).map((r) => ({
    id: r.id,
    code: r.code,
    label: pickLocalised(locale, r.name_en, r.name_gu),
    type: r.account_type,
  }));

  return <NewView accounts={accounts} />;
}

function NewView({ accounts }: { accounts: AccountOption[] }) {
  const t = useTranslations('accounting.journal.form');
  return (
    <>
      <PageHeader title={t('createTitle')} subtitle={t('createSubtitle')} />
      <JournalEntryForm accounts={accounts} />
    </>
  );
}
