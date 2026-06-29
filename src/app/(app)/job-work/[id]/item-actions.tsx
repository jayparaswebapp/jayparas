'use client';

import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { addJobReceiptAction, addSubAssignmentAction } from '../actions';

export interface LabourerOption {
  id: string;
  label: string;
}

/**
 * Two inline forms shown per job-order-item on the detail page: one to
 * sub-assign work to a labourer, one to log finished pieces coming back.
 * Both keep their own useFormState slot so they can show errors independently.
 */
export function ItemActions({
  orderId,
  itemId,
  labourers,
}: {
  orderId: string;
  itemId: string;
  labourers: LabourerOption[];
}) {
  const t = useTranslations('jobWork.detail');
  const [open, setOpen] = useState<'sub' | 'receipt' | null>(null);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {labourers.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen(open === 'sub' ? null : 'sub')}
            className="btn-ghost border border-neutral-300 text-xs"
          >
            {t('addSubAssignmentButton')}
          </button>
        ) : (
          <span className="text-xs text-neutral-500">{t('noLabourersHint')}</span>
        )}
        <button
          type="button"
          onClick={() => setOpen(open === 'receipt' ? null : 'receipt')}
          className="btn-ghost border border-neutral-300 text-xs"
        >
          {t('addReceiptButton')}
        </button>
      </div>

      {open === 'sub' ? (
        <SubAssignForm
          orderId={orderId}
          itemId={itemId}
          labourers={labourers}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open === 'receipt' ? (
        <ReceiptForm
          orderId={orderId}
          itemId={itemId}
          labourers={labourers}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

function SubAssignForm({
  orderId,
  itemId,
  labourers,
  onClose,
}: {
  orderId: string;
  itemId: string;
  labourers: LabourerOption[];
  onClose: () => void;
}) {
  const t = useTranslations('jobWork.detail');
  const tCommon = useTranslations('common.actions');
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    addSubAssignmentAction,
    null,
  );
  if (state?.ok === true) queueMicrotask(onClose);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form
      action={formAction}
      className="grid grid-cols-1 gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 sm:grid-cols-4"
    >
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="item_id" value={itemId} />
      <select
        name="labourer_id"
        required
        defaultValue=""
        className="input-base !min-h-0 !py-1 !text-sm"
      >
        <option value="">{t('labourerPickerPlaceholder')}</option>
        {labourers.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
      <input
        type="number"
        name="qty"
        min="1"
        step="1"
        placeholder={t('qtyPlaceholder')}
        className="input-base !min-h-0 !py-1 !text-sm"
        required
      />
      <input
        type="date"
        name="date"
        defaultValue={today}
        className="input-base !min-h-0 !py-1 !text-sm"
      />
      <input
        name="notes"
        placeholder={t('notesPlaceholder')}
        className="input-base !min-h-0 !py-1 !text-sm"
      />
      {state && state.ok === false ? (
        <div className="sm:col-span-4">
          <ServerError messageKey={state.messageKey} />
        </div>
      ) : null}
      <div className="flex items-center gap-2 sm:col-span-4">
        <SubmitButton
          label={t('saveSubAssignButton')}
          className="btn-primary !w-auto px-3 text-sm"
        />
        <button
          type="button"
          onClick={onClose}
          className="btn-ghost border border-neutral-300 text-sm"
        >
          {tCommon('cancel')}
        </button>
      </div>
    </form>
  );
}

function ReceiptForm({
  orderId,
  itemId,
  labourers,
  onClose,
}: {
  orderId: string;
  itemId: string;
  labourers: LabourerOption[];
  onClose: () => void;
}) {
  const t = useTranslations('jobWork.detail');
  const tCommon = useTranslations('common.actions');
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    addJobReceiptAction,
    null,
  );
  if (state?.ok === true) queueMicrotask(onClose);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form
      action={formAction}
      className="grid grid-cols-2 gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 sm:grid-cols-5"
    >
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="item_id" value={itemId} />
      <select
        name="labourer_id"
        defaultValue=""
        className="input-base !min-h-0 !py-1 !text-sm sm:col-span-1"
      >
        <option value="">{t('labourerOptional')}</option>
        {labourers.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
      <input
        type="number"
        name="qty_accepted"
        min="0"
        step="1"
        defaultValue={0}
        placeholder={t('acceptedPlaceholder')}
        className="input-base !min-h-0 !py-1 !text-sm"
        required
      />
      <input
        type="number"
        name="qty_rejected"
        min="0"
        step="1"
        defaultValue={0}
        placeholder={t('rejectedPlaceholder')}
        className="input-base !min-h-0 !py-1 !text-sm"
      />
      <input
        type="date"
        name="date"
        defaultValue={today}
        className="input-base !min-h-0 !py-1 !text-sm"
      />
      <input
        name="notes"
        placeholder={t('notesPlaceholder')}
        className="input-base !min-h-0 !py-1 !text-sm"
      />
      {state && state.ok === false ? (
        <div className="col-span-2 sm:col-span-5">
          <ServerError messageKey={state.messageKey} />
        </div>
      ) : null}
      <div className="col-span-2 flex items-center gap-2 sm:col-span-5">
        <SubmitButton label={t('saveReceiptButton')} className="btn-primary !w-auto px-3 text-sm" />
        <button
          type="button"
          onClick={onClose}
          className="btn-ghost border border-neutral-300 text-sm"
        >
          {tCommon('cancel')}
        </button>
      </div>
    </form>
  );
}
