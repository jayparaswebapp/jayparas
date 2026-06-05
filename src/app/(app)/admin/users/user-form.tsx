'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { createAppUserAction, updateAppUserAction } from './actions';

export type AppUserRole = 'super_admin' | 'supervisor' | 'centre_manager' | 'accountant';

const ROLE_OPTIONS: AppUserRole[] = ['super_admin', 'supervisor', 'centre_manager', 'accountant'];

export interface UserFormValues {
  id?: string;
  full_name: string;
  mobile: string;
  role: AppUserRole;
  is_active: boolean;
  location_ids: string[];
}

export interface LocationOption {
  id: string;
  label: string;
}

export function UserForm({
  initial,
  locations,
  isSelf,
}: {
  initial: UserFormValues | null;
  locations: LocationOption[];
  isSelf: boolean;
}) {
  const t = useTranslations('admin.users');
  const tRoles = useTranslations('roles');
  const tCommon = useTranslations('common.actions');
  const action = initial ? updateAppUserAction : createAppUserAction;
  const [state, formAction] = useFormState<ActionResult | null, FormData>(action, null);

  const [role, setRole] = useState<AppUserRole>(initial?.role ?? 'centre_manager');
  const initialIds = new Set(initial?.location_ids ?? []);

  return (
    <form action={formAction} className="space-y-4">
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      <div>
        <label htmlFor="full_name" className="label-base">
          {t('form.fullNameLabel')}
        </label>
        <input
          id="full_name"
          name="full_name"
          defaultValue={initial?.full_name ?? ''}
          required
          className="input-base"
        />
      </div>

      {!initial ? (
        <div>
          <label htmlFor="mobile" className="label-base">
            {t('form.mobileLabel')}
          </label>
          <input
            id="mobile"
            name="mobile"
            required
            inputMode="numeric"
            pattern="[6-9][0-9]{9}"
            maxLength={10}
            placeholder={t('form.mobilePlaceholder')}
            className="input-base"
          />
        </div>
      ) : (
        <div>
          <span className="label-base">{t('form.mobileLabel')}</span>
          <div className="text-base text-neutral-900">{initial.mobile}</div>
        </div>
      )}

      <div>
        <label htmlFor="role" className="label-base">
          {t('form.roleLabel')}
        </label>
        <select
          id="role"
          name="role"
          required
          value={role}
          onChange={(e) => setRole(e.target.value as AppUserRole)}
          disabled={isSelf}
          className="input-base"
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {tRoles(r)}
            </option>
          ))}
        </select>
      </div>

      {!initial ? (
        <div>
          <label htmlFor="pin" className="label-base">
            {t('form.pinLabel')}
          </label>
          <input
            id="pin"
            name="pin"
            required
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="new-password"
            className="input-base"
          />
          <p className="mt-1 text-xs text-neutral-500">{t('form.pinHint')}</p>
        </div>
      ) : null}

      {role === 'centre_manager' ? (
        <fieldset>
          <legend className="label-base">{t('form.locationsLabel')}</legend>
          <p className="mb-2 text-xs text-neutral-500">{t('form.locationsHint')}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {locations.map((loc) => (
              <label key={loc.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="location_ids"
                  value={loc.id}
                  defaultChecked={initialIds.has(loc.id)}
                  className="h-5 w-5"
                />
                {loc.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {initial ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={initial.is_active}
            disabled={isSelf}
            className="h-5 w-5"
          />
          {t('form.isActiveLabel')}
        </label>
      ) : (
        <input type="hidden" name="is_active" value="on" />
      )}

      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}

      <div className="flex items-center gap-3">
        <SubmitButton label={tCommon('save')} pendingLabel={tCommon('saving')} />
        <Link href="/admin/users" className="btn-ghost border border-neutral-300">
          {tCommon('cancel')}
        </Link>
      </div>
    </form>
  );
}
