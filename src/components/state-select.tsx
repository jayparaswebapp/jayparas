'use client';

import { useTranslations } from 'next-intl';
import { INDIAN_STATES, canonicalState } from '@/lib/billing/states';

/**
 * State dropdown. Works controlled (value + onChange) or as a plain form
 * field (name + defaultValue). An old value that isn't a standard state name
 * is still shown so nothing is lost.
 */
export function StateSelect({
  id,
  name,
  value,
  defaultValue,
  onChange,
  required,
}: {
  id: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
  required?: boolean;
}) {
  const t = useTranslations('common');
  const current = canonicalState(value ?? defaultValue ?? '');
  const extra = current && !(INDIAN_STATES as readonly string[]).includes(current) ? current : null;
  const controlled = value !== undefined;
  return (
    <select
      id={id}
      name={name}
      required={required}
      className="input-base"
      {...(controlled
        ? { value: current, onChange: (e) => onChange?.(e.target.value) }
        : { defaultValue: current })}
    >
      <option value="">{t('selectState')}</option>
      {extra ? <option value={extra}>{extra}</option> : null}
      {INDIAN_STATES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
