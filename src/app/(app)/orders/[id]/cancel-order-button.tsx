'use client';

import { useEffect, useState } from 'react';
import { useFormState } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { cancelOrderAction } from '../actions';

export function CancelOrderButton({ id }: { id: string }) {
  const t = useTranslations('orders.detail');
  const tCommon = useTranslations('common.actions');
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useFormState<ActionResult | null, FormData>(cancelOrderAction, null);

  useEffect(() => {
    if (state?.ok) {
      setConfirming(false);
      router.refresh();
    }
  }, [state, router]);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="btn-ghost border border-red-300 text-sm text-red-700"
      >
        {t('cancelOrder')}
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-2 rounded-md border border-red-200 bg-white p-3">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-neutral-700">{t('cancelConfirm')}</p>
      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}
      <div className="flex items-center gap-2">
        <SubmitButton
          label={t('cancelOrder')}
          pendingLabel={tCommon('saving')}
          className="btn-primary !w-auto bg-red-700 px-4"
        />
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="btn-ghost border border-neutral-300"
        >
          {t('keepOrder')}
        </button>
      </div>
    </form>
  );
}
