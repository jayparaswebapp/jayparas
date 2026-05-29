'use client';

import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ServerError, SubmitButton } from '@/components/form-status';
import { AuditReasonField } from '@/components/audit-reason-field';
import type { ActionResult } from '@/lib/rpc/action-result';
import { setSkuActiveAction } from '../actions';

export function SkuActiveToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const t = useTranslations('skus.detail');
  const tCommon = useTranslations('common.actions');
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useFormState<ActionResult | null, FormData>(setSkuActiveAction, null);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={
          isActive
            ? 'btn-ghost border border-red-300 text-red-700'
            : 'btn-ghost border border-emerald-300 text-emerald-700'
        }
      >
        {isActive ? t('deactivate') : t('reactivate')}
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="is_active" value={isActive ? 'false' : 'true'} />
      <p className="text-sm text-neutral-700">
        {isActive ? t('deactivateConfirm') : t('reactivateConfirm')}
      </p>
      <AuditReasonField />
      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}
      <div className="flex items-center gap-2">
        <SubmitButton
          label={isActive ? t('deactivate') : t('reactivate')}
          pendingLabel={tCommon('saving')}
          className={isActive ? 'btn-primary !w-auto bg-red-700 px-4' : 'btn-primary !w-auto px-4'}
        />
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="btn-ghost border border-neutral-300"
        >
          {tCommon('cancel')}
        </button>
      </div>
    </form>
  );
}
