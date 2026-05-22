import { useTranslations } from 'next-intl';

export function AuditReasonField({
  required = true,
  defaultValue = '',
  hint,
}: {
  required?: boolean;
  defaultValue?: string;
  hint?: string;
}) {
  const t = useTranslations('common.fields');
  return (
    <div>
      <label htmlFor="reason" className="label-base">
        {t('reason')}
        {required ? <span className="ml-1 text-red-600">*</span> : null}
      </label>
      <textarea
        id="reason"
        name="reason"
        defaultValue={defaultValue}
        required={required}
        rows={2}
        placeholder={t('reasonPlaceholder')}
        className="input-base resize-y text-base"
      />
      <p className="mt-1 text-xs text-neutral-500">{hint ?? t('reasonHelp')}</p>
    </div>
  );
}
