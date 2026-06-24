'use client';

import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import {
  cancelSalesReturnAction,
  deleteSalesReturnDraftAction,
  issueSalesReturnAction,
} from '../actions';

type Variant = 'issue' | 'cancel' | 'delete';

export function ReturnActions({
  id,
  status,
}: {
  id: string;
  status: 'draft' | 'issued' | 'cancelled';
}) {
  const t = useTranslations('billing.returns.detail');
  const tCommon = useTranslations('common.actions');
  const [open, setOpen] = useState<Variant | null>(null);

  if (status === 'cancelled') return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'draft' ? (
        <>
          <button
            type="button"
            onClick={() => setOpen('issue')}
            className="btn-primary !w-auto px-4"
          >
            {t('issueButton')}
          </button>
          <button
            type="button"
            onClick={() => setOpen('delete')}
            className="btn-ghost border border-red-300 text-red-700"
          >
            {t('deleteDraftButton')}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setOpen('cancel')}
          className="btn-ghost border border-red-300 text-red-700"
        >
          {t('cancelReturnButton')}
        </button>
      )}

      {open === 'issue' ? (
        <ConfirmForm
          id={id}
          message={t('issueConfirm')}
          submitLabel={t('issueButton')}
          submitClassName="btn-primary !w-auto px-4"
          action={issueSalesReturnAction}
          onClose={() => setOpen(null)}
          cancelLabel={tCommon('cancel')}
        />
      ) : null}
      {open === 'cancel' ? (
        <CancelForm
          id={id}
          message={t('cancelConfirm')}
          reasonLabel={t('reasonLabel')}
          submitLabel={t('cancelReturnButton')}
          onClose={() => setOpen(null)}
          cancelLabel={tCommon('cancel')}
        />
      ) : null}
      {open === 'delete' ? (
        <ConfirmForm
          id={id}
          message={t('deleteConfirm')}
          submitLabel={t('deleteDraftButton')}
          submitClassName="btn-primary !w-auto bg-red-700 px-4"
          action={deleteSalesReturnDraftAction}
          onClose={() => setOpen(null)}
          cancelLabel={tCommon('cancel')}
        />
      ) : null}
    </div>
  );
}

function ConfirmForm({
  id,
  message,
  submitLabel,
  submitClassName,
  action,
  onClose,
  cancelLabel,
}: {
  id: string;
  message: string;
  submitLabel: string;
  submitClassName: string;
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  onClose: () => void;
  cancelLabel: string;
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
  message,
  reasonLabel,
  submitLabel,
  onClose,
  cancelLabel,
}: {
  id: string;
  message: string;
  reasonLabel: string;
  submitLabel: string;
  onClose: () => void;
  cancelLabel: string;
}) {
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    cancelSalesReturnAction,
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
