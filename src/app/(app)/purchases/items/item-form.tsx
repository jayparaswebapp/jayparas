'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import { savePurchaseItemAction } from './actions';

export interface ItemFormValues {
  id?: string;
  item_code: string;
  name: string;
  name_gu: string | null;
  uom: string;
  hsn_code: string | null;
  default_rate: number;
  default_gst_pct: number;
  notes: string | null;
  is_active: boolean;
}

export function ItemForm({ initial }: { initial: ItemFormValues | null }) {
  const t = useTranslations('purchases.items.form');
  const tCommon = useTranslations('common.actions');
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    savePurchaseItemAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="item_code" className="label-base">
            {t('itemCodeLabel')}
          </label>
          <input
            id="item_code"
            name="item_code"
            defaultValue={initial?.item_code ?? ''}
            required
            placeholder={t('itemCodePlaceholder')}
            className="input-base font-mono uppercase"
            style={{ textTransform: 'uppercase' }}
          />
        </div>
        <div>
          <label htmlFor="uom" className="label-base">
            {t('uomLabel')}
          </label>
          <input id="uom" name="uom" defaultValue={initial?.uom ?? 'pcs'} className="input-base" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="label-base">
            {t('nameLabel')}
          </label>
          <input
            id="name"
            name="name"
            defaultValue={initial?.name ?? ''}
            required
            className="input-base"
          />
        </div>
        <div>
          <label htmlFor="name_gu" className="label-base">
            {t('nameGuLabel')}
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="hsn_code" className="label-base">
            {t('hsnLabel')}
          </label>
          <input
            id="hsn_code"
            name="hsn_code"
            defaultValue={initial?.hsn_code ?? ''}
            className="input-base font-mono"
          />
        </div>
        <div>
          <label htmlFor="default_rate" className="label-base">
            {t('defaultRateLabel')}
          </label>
          <input
            id="default_rate"
            name="default_rate"
            type="number"
            step="0.01"
            min="0"
            defaultValue={initial?.default_rate ?? 0}
            inputMode="decimal"
            className="input-base"
          />
        </div>
        <div>
          <label htmlFor="default_gst_pct" className="label-base">
            {t('defaultGstLabel')}
          </label>
          <input
            id="default_gst_pct"
            name="default_gst_pct"
            type="number"
            step="0.01"
            min="0"
            max="100"
            defaultValue={initial?.default_gst_pct ?? 0}
            inputMode="decimal"
            className="input-base"
          />
        </div>
      </div>

      <div>
        <label htmlFor="notes" className="label-base">
          {t('notesLabel')}
        </label>
        <textarea
          id="notes"
          name="notes"
          defaultValue={initial?.notes ?? ''}
          rows={2}
          className="input-base resize-y"
        />
      </div>

      {initial ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={initial.is_active}
            className="h-5 w-5"
          />
          {t('isActiveLabel')}
        </label>
      ) : (
        <input type="hidden" name="is_active" value="on" />
      )}

      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}

      <div className="flex items-center gap-3">
        <SubmitButton label={tCommon('save')} pendingLabel={tCommon('saving')} />
        <Link href="/purchases/items" className="btn-ghost border border-neutral-300">
          {tCommon('cancel')}
        </Link>
      </div>
    </form>
  );
}
