'use client';

import { useEffect, useRef } from 'react';
import { useFormState } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { makeBillFromOrderAction } from '../actions';

/**
 * Ready order → draft bill of the packed qty (owner only). Anything not
 * packed moves to a new pending order. Shortcut: B (outside text boxes).
 */
export function MakeBillButton({ id, hasShort }: { id: string; hasShort: boolean }) {
  const t = useTranslations('orders.bill');
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    makeBillFromOrderAction,
    null,
  );

  useEffect(() => {
    if (state?.ok && state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'b' && e.key !== 'B') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) {
        return;
      }
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="mb-4 space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-4"
    >
      <input type="hidden" name="id" value={id} />
      <p className="text-sm font-medium text-emerald-900">{t('hint')}</p>
      {hasShort ? <p className="text-sm text-amber-800">{t('shortHint')}</p> : null}
      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}
      <SubmitButton
        label={t('makeBill')}
        pendingLabel={t('making')}
        className="btn-primary !w-auto px-6"
      />
    </form>
  );
}
