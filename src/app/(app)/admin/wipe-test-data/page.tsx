import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { WipeForm } from './wipe-form';

export const dynamic = 'force-dynamic';

// Every table the wipe RPC touches. We surface row counts so the operator
// can see exactly what will disappear before typing WIPE.
const TABLES: Array<{ key: string; en: string }> = [
  { key: 'invoices', en: 'Invoices' },
  { key: 'invoice_lines', en: 'Invoice lines' },
  { key: 'payments', en: 'Payments' },
  { key: 'payment_allocations', en: 'Payment allocations' },
  { key: 'sales_returns', en: 'Sales returns' },
  { key: 'sales_return_lines', en: 'Sales return lines' },
  { key: 'purchase_bills', en: 'Purchase bills' },
  { key: 'purchase_bill_lines', en: 'Purchase bill lines' },
  { key: 'journal_entries', en: 'Journal entries' },
  { key: 'journal_lines', en: 'Journal lines' },
  { key: 'job_orders', en: 'Job orders' },
  { key: 'job_order_items', en: 'Job order items' },
  { key: 'job_sub_assignments', en: 'Job sub-assignments' },
  { key: 'job_receipts', en: 'Job receipts' },
];

export default async function WipeTestDataPage() {
  await requireRole(['super_admin']);
  const supabase = createClient();

  // Fetch head-only counts for every table in parallel. head=true skips the
  // row payload, count=exact gives us the total from PostgREST.
  const results = await Promise.all(
    TABLES.map((tbl) =>
      supabase
        .from(tbl.key)
        .select('*', { count: 'exact', head: true })
        .then((r) => ({ key: tbl.key, en: tbl.en, count: r.count ?? 0 })),
    ),
  );

  return <WipeView counts={results} />;
}

function WipeView({ counts }: { counts: Array<{ key: string; en: string; count: number }> }) {
  const t = useTranslations('admin.wipe');
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <WipeForm counts={counts.map((c) => ({ key: c.key, label: c.en, before: c.count }))} />
    </>
  );
}
