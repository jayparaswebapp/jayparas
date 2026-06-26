import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/users/current';
import { getServerLocale, pickLocalised } from '@/lib/format/locale';
import { PageHeader } from '@/components/page-header';
import {
  JobOrderForm,
  type DesignOption,
  type LeadLadyOption,
  type LocationOption,
} from '../job-order-form';

export const dynamic = 'force-dynamic';

export default async function NewJobOrderPage() {
  await requireRole(['super_admin', 'supervisor']);
  const locale = getServerLocale();
  const supabase = createClient();

  const [{ data: lls }, { data: locs }, { data: dsns }] = await Promise.all([
    supabase
      .from('lead_ladies')
      .select('id, full_name, mobile')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('full_name', { ascending: true }),
    supabase
      .from('locations')
      .select('id, name_en, name_gu')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name_en', { ascending: true }),
    supabase
      .from('designs')
      .select('id, design_number, name_en, name_gu, current_rate_per_guss')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('design_number', { ascending: true }),
  ]);

  const leadLadies: LeadLadyOption[] = (lls ?? []).map((l) => ({
    id: l.id,
    label: l.full_name + (l.mobile ? ` · +91 ${l.mobile}` : ''),
  }));
  const locations: LocationOption[] = (locs ?? []).map((l) => ({
    id: l.id,
    label: pickLocalised(locale, l.name_en, l.name_gu),
  }));
  const designs: DesignOption[] = (dsns ?? []).map((d) => ({
    id: d.id,
    label: `${d.design_number} · ${pickLocalised(locale, d.name_en, d.name_gu)}`,
    // 1 guss = 144 pieces (12 dozen). We let the staff override the rate per
    // order, but pre-fill with the design's master rate so the common case is
    // one click.
    default_rate_per_piece: Math.round((Number(d.current_rate_per_guss) / 144) * 100) / 100,
  }));

  return <NewView leadLadies={leadLadies} locations={locations} designs={designs} />;
}

function NewView({
  leadLadies,
  locations,
  designs,
}: {
  leadLadies: LeadLadyOption[];
  locations: LocationOption[];
  designs: DesignOption[];
}) {
  const t = useTranslations('jobWork.form');
  return (
    <>
      <PageHeader title={t('createTitle')} />
      <JobOrderForm leadLadies={leadLadies} locations={locations} designs={designs} />
    </>
  );
}
