import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireAppUser } from '@/lib/users/current';
import { PageHeader } from '@/components/page-header';
import { CompanyForm, type CompanyFormValues } from './company-form';

export const dynamic = 'force-dynamic';

export default async function CompanyInfoPage() {
  const user = await requireAppUser();
  const supabase = createClient();

  const { data: row } = await supabase
    .from('company_info')
    .select(
      'legal_name, address_line1, address_line2, city, state, pincode, gstin, pan, mobile, email, bank_name, bank_account_no, bank_ifsc, default_terms, default_due_days',
    )
    .maybeSingle();

  const initial: CompanyFormValues | null = row
    ? {
        legal_name: row.legal_name,
        address_line1: row.address_line1,
        address_line2: row.address_line2,
        city: row.city,
        state: row.state,
        pincode: row.pincode,
        gstin: row.gstin,
        pan: row.pan,
        mobile: row.mobile,
        email: row.email,
        bank_name: row.bank_name,
        bank_account_no: row.bank_account_no,
        bank_ifsc: row.bank_ifsc,
        default_terms: row.default_terms,
        default_due_days: row.default_due_days ?? 0,
      }
    : null;

  return <CompanyView initial={initial} canEdit={user.role === 'super_admin'} />;
}

function CompanyView({
  initial,
  canEdit,
}: {
  initial: CompanyFormValues | null;
  canEdit: boolean;
}) {
  const t = useTranslations('billing.company');
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {canEdit ? <CompanyForm initial={initial} /> : <ReadOnly initial={initial} />}
    </>
  );
}

function ReadOnly({ initial }: { initial: CompanyFormValues | null }) {
  const tForm = useTranslations('billing.company.form');
  if (!initial) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-500">
        —
      </div>
    );
  }
  return (
    <dl className="grid grid-cols-1 gap-y-3 rounded-lg border border-neutral-200 bg-white p-5 text-sm sm:grid-cols-2">
      <Item label={tForm('legalNameLabel')}>{initial.legal_name}</Item>
      <Item label={tForm('gstinLabel')}>{initial.gstin ?? '—'}</Item>
      <Item label={tForm('addressLine1Label')}>{initial.address_line1 ?? '—'}</Item>
      <Item label={tForm('addressLine2Label')}>{initial.address_line2 ?? '—'}</Item>
      <Item label={tForm('cityLabel')}>{initial.city ?? '—'}</Item>
      <Item label={tForm('stateLabel')}>{initial.state ?? '—'}</Item>
      <Item label={tForm('pincodeLabel')}>{initial.pincode ?? '—'}</Item>
      <Item label={tForm('mobileLabel')}>{initial.mobile ?? '—'}</Item>
      <Item label={tForm('emailLabel')}>{initial.email ?? '—'}</Item>
      <Item label={tForm('panLabel')}>{initial.pan ?? '—'}</Item>
      <Item label={tForm('bankNameLabel')}>{initial.bank_name ?? '—'}</Item>
      <Item label={tForm('bankAccountNoLabel')}>{initial.bank_account_no ?? '—'}</Item>
      <Item label={tForm('bankIfscLabel')}>{initial.bank_ifsc ?? '—'}</Item>
    </dl>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-neutral-900">{children}</dd>
    </div>
  );
}
