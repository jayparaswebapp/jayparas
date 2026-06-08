'use client';

import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { saveCompanyInfoAction } from './actions';

export interface CompanyFormValues {
  legal_name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstin: string | null;
  pan: string | null;
  mobile: string | null;
  email: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_ifsc: string | null;
  default_terms: string | null;
  default_due_days: number;
}

export function CompanyForm({ initial }: { initial: CompanyFormValues | null }) {
  const t = useTranslations('billing.company');
  const tForm = useTranslations('billing.company.form');
  const tCommon = useTranslations('common');
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    saveCompanyInfoAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="legal_name" className="label-base">
          {tForm('legalNameLabel')}
        </label>
        <input
          id="legal_name"
          name="legal_name"
          defaultValue={initial?.legal_name ?? ''}
          required
          className="input-base"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="address_line1" className="label-base">
            {tForm('addressLine1Label')}
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
            {tForm('addressLine2Label')}
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
            {tForm('cityLabel')}
          </label>
          <input id="city" name="city" defaultValue={initial?.city ?? ''} className="input-base" />
        </div>
        <div>
          <label htmlFor="state" className="label-base">
            {tForm('stateLabel')}
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
            {tForm('pincodeLabel')}
          </label>
          <input
            id="pincode"
            name="pincode"
            defaultValue={initial?.pincode ?? ''}
            inputMode="numeric"
            maxLength={6}
            pattern="\d{6}"
            className="input-base"
          />
        </div>
        <div>
          <label htmlFor="mobile" className="label-base">
            {tForm('mobileLabel')}
          </label>
          <input
            id="mobile"
            name="mobile"
            defaultValue={initial?.mobile ?? ''}
            inputMode="numeric"
            className="input-base"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="email" className="label-base">
            {tForm('emailLabel')}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={initial?.email ?? ''}
            className="input-base"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="gstin" className="label-base">
            {tForm('gstinLabel')}
          </label>
          <input
            id="gstin"
            name="gstin"
            defaultValue={initial?.gstin ?? ''}
            maxLength={15}
            className="input-base font-mono uppercase"
            style={{ textTransform: 'uppercase' }}
          />
          <p className="mt-1 text-xs text-neutral-500">{tForm('gstinHint')}</p>
        </div>
        <div>
          <label htmlFor="pan" className="label-base">
            {tForm('panLabel')}
          </label>
          <input
            id="pan"
            name="pan"
            defaultValue={initial?.pan ?? ''}
            maxLength={10}
            className="input-base font-mono uppercase"
            style={{ textTransform: 'uppercase' }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="bank_name" className="label-base">
            {tForm('bankNameLabel')}
          </label>
          <input
            id="bank_name"
            name="bank_name"
            defaultValue={initial?.bank_name ?? ''}
            className="input-base"
          />
        </div>
        <div>
          <label htmlFor="bank_account_no" className="label-base">
            {tForm('bankAccountNoLabel')}
          </label>
          <input
            id="bank_account_no"
            name="bank_account_no"
            defaultValue={initial?.bank_account_no ?? ''}
            className="input-base font-mono"
          />
        </div>
        <div>
          <label htmlFor="bank_ifsc" className="label-base">
            {tForm('bankIfscLabel')}
          </label>
          <input
            id="bank_ifsc"
            name="bank_ifsc"
            defaultValue={initial?.bank_ifsc ?? ''}
            className="input-base font-mono uppercase"
            style={{ textTransform: 'uppercase' }}
          />
        </div>
      </div>

      <div>
        <label htmlFor="default_terms" className="label-base">
          {tForm('defaultTermsLabel')}
        </label>
        <textarea
          id="default_terms"
          name="default_terms"
          defaultValue={initial?.default_terms ?? ''}
          rows={2}
          className="input-base resize-y"
        />
      </div>

      <div className="max-w-xs">
        <label htmlFor="default_due_days" className="label-base">
          {tForm('defaultDueDaysLabel')}
        </label>
        <input
          id="default_due_days"
          name="default_due_days"
          type="number"
          min="0"
          defaultValue={initial?.default_due_days ?? 0}
          className="input-base"
        />
      </div>

      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}
      {state && state.ok === true ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {tCommon('toasts.saved')}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <SubmitButton label={t('saveButton')} pendingLabel={tCommon('actions.saving')} />
      </div>
    </form>
  );
}
