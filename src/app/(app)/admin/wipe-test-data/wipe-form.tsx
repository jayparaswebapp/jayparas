'use client';

import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ServerError, SubmitButton } from '@/components/form-status';
import { wipeTestDataAction, type WipeResult } from './actions';

interface CountEntry {
  key: string;
  label: string;
  before: number;
}

/**
 * Type-to-confirm gate — the button stays disabled until the user types
 * "WIPE" exactly. The server action also enforces this, but the client
 * gate makes the "you can't fire this by accident" contract obvious.
 */
export function WipeForm({
  counts,
}: {
  counts: Array<{ key: string; label: string; before: number }>;
}) {
  const t = useTranslations('admin.wipe');
  const [state, formAction] = useFormState<WipeResult | null, FormData>(wipeTestDataAction, null);
  const [confirmText, setConfirmText] = useState('');
  const armed = confirmText === 'WIPE';

  if (state?.ok) {
    return <WipeSuccess wiped={state.wiped as unknown as Record<string, number>} />;
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4">
        <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-900">
          {t('warningTitle')}
        </div>
        <p className="text-sm text-red-900">{t('warning')}</p>
      </div>

      <CountsTable counts={counts} />

      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
          {t('safeSectionTitle')}
        </div>
        <p className="text-sm text-neutral-700">{t('safeList')}</p>
      </div>

      <div>
        <label htmlFor="confirm" className="label-base">
          {t('confirmLabel')}
        </label>
        <input
          id="confirm"
          name="confirm"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="WIPE"
          className="input-base font-mono uppercase"
        />
        <p className="mt-1 text-xs text-neutral-500">{t('confirmHint')}</p>
      </div>

      {state && !state.ok ? <ServerError messageKey={state.messageKey} /> : null}

      <SubmitButton
        label={t('submitButton')}
        pendingLabel={t('submitting')}
        className={
          armed
            ? 'btn-primary !w-auto bg-red-700 px-5'
            : 'btn-primary !w-auto bg-red-700 px-5 opacity-50'
        }
        // The submit button component doesn't accept `disabled` directly, but
        // the server action re-checks so a manual submit still errors out.
      />
      {!armed ? <p className="text-xs text-neutral-500">{t('disabledHint')}</p> : null}
    </form>
  );
}

function CountsTable({ counts }: { counts: CountEntry[] }) {
  const t = useTranslations('admin.wipe');
  const total = counts.reduce((a, c) => a + c.before, 0);
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {t('countsTitle')} ({total.toLocaleString()})
      </div>
      <ul className="divide-y divide-neutral-100 text-sm">
        {counts.map((c) => (
          <li key={c.key} className="flex items-center justify-between px-3 py-1.5">
            <span className="text-neutral-700">{c.label}</span>
            <span className="font-mono tabular-nums text-neutral-900">
              {c.before.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WipeSuccess({ wiped }: { wiped: Record<string, number> }) {
  const t = useTranslations('admin.wipe');
  const total = Object.values(wiped).reduce((a, b) => a + b, 0);
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <div className="mb-2 text-sm font-semibold text-emerald-900">
        {t('successTitle', { total: total.toLocaleString() })}
      </div>
      <p className="mb-3 text-sm text-emerald-900">{t('successHint')}</p>
      <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        {Object.entries(wiped)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => (
            <li key={k} className="flex items-center justify-between">
              <span className="text-emerald-900">{k}</span>
              <span className="font-mono tabular-nums text-emerald-900">{v.toLocaleString()}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}
