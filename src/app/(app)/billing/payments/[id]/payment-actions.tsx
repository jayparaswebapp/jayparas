'use client';

import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { cancelPaymentAction } from '../actions';

export function PaymentActions({ id, status }: { id: string; status: 'received' | 'cancelled' }) {
  const t = useTranslations('billing.payments.detail');
  const tCommon = useTranslations('common.actions');
  const [open, setOpen] = useState(false);

  if (status === 'cancelled') return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-ghost border border-red-300 text-red-700"
      >
        {t('cancelPaymentButton')}
      </button>

      {open ? (
        <CancelForm
          id={id}
          onClose={() => setOpen(false)}
          cancelLabel={tCommon('cancel')}
          confirmMessage={t('cancelConfirm')}
          reasonLabel={t('reasonLabel')}
          submitLabel={t('cancelPaymentButton')}
        />
      ) : null}
    </div>
  );
}

function CancelForm({
  id,
  onClose,
  cancelLabel,
  confirmMessage,
  reasonLabel,
  submitLabel,
}: {
  id: string;
  onClose: () => void;
  cancelLabel: string;
  confirmMessage: string;
  reasonLabel: string;
  submitLabel: string;
}) {
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    cancelPaymentAction,
    null,
  );
  return (
    <form
      action={formAction}
      className="w-full space-y-3 rounded-md border border-neutral-200 bg-neutral-50 p-3"
    >
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-neutral-700">{confirmMessage}</p>
      <div>
        <label htmlFor="reason" className="label-base">
          {reasonLabel}
        </label>
        <input id="reason" name="reason" required className="input-base" />
      </div>
      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}
      <div className="flex items-center gap-2">
        <SubmitButton label={submitLabel} className="btn-primary !w-auto bg-red-700 px-4" />
        <button type="button" onClick={onClose} className="btn-ghost border border-neutral-300">
          {cancelLabel}
        </button>
      </div>
    </form>
  );
}
