'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { uploadDesignImage, validateDesignImageFile } from '@/lib/storage/design-images';
import { AuditReasonField } from '@/components/audit-reason-field';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { saveDesignAction } from './actions';

export interface DesignFormValues {
  id?: string;
  design_number: string;
  name_en: string | null;
  name_gu: string | null;
  current_rate_per_guss: string;
  image_path: string | null;
  is_active: boolean;
}

export function DesignForm({
  initial,
  imageSignedUrl,
  isSuperAdmin,
}: {
  initial: DesignFormValues | null;
  imageSignedUrl: string | null;
  isSuperAdmin: boolean;
}) {
  const t = useTranslations('masterData.designs');
  const tCommon = useTranslations('common.actions');
  const [state, formAction] = useFormState<ActionResult | null, FormData>(saveDesignAction, null);

  const [imagePath, setImagePath] = useState<string>(initial?.image_path ?? '');
  const [previewUrl, setPreviewUrl] = useState<string | null>(imageSignedUrl);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [, startTransition] = useTransition();

  async function onFileChange(file: File | null) {
    setUploadError(null);
    if (!file) return;
    const v = validateDesignImageFile(file);
    if (!v.ok) {
      setUploadError(v.messageKey);
      return;
    }
    setUploading(true);
    const supabase = createClient();
    const result = await uploadDesignImage(supabase, file);
    setUploading(false);
    if (!result.ok) {
      setUploadError(result.messageKey);
      return;
    }
    setImagePath(result.path);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function onRemoveImage() {
    setImagePath('');
    setPreviewUrl(null);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (uploading) e.preventDefault();
  }

  function handleAction(formData: FormData) {
    startTransition(() => {
      formAction(formData);
    });
  }

  return (
    <form action={handleAction} onSubmit={onSubmit} className="space-y-4">
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="image_path" value={imagePath} />

      <div>
        <label htmlFor="design_number" className="label-base">
          {t('form.designNumberLabel')}
        </label>
        <input
          id="design_number"
          name="design_number"
          defaultValue={initial?.design_number ?? ''}
          required
          inputMode="numeric"
          placeholder={t('form.designNumberPlaceholder')}
          className="input-base"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name_en" className="label-base">
            {t('form.nameEnLabel')}
          </label>
          <input
            id="name_en"
            name="name_en"
            defaultValue={initial?.name_en ?? ''}
            className="input-base"
          />
        </div>
        <div>
          <label htmlFor="name_gu" className="label-base">
            {t('form.nameGuLabel')}
          </label>
          <input
            id="name_gu"
            name="name_gu"
            defaultValue={initial?.name_gu ?? ''}
            lang="gu"
            className="input-base"
          />
        </div>
      </div>

      <div>
        <label htmlFor="rate" className="label-base">
          {t('form.rateLabel')}
        </label>
        <input
          id="rate"
          name="rate"
          type="number"
          step="0.01"
          min="0.01"
          defaultValue={initial?.current_rate_per_guss ?? ''}
          required
          inputMode="decimal"
          placeholder={t('form.ratePlaceholder')}
          className="input-base"
        />
      </div>

      <div>
        <label htmlFor="image" className="label-base">
          {t('form.imageLabel')}
        </label>
        {previewUrl ? (
          <div className="mb-2 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt=""
              className="h-20 w-20 rounded-md object-cover ring-1 ring-neutral-200"
            />
            <button
              type="button"
              onClick={onRemoveImage}
              className="btn-ghost border border-neutral-300 text-sm"
            >
              {t('form.imageRemove')}
            </button>
          </div>
        ) : null}
        <input
          id="image"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />
        <p className="mt-1 text-xs text-neutral-500">{t('form.imageHint')}</p>
        {uploading ? <p className="mt-1 text-xs text-neutral-500">{tCommon('saving')}</p> : null}
        {uploadError ? <ServerError messageKey={uploadError} /> : null}
      </div>

      {initial ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={initial.is_active}
            className="h-5 w-5"
          />
          {t('form.isActiveLabel')}
        </label>
      ) : (
        <input type="hidden" name="is_active" value="on" />
      )}

      <AuditReasonField required={isSuperAdmin} />

      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}

      <div className="flex items-center gap-3">
        <SubmitButton label={tCommon('save')} pendingLabel={tCommon('saving')} />
        <Link href="/master-data/designs" className="btn-ghost border border-neutral-300">
          {tCommon('cancel')}
        </Link>
      </div>
    </form>
  );
}
