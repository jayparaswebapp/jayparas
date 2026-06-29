'use client';

import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { saveLabourerAction, softDeleteLabourerAction } from '@/app/(app)/job-work/actions';

export interface LabourerRow {
  id: string;
  full_name: string;
  mobile: string | null;
  notes: string | null;
  is_active: boolean;
}

export function LabourersSection({
  leadLadyId,
  labourers,
}: {
  leadLadyId: string;
  labourers: LabourerRow[];
}) {
  const t = useTranslations('jobWork.labourers');
  const tCommon = useTranslations('common.actions');
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <section className="mt-6 border-t border-neutral-200 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          {t('sectionTitle')}
        </h2>
        {!addOpen ? (
          <button
            type="button"
            onClick={() => {
              setAddOpen(true);
              setEditingId(null);
            }}
            className="btn-ghost border border-neutral-300 text-sm"
          >
            {t('addButton')}
          </button>
        ) : null}
      </div>

      {addOpen ? (
        <LabourerForm
          leadLadyId={leadLadyId}
          onClose={() => setAddOpen(false)}
          cancelLabel={tCommon('cancel')}
        />
      ) : null}

      <ul className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {labourers.map((l) =>
          editingId === l.id ? (
            <li key={l.id} className="px-3 py-3">
              <LabourerForm
                leadLadyId={leadLadyId}
                initial={l}
                onClose={() => setEditingId(null)}
                cancelLabel={tCommon('cancel')}
              />
            </li>
          ) : (
            <li key={l.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-neutral-900">{l.full_name}</div>
                <div className="text-sm text-neutral-700">{l.mobile ?? '—'}</div>
                {l.notes ? (
                  <div className="truncate text-xs text-neutral-500">{l.notes}</div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setEditingId(l.id)}
                className="btn-ghost border border-neutral-300 text-sm"
              >
                {tCommon('edit')}
              </button>
              <DeleteLabourer id={l.id} leadLadyId={leadLadyId} label={tCommon('delete')} />
            </li>
          ),
        )}
        {labourers.length === 0 && !addOpen ? (
          <li className="px-4 py-6 text-center text-sm text-neutral-500">{t('empty')}</li>
        ) : null}
      </ul>
    </section>
  );
}

function LabourerForm({
  leadLadyId,
  initial,
  onClose,
  cancelLabel,
}: {
  leadLadyId: string;
  initial?: LabourerRow;
  onClose: () => void;
  cancelLabel: string;
}) {
  const t = useTranslations('jobWork.labourers');
  const [state, formAction] = useFormState<ActionResult | null, FormData>(saveLabourerAction, null);
  // Close form on successful save — useFormState's state turns into {ok:true}.
  if (state?.ok === true) {
    // Defer close to the next microtask so React can unmount safely.
    queueMicrotask(onClose);
  }

  return (
    <form
      action={formAction}
      className="mb-3 grid grid-cols-1 gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 sm:grid-cols-3"
    >
      <input type="hidden" name="lead_lady_id" value={leadLadyId} />
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input
        name="full_name"
        defaultValue={initial?.full_name ?? ''}
        placeholder={t('namePlaceholder')}
        className="input-base sm:col-span-1"
        required
      />
      <input
        name="mobile"
        defaultValue={initial?.mobile ?? ''}
        placeholder={t('mobilePlaceholder')}
        inputMode="tel"
        className="input-base sm:col-span-1"
      />
      <input
        name="notes"
        defaultValue={initial?.notes ?? ''}
        placeholder={t('notesPlaceholder')}
        className="input-base sm:col-span-1"
      />
      {state && state.ok === false ? (
        <div className="sm:col-span-3">
          <ServerError messageKey={state.messageKey} />
        </div>
      ) : null}
      <div className="flex items-center gap-2 sm:col-span-3">
        <SubmitButton label={t('saveButton')} className="btn-primary !w-auto px-4" />
        <button type="button" onClick={onClose} className="btn-ghost border border-neutral-300">
          {cancelLabel}
        </button>
      </div>
    </form>
  );
}

function DeleteLabourer({
  id,
  leadLadyId,
  label,
}: {
  id: string;
  leadLadyId: string;
  label: string;
}) {
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    softDeleteLabourerAction,
    null,
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="lead_lady_id" value={leadLadyId} />
      <button type="submit" className="btn-ghost border border-red-300 text-sm text-red-700">
        {label}
      </button>
      {state && state.ok === false ? (
        <span className="ml-2 text-xs text-red-700">{state.messageKey}</span>
      ) : null}
    </form>
  );
}
