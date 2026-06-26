'use client';

import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { cancelJobOrderAction, closeJobOrderAction } from '../actions';

export function OrderActions({
  id,
  status,
}: {
  id: string;
  status: 'open' | 'closed' | 'cancelled';
}) {
  const t = useTranslations('jobWork.detail');
  const tCommon = useTranslations('common.actions');
  const [open, setOpen] = useState<'close' | 'cancel' | null>(null);

  if (status !== 'open') return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => setOpen('close')} className="btn-primary !w-auto px-4">
        {t('closeOrderButton')}
      </button>
      <button
        type="button"
        onClick={() => setOpen('cancel')}
        className="btn-ghost border border-red-300 text-red-700"
      >
        {t('cancelOrderButton')}
      </button>

      {open === 'close' ? (
        <ConfirmForm
          id={id}
          action={closeJobOrderAction}
          message={t('closeConfirm')}
          submitLabel={t('closeOrderButton')}
          submitClassName="btn-primary !w-auto px-4"
          cancelLabel={tCommon('cancel')}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open === 'cancel' ? (
        <CancelForm
          id={id}
          onClose={() => setOpen(null)}
          message={t('cancelConfirm')}
          reasonLabel={t('reasonLabel')}
          submitLabel={t('cancelOrderButton')}
          cancelLabel={tCommon('cancel')}
        />
      ) : null}
    </div>
  );
}

function ConfirmForm({
  id,
  action,
  message,
  submitLabel,
  submitClassName,
  cancelLabel,
  onClose,
}: {
  id: string;
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  message: string;
  submitLabel: string;
  submitClassName: string;
  cancelLabel: string;
  onClose: () => void;
}) {
  const [state, formAction] = useFormState<ActionResult | null, FormData>(action, null);
  return (
    <form
      action={formAction}
      className="w-full space-y-3 rounded-md border border-neutral-200 bg-neutral-50 p-3"
    >
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-neutral-700">{message}</p>
      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}
      <div className="flex items-center gap-2">
        <SubmitButton label={submitLabel} className={submitClassName} />
        <button type="button" onClick={onClose} className="btn-ghost border border-neutral-300">
          {cancelLabel}
        </button>
      </div>
    </form>
  );
}

function CancelForm({
  id,
  onClose,
  message,
  reasonLabel,
  submitLabel,
  cancelLabel,
}: {
  id: string;
  onClose: () => void;
  message: string;
  reasonLabel: string;
  submitLabel: string;
  cancelLabel: string;
}) {
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    cancelJobOrderAction,
    null,
  );
  return (
    <form
      action={formAction}
      className="w-full space-y-3 rounded-md border border-neutral-200 bg-neutral-50 p-3"
    >
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-neutral-700">{message}</p>
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
