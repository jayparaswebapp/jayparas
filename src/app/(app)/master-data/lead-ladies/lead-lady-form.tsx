'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { AuditReasonField } from '@/components/audit-reason-field';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { saveLeadLadyAction } from './actions';

export interface LeadLadyFormValues {
  id?: string;
  full_name: string;
  mobile: string;
  notes: string | null;
  is_active: boolean;
  location_ids: string[];
}

export interface LocationOption {
  id: string;
  label: string;
}

export function LeadLadyForm({
  initial,
  locations,
  isSuperAdmin,
}: {
  initial: LeadLadyFormValues | null;
  locations: LocationOption[];
  isSuperAdmin: boolean;
}) {
  const t = useTranslations('masterData.leadLadies');
  const tCommon = useTranslations('common.actions');
  const [state, formAction] = useFormState<ActionResult | null, FormData>(saveLeadLadyAction, null);

  const initialIds = new Set(initial?.location_ids ?? []);

  return (
    <form action={formAction} className="space-y-4">
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      <div>
        <label htmlFor="full_name" className="label-base">
          {t('form.fullNameLabel')}
        </label>
        <input
          id="full_name"
          name="full_name"
          defaultValue={initial?.full_name ?? ''}
          required
          className="input-base"
        />
      </div>

      <div>
        <label htmlFor="mobile" className="label-base">
          {t('form.mobileLabel')}
        </label>
        <input
          id="mobile"
          name="mobile"
          defaultValue={initial?.mobile ?? ''}
          required
          inputMode="numeric"
          pattern="[6-9][0-9]{9}"
          maxLength={10}
          placeholder={t('form.mobilePlaceholder')}
          className="input-base"
        />
      </div>

      <div>
        <label htmlFor="notes" className="label-base">
          {t('form.notesLabel')}
        </label>
        <textarea
          id="notes"
          name="notes"
          defaultValue={initial?.notes ?? ''}
          rows={2}
          className="input-base resize-y"
        />
      </div>

      <fieldset>
        <legend className="label-base">{t('form.locationsLabel')}</legend>
        <p className="mb-2 text-xs text-neutral-500">{t('form.locationsHint')}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {locations.map((loc) => (
            <label key={loc.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="location_ids"
                value={loc.id}
                defaultChecked={initialIds.has(loc.id)}
                className="h-5 w-5"
              />
              {loc.label}
            </label>
          ))}
        </div>
      </fieldset>

      {initial ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={initial.is_active}
            className="h-5 w-5"
          />
          {t('form.isActiveLabel')}
        </label>
      ) : (
        <input type="hidden" name="is_active" value="on" />
      )}

      <AuditReasonField required={isSuperAdmin} />

      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}

      <div className="flex items-center gap-3">
        <SubmitButton label={tCommon('save')} pendingLabel={tCommon('saving')} />
        <Link href="/master-data/lead-ladies" className="btn-ghost border border-neutral-300">
          {tCommon('cancel')}
        </Link>
      </div>
    </form>
  );
}
