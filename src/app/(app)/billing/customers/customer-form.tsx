'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { AuditReasonField } from '@/components/audit-reason-field';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { saveBillingCustomerAction } from './actions';

export interface CustomerFormValues {
  id?: string;
  full_name: string;
  business_name: string | null;
  mobile: string;
  email: string | null;
  gstin: string | null;
  pan: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  notes: string | null;
  group_id: string | null;
  is_active: boolean;
}

export interface GroupOption {
  id: string;
  name: string;
  city: string;
}

export function CustomerForm({
  initial,
  groups,
  isSuperAdmin,
}: {
  initial: CustomerFormValues | null;
  groups: GroupOption[];
  isSuperAdmin: boolean;
}) {
  const t = useTranslations('billing.customers.form');
  const tCommon = useTranslations('common.actions');
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    saveBillingCustomerAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      <div>
        <label htmlFor="full_name" className="label-base">
          {t('fullNameLabel')}
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
        <label htmlFor="business_name" className="label-base">
          {t('businessNameLabel')}
        </label>
        <input
          id="business_name"
          name="business_name"
          defaultValue={initial?.business_name ?? ''}
          className="input-base"
        />
      </div>

      <div>
        <label htmlFor="mobile" className="label-base">
          {t('mobileLabel')}
        </label>
        <input
          id="mobile"
          name="mobile"
          defaultValue={initial?.mobile ?? ''}
          required
          inputMode="numeric"
          pattern="[6-9][0-9]{9}"
          maxLength={10}
          placeholder={t('mobilePlaceholder')}
          className="input-base"
        />
      </div>

      <div>
        <label htmlFor="email" className="label-base">
          {t('emailLabel')}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          defaultValue={initial?.email ?? ''}
          className="input-base"
        />
      </div>

      <div>
        <label htmlFor="gstin" className="label-base">
          {t('gstinLabel')}
        </label>
        <input
          id="gstin"
          name="gstin"
          defaultValue={initial?.gstin ?? ''}
          maxLength={15}
          placeholder={t('gstinPlaceholder')}
          className="input-base font-mono uppercase"
          style={{ textTransform: 'uppercase' }}
        />
        <p className="mt-1 text-xs text-neutral-500">{t('gstinHint')}</p>
      </div>

      <div>
        <label htmlFor="pan" className="label-base">
          {t('panLabel')}
        </label>
        <input
          id="pan"
          name="pan"
          defaultValue={initial?.pan ?? ''}
          maxLength={10}
          placeholder={t('panPlaceholder')}
          className="input-base font-mono uppercase"
          style={{ textTransform: 'uppercase' }}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="address_line1" className="label-base">
            {t('addressLine1Label')}
          </label>
          <input
            id="address_line1"
            name="address_line1"
            defaultValue={initial?.address_line1 ?? ''}
            className="input-base"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="address_line2" className="label-base">
            {t('addressLine2Label')}
          </label>
          <input
            id="address_line2"
            name="address_line2"
            defaultValue={initial?.address_line2 ?? ''}
            className="input-base"
          />
        </div>
        <div>
          <label htmlFor="city" className="label-base">
            {t('cityLabel')}
          </label>
          <input id="city" name="city" defaultValue={initial?.city ?? ''} className="input-base" />
        </div>
        <div>
          <label htmlFor="state" className="label-base">
            {t('stateLabel')}
          </label>
          <input
            id="state"
            name="state"
            defaultValue={initial?.state ?? ''}
            className="input-base"
          />
        </div>
        <div>
          <label htmlFor="pincode" className="label-base">
            {t('pincodeLabel')}
          </label>
          <input
            id="pincode"
            name="pincode"
            defaultValue={initial?.pincode ?? ''}
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            placeholder={t('pincodePlaceholder')}
            className="input-base"
          />
        </div>
      </div>

      <div>
        <label htmlFor="group_id" className="label-base">
          {t('groupLabel')}
        </label>
        <select
          id="group_id"
          name="group_id"
          defaultValue={initial?.group_id ?? ''}
          className="input-base"
        >
          <option value="">{t('groupPlaceholder')}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.city} — {g.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-neutral-500">{t('groupHint')}</p>
      </div>

      <div>
        <label htmlFor="notes" className="label-base">
          {t('notesLabel')}
        </label>
        <textarea
          id="notes"
          name="notes"
          defaultValue={initial?.notes ?? ''}
          rows={2}
          className="input-base resize-y"
        />
      </div>

      {initial ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={initial.is_active}
            className="h-5 w-5"
          />
          {t('isActiveLabel')}
        </label>
      ) : (
        <input type="hidden" name="is_active" value="on" />
      )}

      <AuditReasonField required={isSuperAdmin} />

      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}

      <div className="flex items-center gap-3">
        <SubmitButton label={tCommon('save')} pendingLabel={tCommon('saving')} />
        <Link href="/billing/customers" className="btn-ghost border border-neutral-300">
          {tCommon('cancel')}
        </Link>
      </div>
    </form>
  );
}
