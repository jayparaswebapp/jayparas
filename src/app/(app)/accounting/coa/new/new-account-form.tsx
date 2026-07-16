'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { createAccountAction } from '../../actions';

export interface ParentOption {
  id: string;
  label: string;
}

export function NewAccountForm({ parents }: { parents: ParentOption[] }) {
  const t = useTranslations('accounting.coa');
  const tCommon = useTranslations('common.actions');
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    createAccountAction,
    null,
  );
  const [isGroup, setIsGroup] = useState(false);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="parent_id" className="label-base">
          {t('parentLabel')}
        </label>
        <select id="parent_id" name="parent_id" required defaultValue="" className="input-base">
          <option value="">— {t('parentPickerPlaceholder')} —</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-neutral-500">{t('parentHint')}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="code" className="label-base">
            {t('codeLabel')}
          </label>
          <input
            id="code"
            name="code"
            required
            placeholder="e.g. 1201"
            className="input-base font-mono"
          />
        </div>
        <div className="flex items-center gap-2 sm:pt-6">
          <input
            id="is_group"
            name="is_group"
            type="checkbox"
            checked={isGroup}
            onChange={(e) => setIsGroup(e.target.checked)}
            className="h-4 w-4 accent-brand-700"
          />
          <label htmlFor="is_group" className="text-sm">
            {t('isGroupLabel')}
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="name_en" className="label-base">
            {t('nameEnLabel')}
          </label>
          <input id="name_en" name="name_en" required className="input-base" />
        </div>
        <div>
          <label htmlFor="name_gu" className="label-base">
            {t('nameGuLabel')}
          </label>
          <input id="name_gu" name="name_gu" required className="input-base" />
        </div>
      </div>

      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}

      <div className="flex items-center gap-3">
        <SubmitButton label={tCommon('save')} pendingLabel={tCommon('saving')} />
        <Link href="/accounting/coa" className="btn-ghost border border-neutral-300">
          {tCommon('cancel')}
        </Link>
      </div>
    </form>
  );
}
