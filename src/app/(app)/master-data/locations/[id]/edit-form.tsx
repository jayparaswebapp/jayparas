'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { updateLocationAction } from './actions';

export function LocationEditForm({
  location,
}: {
  location: { id: string; name_en: string; name_gu: string; is_active: boolean };
}) {
  const t = useTranslations('masterData.locations.edit');
  const tCommon = useTranslations('common.actions');
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    updateLocationAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={location.id} />

      <div>
        <label htmlFor="name_en" className="label-base">
          {t('nameEnLabel')}
        </label>
        <input
          id="name_en"
          name="name_en"
          defaultValue={location.name_en}
          required
          className="input-base"
        />
      </div>

      <div>
        <label htmlFor="name_gu" className="label-base">
          {t('nameGuLabel')}
        </label>
        <input
          id="name_gu"
          name="name_gu"
          defaultValue={location.name_gu}
          required
          lang="gu"
          className="input-base"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={location.is_active}
          className="h-5 w-5"
        />
        {t('isActiveLabel')}
      </label>

      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}

      <div className="flex items-center gap-3">
        <SubmitButton label={tCommon('save')} pendingLabel={tCommon('saving')} />
        <Link href="/master-data/locations" className="btn-ghost border border-neutral-300">
          {tCommon('cancel')}
        </Link>
      </div>
    </form>
  );
}
