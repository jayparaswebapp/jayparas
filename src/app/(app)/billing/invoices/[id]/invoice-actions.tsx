'use client';

import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { cancelInvoiceAction, deleteInvoiceDraftAction, issueInvoiceAction } from '../actions';

type Variant = 'issue' | 'cancel' | 'delete';

export function InvoiceActions({
  id,
  status,
}: {
  id: string;
  status: 'draft' | 'issued' | 'cancelled';
}) {
  const t = useTranslations('billing.invoices.detail');
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
          {t('cancelInvoiceButton')}
        </button>
      )}

      {open === 'issue' ? (
        <ConfirmForm
          id={id}
          message={t('issueConfirm')}
          action={issueInvoiceAction}
          submitLabel={t('issueButton')}
          submitClassName="btn-primary !w-auto px-4"
          onClose={() => setOpen(null)}
          cancelLabel={tCommon('cancel')}
        />
      ) : null}
      {open === 'cancel' ? (
        <ConfirmForm
          id={id}
          message={t('cancelConfirm')}
          action={cancelInvoiceAction}
          submitLabel={t('cancelInvoiceButton')}
          submitClassName="btn-primary !w-auto bg-red-700 px-4"
          onClose={() => setOpen(null)}
          cancelLabel={tCommon('cancel')}
        />
      ) : null}
      {open === 'delete' ? (
        <ConfirmForm
          id={id}
          message={t('deleteConfirm')}
          action={deleteInvoiceDraftAction}
          submitLabel={t('deleteDraftButton')}
          submitClassName="btn-primary !w-auto bg-red-700 px-4"
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
  action,
  submitLabel,
  submitClassName,
  onClose,
  cancelLabel,
}: {
  id: string;
  message: string;
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  submitClassName: string;
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
