'use client';

import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { cancelJournalEntryAction } from '../../actions';

export function CancelJournalButton({ id }: { id: string }) {
  const t = useTranslations('accounting.journal.detail');
  const tCommon = useTranslations('common.actions');
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    cancelJournalEntryAction,
    null,
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-ghost border border-red-300 text-red-700"
      >
        {t('cancelButton')}
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="w-full space-y-3 rounded-md border border-neutral-200 bg-neutral-50 p-3"
    >
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-neutral-700">{t('cancelConfirm')}</p>
      <div>
        <label htmlFor="reason" className="label-base">
          {t('reasonLabel')}
        </label>
        <input id="reason" name="reason" required className="input-base" />
      </div>
      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}
      <div className="flex items-center gap-2">
        <SubmitButton label={t('cancelButton')} className="btn-primary !w-auto bg-red-700 px-4" />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn-ghost border border-neutral-300"
        >
          {tCommon('cancel')}
        </button>
      </div>
    </form>
  );
}
