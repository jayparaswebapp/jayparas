'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { AuditReasonField } from '@/components/audit-reason-field';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { saveCustomerGroupAction } from './actions';

export interface GroupFormValues {
  id?: string;
  name: string;
  city: string;
  notes: string | null;
  is_active: boolean;
}

export function GroupForm({
  initial,
  isSuperAdmin,
}: {
  initial: GroupFormValues | null;
  isSuperAdmin: boolean;
}) {
  const t = useTranslations('billing.groups.form');
  const tCommon = useTranslations('common.actions');
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    saveCustomerGroupAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      <div>
        <label htmlFor="name" className="label-base">
          {t('nameLabel')}
        </label>
        <input
          id="name"
          name="name"
          defaultValue={initial?.name ?? ''}
          required
          placeholder={t('namePlaceholder')}
          className="input-base"
        />
      </div>

      <div>
        <label htmlFor="city" className="label-base">
          {t('cityLabel')}
        </label>
        <input
          id="city"
          name="city"
          defaultValue={initial?.city ?? ''}
          required
          placeholder={t('cityPlaceholder')}
          className="input-base"
        />
      </div>

      <div>
        <label htmlFor="notes" className="label-base">
          {t('notesLabel')}
        </label>
        <textarea
          id="notes"
          name="notes"
          defaultValue={initial?.notes ?? ''}
          rows={2}
          className="input-base resize-y"
        />
      </div>

      {initial ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={initial.is_active}
            className="h-5 w-5"
          />
          {t('isActiveLabel')}
        </label>
      ) : (
        <input type="hidden" name="is_active" value="on" />
      )}

      <AuditReasonField required={isSuperAdmin} />

      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}

      <div className="flex items-center gap-3">
        <SubmitButton label={tCommon('save')} pendingLabel={tCommon('saving')} />
        <Link href="/billing/groups" className="btn-ghost border border-neutral-300">
          {tCommon('cancel')}
        </Link>
      </div>
    </form>
  );
}
