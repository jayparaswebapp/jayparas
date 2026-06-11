'use client';

import Link from 'next/link';
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
import { QrCode } from '@/components/qr-code';
import { generateSkuCode } from '@/lib/skus/code';
import { createSkuAction, type CreateSkuResult } from './actions';

type PackSize = 1 | 3 | 4 | 6 | 12;
type RateUnit = 'pack' | 'piece';

/**
 * Pack-size tiles on /skus/new. Each tile is a (pack_size, rate_unit) pair so
 * the user-visible difference between "1 Doz" (rate × 1 per pack) and "12 pcs"
 * (rate × 12 per pack) is captured at create time and never has to be
 * re-derived. See sku_code → packCodeSuffix() in lib/skus/code.ts for the
 * encoded suffix per tile.
 */
interface PackTile {
  label: string;
  pack_size: PackSize;
  rate_unit: RateUnit;
}

const PACK_TILES: PackTile[] = [
  { label: '1', pack_size: 1, rate_unit: 'piece' },
  { label: '3', pack_size: 3, rate_unit: 'piece' },
  { label: '4', pack_size: 4, rate_unit: 'piece' },
  { label: '6', pack_size: 6, rate_unit: 'piece' },
  { label: '1 Doz', pack_size: 12, rate_unit: 'pack' },
  { label: '12 pcs', pack_size: 12, rate_unit: 'piece' },
];

function tileKey(t: PackTile): string {
  return `${t.pack_size}-${t.rate_unit}`;
}

export function SkuCreateForm() {
  const t = useTranslations('skus.form');
  const tErrors = useTranslations('skus.errors');
  const tCommon = useTranslations('common.actions');
  const [state, formAction] = useFormState<CreateSkuResult | null, FormData>(createSkuAction, null);

  const [packTileKey, setPackTileKey] = useState<string | null>(null);
  const [designName, setDesignName] = useState('');
  const [price, setPrice] = useState('');
  const [discountPct, setDiscountPct] = useState('0');
  const [isDiscountable, setIsDiscountable] = useState(false);
  const [photoPath, setPhotoPath] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [, startTransition] = useTransition();

  const selectedTile = packTileKey
    ? (PACK_TILES.find((tt) => tileKey(tt) === packTileKey) ?? null)
    : null;

  let previewCode = '';
  if (designName && selectedTile) {
    previewCode = generateSkuCode({
      pack_type: 'single',
      design_name: designName,
      pack_size: selectedTile.pack_size,
      rate_unit: selectedTile.rate_unit,
    });
  }

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
    <form action={handleAction} onSubmit={onSubmit} className="space-y-5">
      {/*
       * Hidden fields submitted to the server action. pack_type is always
       * 'single' (Mix removed from the UI; existing mix SKUs in the DB
       * remain functional via the unchanged legacy path). pack_size and
       * rate_unit are derived from the picked tile.
       */}
      <input type="hidden" name="pack_type" value="single" />
      {selectedTile ? (
        <>
          <input type="hidden" name="pack_size" value={String(selectedTile.pack_size)} />
          <input type="hidden" name="rate_unit" value={selectedTile.rate_unit} />
        </>
      ) : null}
      <input type="hidden" name="photo_path" value={photoPath} />

      <div>
        <label className="label-base">{t('packTypeLabel')}</label>
        <div className="grid grid-cols-4 gap-2">
          {PACK_TILES.map((tile) => {
            const key = tileKey(tile);
            const selected = packTileKey === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setPackTileKey(key)}
                className={[
                  'flex h-16 items-center justify-center rounded-lg border text-xl font-semibold',
                  selected
                    ? 'border-brand-600 bg-brand-100 text-brand-900'
                    : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400',
                ].join(' ')}
              >
                {tile.label}
              </button>
            );
          })}
          {/*
           * Placeholder tile reserved for a future pack option (e.g. half
           * dozen, custom size). Disabled and visually muted so staff know
           * it's not pickable yet but the slot is held.
           */}
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="flex h-16 cursor-not-allowed items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50 text-neutral-400"
          >
            ＋
          </button>
        </div>
        <p className="mt-1 text-xs text-neutral-500">{t('packTypeHint')}</p>
      </div>

      <div>
        <label htmlFor="design_name" className="label-base">
          {t('designNameLabel')}
        </label>
        <input
          id="design_name"
          name="design_name"
          value={designName}
          onChange={(e) => setDesignName(e.target.value)}
          required
          placeholder={t('designNamePlaceholder')}
          className="input-base"
        />
      </div>

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
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
            inputMode="decimal"
            placeholder={t('pricePlaceholder')}
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
              className="h-24 w-24 rounded-md object-cover ring-1 ring-neutral-200"
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

      <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
          {t('previewLabel')}
        </div>
        {previewCode ? (
          <div className="flex flex-col items-start gap-2">
            <code className="rounded bg-white px-2 py-1 font-mono text-base text-neutral-900 ring-1 ring-neutral-200">
              {previewCode}
            </code>
            <QrCode value={previewCode} size="80px" />
          </div>
        ) : (
          <p className="text-sm text-neutral-500">{t('previewEmpty')}</p>
        )}
      </div>

      {state && state.ok === false ? (
        <div className="space-y-2">
          <ServerError messageKey={state.messageKey} />
          {state.duplicate ? (
            <Link
              href={`/skus/${state.duplicate.id}`}
              className="inline-flex items-center text-sm font-medium text-brand-700 underline"
            >
              {tErrors('duplicateOpenLink')}: {state.duplicate.sku_code}
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <SubmitButton label={tCommon('save')} pendingLabel={tCommon('saving')} />
        <Link href="/skus" className="btn-ghost border border-neutral-300">
          {tCommon('cancel')}
        </Link>
      </div>
    </form>
  );
}
