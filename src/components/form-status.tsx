'use client';

import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';

export function SubmitButton({
  label,
  pendingLabel,
  className = 'btn-primary',
}: {
  label: string;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? (pendingLabel ?? label) : label}
    </button>
  );
}

export function ServerError({ messageKey }: { messageKey: string | null | undefined }) {
  const t = useTranslations();
  if (!messageKey) return null;
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {t(messageKey)}
    </div>
  );
}
