'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { useEffect } from 'react';
import { loginAction, type LoginState } from '@/lib/auth/login';

type FormValues = { mobile: string; pin: string };

const initialState: LoginState | null = null;

export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations('login');
  const [state, formAction] = useFormState(loginAction, initialState);

  const {
    register,
    formState: { errors },
    setFocus,
    trigger,
    getValues,
  } = useForm<FormValues>({
    mode: 'onBlur',
    defaultValues: { mobile: '', pin: '' },
  });

  useEffect(() => {
    setFocus('mobile');
  }, [setFocus]);

  const serverError =
    state && state.ok === false ? t(`errors.${state.error}`) : null;

  return (
    <form
      action={formAction}
      onSubmit={async (e) => {
        const valid = await trigger();
        if (!valid) {
          e.preventDefault();
          return;
        }
        // Normalise: trim mobile/pin before submit.
        const v = getValues();
        const fd = new FormData(e.currentTarget);
        fd.set('mobile', v.mobile.trim());
        fd.set('pin', v.pin.trim());
      }}
      className="space-y-4"
      noValidate
    >
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div>
        <label htmlFor="mobile" className="label-base">
          {t('mobileLabel')}
        </label>
        <input
          id="mobile"
          inputMode="numeric"
          autoComplete="tel-national"
          maxLength={10}
          placeholder={t('mobilePlaceholder')}
          aria-invalid={errors.mobile ? 'true' : 'false'}
          className="input-base tracking-widest"
          {...register('mobile', {
            required: 'invalidMobile',
            pattern: { value: /^[6-9]\d{9}$/, message: 'invalidMobile' },
          })}
        />
        {errors.mobile ? (
          <p className="error-text">{t(`errors.${errors.mobile.message ?? 'invalidMobile'}`)}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor="pin" className="label-base">
          {t('pinLabel')}
        </label>
        <input
          id="pin"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          type="password"
          placeholder={t('pinPlaceholder')}
          aria-invalid={errors.pin ? 'true' : 'false'}
          className="input-base tracking-[0.5em]"
          {...register('pin', {
            required: 'invalidPin',
            pattern: { value: /^\d{6}$/, message: 'invalidPin' },
          })}
        />
        {errors.pin ? (
          <p className="error-text">{t(`errors.${errors.pin.message ?? 'invalidPin'}`)}</p>
        ) : null}
      </div>

      {serverError ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {serverError}
        </div>
      ) : null}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const t = useTranslations('login');
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? t('submitting') : t('submit')}
    </button>
  );
}
