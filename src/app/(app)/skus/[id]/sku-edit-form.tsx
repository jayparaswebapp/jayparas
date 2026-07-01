'use client';

import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  uploadSkuPhoto,
  validateSkuPhotoFile,
  getSkuPhotoPublicUrl,
} from '@/lib/storage/sku-photos';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { updateSkuAction } from '../actions';

export interface SkuEditValues {
  id: string;
  design_name: string;
  price: string;
  discount_pct: string;
  is_discountable: boolean;
  photo_path: string | null;
  /** Only shown to super_admin; supervisors don't get these fields. */
  pack_size?: number;
  rate_unit?: 'pack' | 'piece';
}

export function SkuEditForm({
  initial,
  photoUrl,
  canEditLocked = false,
}: {
  initial: SkuEditValues;
  photoUrl: string | null;
  canEditLocked?: boolean;
}) {
  const t = useTranslations('skus.form');
  const tCommon = useTranslations('common.actions');
  const [state, formAction] = useFormState<ActionResult | null, FormData>(updateSkuAction, null);

  const [photoPath, setPhotoPath] = useState<string>(initial.photo_path ?? '');
  const [previewUrl, setPreviewUrl] = useState<string | null>(photoUrl);
  const [discountPct, setDiscountPct] = useState<string>(initial.discount_pct);
  const [isDiscountable, setIsDiscountable] = useState<boolean>(initial.is_discountable);
  const [packSize, setPackSize] = useState<string>(
    initial.pack_size !== undefined ? String(initial.pack_size) : '',
  );
  const [rateUnit, setRateUnit] = useState<'pack' | 'piece'>(initial.rate_unit ?? 'piece');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [, startTransition] = useTransition();

  const packChanged =
    canEditLocked &&
    (Number.parseInt(packSize, 10) !== initial.pack_size || rateUnit !== initial.rate_unit);

  async function onFileChange(file: File | null) {
    setUploadError(null);
    if (!file) return;
    const v = validateSkuPhotoFile(file);
    if (!v.ok) {
      setUploadError(v.messageKey);
      return;
    }
    setUploading(true);
    const supabase = createClient();
    const result = await uploadSkuPhoto(supabase, file);
    setUploading(false);
    if (!result.ok) {
      setUploadError(result.messageKey);
      return;
    }
    setPhotoPath(result.path);
    setPreviewUrl(getSkuPhotoPublicUrl(supabase, result.path));
  }

  function onRemovePhoto() {
    setPhotoPath('');
    setPreviewUrl(null);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (uploading) e.preventDefault();
  }

  function handleAction(formData: FormData) {
    startTransition(() => formAction(formData));
  }

  return (
    <form action={handleAction} onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="id" value={initial.id} />
      <input type="hidden" name="photo_path" value={photoPath} />

      <div>
        <label htmlFor="design_name" className="label-base">
          {t('designNameLabel')}
        </label>
        <input
          id="design_name"
          name="design_name"
          defaultValue={initial.design_name}
          required
          className="input-base"
        />
      </div>

      {canEditLocked ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-900">
            {t('lockedOverrideTitle')}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor="pack_size" className="label-base">
                {t('lockedPackSizeLabel')}
              </label>
              <input
                id="pack_size"
                name="pack_size"
                type="number"
                min="1"
                max="9999"
                step="1"
                value={packSize}
                onChange={(e) => setPackSize(e.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
                className="input-base"
              />
            </div>
            <div>
              <label className="label-base">{t('lockedRateUnitLabel')}</label>
              <div className="flex items-center gap-3 pt-1">
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    name="rate_unit"
                    value="piece"
                    checked={rateUnit === 'piece'}
                    onChange={() => setRateUnit('piece')}
                    className="accent-brand-700"
                  />
                  {t('customRateUnitPiece')}
                </label>
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    name="rate_unit"
                    value="pack"
                    checked={rateUnit === 'pack'}
                    onChange={() => setRateUnit('pack')}
                    className="accent-brand-700"
                  />
                  {t('customRateUnitPack')}
                </label>
              </div>
            </div>
          </div>
          {packChanged ? (
            <p className="mt-2 text-xs text-amber-900">{t('lockedChangeWarning')}</p>
          ) : (
            <p className="mt-2 text-xs text-amber-800">{t('lockedOverrideHint')}</p>
          )}
        </div>
      ) : null}

      <div>
        <label htmlFor="price" className="label-base">
          {t('mrpLabel')}
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-lg text-neutral-500">
            ₹
          </span>
          <input
            id="price"
            name="price"
            type="number"
            min="0"
            step="0.01"
            defaultValue={initial.price}
            required
            inputMode="decimal"
            className="input-base pl-8"
          />
        </div>
        <p className="mt-1 text-xs text-neutral-500">{t('priceHint')}</p>
      </div>

      <div>
        <label htmlFor="discount_pct" className="label-base">
          {t('discountLabel')}
        </label>
        <input
          id="discount_pct"
          name="discount_pct"
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={discountPct}
          onChange={(e) => setDiscountPct(e.target.value)}
          inputMode="decimal"
          className="input-base"
        />
        <p className="mt-1 text-xs text-neutral-500">{t('discountHint')}</p>
      </div>

      <div className="flex items-start gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
        <input
          id="is_discountable"
          name="is_discountable"
          type="checkbox"
          checked={isDiscountable}
          onChange={(e) => setIsDiscountable(e.target.checked)}
          className="mt-1 h-4 w-4 accent-brand-700"
        />
        <label htmlFor="is_discountable" className="text-sm">
          <span className="block font-medium text-neutral-900">{t('discountableLabel')}</span>
          <span className="block text-xs text-neutral-500">{t('discountableHint')}</span>
        </label>
      </div>

      <div>
        <label htmlFor="photo" className="label-base">
          {t('photoLabel')}
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
              onClick={onRemovePhoto}
              className="btn-ghost border border-neutral-300 text-sm"
            >
              {t('photoRemove')}
            </button>
          </div>
        ) : null}
        <input
          id="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />
        <p className="mt-1 text-xs text-neutral-500">{t('photoHint')}</p>
        {uploading ? <p className="mt-1 text-xs text-neutral-500">{tCommon('saving')}</p> : null}
        {uploadError ? <ServerError messageKey={uploadError} /> : null}
      </div>

      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}

      <div className="flex items-center gap-3">
        <SubmitButton label={tCommon('save')} pendingLabel={tCommon('saving')} />
      </div>
    </form>
  );
}
