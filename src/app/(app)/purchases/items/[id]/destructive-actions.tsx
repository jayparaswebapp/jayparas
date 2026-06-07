'use client';

import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { restorePurchaseItemAction, softDeletePurchaseItemAction } from '../actions';

export function DestructiveActions({ itemId, isDeleted }: { itemId: string; isDeleted: boolean }) {
  const tCommon = useTranslations('common');
  const [confirming, setConfirming] = useState(false);
  const action = isDeleted ? restorePurchaseItemAction : softDeletePurchaseItemAction;
  const [state, formAction] = useFormState<ActionResult | null, FormData>(action, null);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={
          isDeleted
            ? 'btn-ghost border border-emerald-300 text-emerald-700'
            : 'btn-ghost border border-red-300 text-red-700'
        }
      >
        {isDeleted ? tCommon('actions.restore') : tCommon('actions.delete')}
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-md border border-neutral-200 bg-neutral-50 p-3"
    >
      <input type="hidden" name="id" value={itemId} />
      <p className="text-sm text-neutral-700">
        {isDeleted ? tCommon('confirm.restoreBody') : tCommon('confirm.softDeleteBody')}
      </p>
      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}
      <div className="flex items-center gap-2">
        <SubmitButton
          label={isDeleted ? tCommon('actions.restore') : tCommon('actions.delete')}
          pendingLabel={tCommon('actions.saving')}
          className={isDeleted ? 'btn-primary !w-auto px-4' : 'btn-primary !w-auto bg-red-700 px-4'}
        />
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="btn-ghost border border-neutral-300"
        >
          {tCommon('actions.cancel')}
        </button>
      </div>
    </form>
  );
}
