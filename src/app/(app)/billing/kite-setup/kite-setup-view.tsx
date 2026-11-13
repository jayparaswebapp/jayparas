'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { ServerError, SubmitButton } from '@/components/form-status';
import type { ActionResult } from '@/lib/rpc/action-result';
import {
  deleteKiteSetupItemAction,
  saveKiteCompanyAction,
  saveProductGroupAction,
} from './actions';

export interface CompanyRow {
  id: string;
  name: string;
  is_active: boolean;
  group_count: number;
}

export interface GroupRow {
  id: string;
  name: string;
  company_id: string;
  is_active: boolean;
  hsn_code?: string;
  gst_pct?: number;
  sku_count: number;
}

export function KiteSetupView({
  companies,
  groups,
}: {
  companies: CompanyRow[];
  groups: GroupRow[];
}) {
  const t = useTranslations('billing.kiteSetup');
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-8">
      {/* ---------------- Companies ---------------- */}
      <section>
        <h2 className="text-lg font-semibold text-neutral-900">{t('companiesTitle')}</h2>
        <p className="mb-3 text-sm text-neutral-600">{t('companiesHint')}</p>

        <AddCompanyForm />

        <ul className="mt-3 divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
          {companies.map((c) => (
            <CompanyItem key={c.id} row={c} />
          ))}
          {companies.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-neutral-500">{t('noCompanies')}</li>
          ) : null}
        </ul>
      </section>

      {/* ---------------- Product groups ---------------- */}
      <section>
        <h2 className="text-lg font-semibold text-neutral-900">{t('groupsTitle')}</h2>
        <p className="mb-3 text-sm text-neutral-600">{t('groupsHint')}</p>

        {companies.length === 0 ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t('addCompanyFirst')}
          </p>
        ) : (
          <AddGroupForm companies={companies} />
        )}

        <ul className="mt-3 divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
          {groups.map((g) => (
            <GroupItem
              key={g.id}
              row={g}
              companies={companies}
              companyName={companyName.get(g.company_id) ?? '—'}
            />
          ))}
          {groups.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-neutral-500">{t('noGroups')}</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function AddCompanyForm() {
  const t = useTranslations('billing.kiteSetup');
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    saveKiteCompanyAction,
    null,
  );
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="is_active" value="on" />
      <div className="flex gap-2">
        <input
          name="name"
          required
          placeholder={t('companyNamePlaceholder')}
          className="input-base flex-1"
        />
        <SubmitButton label={t('addButton')} className="btn-primary !w-auto px-4" />
      </div>
      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}
    </form>
  );
}

function CompanyItem({ row }: { row: CompanyRow }) {
  const t = useTranslations('billing.kiteSetup');
  const tCommon = useTranslations('common.actions');
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    saveKiteCompanyAction,
    null,
  );
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  if (!editing) {
    return (
      <li className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-neutral-900">{row.name}</span>
            {!row.is_active ? <InactiveBadge /> : null}
          </div>
          <div className="text-xs text-neutral-500">
            {t('groupsInCompany', { count: row.group_count })}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="btn-ghost border border-neutral-300"
        >
          {tCommon('edit')}
        </button>
      </li>
    );
  }

  return (
    <li className="space-y-2 bg-neutral-50 px-4 py-3">
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="id" value={row.id} />
        <input name="name" required defaultValue={row.name} className="input-base" />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={row.is_active}
            className="h-5 w-5"
          />
          {t('activeLabel')}
        </label>
        {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}
        <div className="flex items-center gap-2">
          <SubmitButton
            label={tCommon('save')}
            pendingLabel={tCommon('saving')}
            className="btn-primary !w-auto px-4"
          />
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="btn-ghost border border-neutral-300"
          >
            {tCommon('cancel')}
          </button>
        </div>
      </form>
      <DeleteButton id={row.id} kind="company" />
    </li>
  );
}

/* ------------------------------------------------------------------ */

function CompanySelect({
  companies,
  defaultValue,
}: {
  companies: CompanyRow[];
  defaultValue?: string;
}) {
  const t = useTranslations('billing.kiteSetup');
  return (
    <select name="company_id" required defaultValue={defaultValue ?? ''} className="input-base">
      <option value="" disabled>
        {t('companySelectPlaceholder')}
      </option>
      {companies.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
          {!c.is_active ? ` (${t('inactive')})` : ''}
        </option>
      ))}
    </select>
  );
}

/** Default HSN + GST % for the group; auto-filled onto kite bill lines. */
function HsnGstFields({ hsn, gst }: { hsn?: string; gst?: number }) {
  const t = useTranslations('billing.kiteSetup');
  return (
    <div>
      <div className="flex gap-2">
        <input
          name="hsn_code"
          defaultValue={hsn ?? ''}
          maxLength={10}
          placeholder={t('hsnPlaceholder')}
          aria-label={t('hsnLabel')}
          className="input-base flex-1 font-mono"
        />
        <div className="flex items-center gap-1">
          <input
            name="gst_pct"
            type="number"
            inputMode="decimal"
            min={0}
            max={28}
            step="0.01"
            defaultValue={gst ? String(gst) : ''}
            placeholder={t('gstPlaceholder')}
            aria-label={t('gstLabel')}
            className="input-base !w-24 text-right"
          />
          <span className="text-sm text-neutral-600">%</span>
        </div>
      </div>
      <p className="mt-1 text-xs text-neutral-500">{t('hsnGstHint')}</p>
    </div>
  );
}

function AddGroupForm({ companies }: { companies: CompanyRow[] }) {
  const t = useTranslations('billing.kiteSetup');
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    saveProductGroupAction,
    null,
  );
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="is_active" value="on" />
      <input name="name" required placeholder={t('groupNamePlaceholder')} className="input-base" />
      <HsnGstFields />
      <div className="flex gap-2">
        <div className="flex-1">
          <CompanySelect companies={companies.filter((c) => c.is_active)} />
        </div>
        <SubmitButton label={t('addButton')} className="btn-primary !w-auto px-4" />
      </div>
      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}
    </form>
  );
}

function GroupItem({
  row,
  companies,
  companyName,
}: {
  row: GroupRow;
  companies: CompanyRow[];
  companyName: string;
}) {
  const t = useTranslations('billing.kiteSetup');
  const tCommon = useTranslations('common.actions');
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    saveProductGroupAction,
    null,
  );
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  if (!editing) {
    return (
      <li className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-neutral-900">{row.name}</span>
            {!row.is_active ? <InactiveBadge /> : null}
          </div>
          <div className="text-sm text-neutral-700">{companyName}</div>
          <div className="text-xs text-neutral-500">
            {t('productsInGroup', { count: row.sku_count })}
            {' · '}
            {row.hsn_code ? `HSN ${row.hsn_code}` : t('noHsn')}
            {' · '}
            {t('gstShort', { pct: row.gst_pct ?? 0 })}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="btn-ghost border border-neutral-300"
        >
          {tCommon('edit')}
        </button>
      </li>
    );
  }

  return (
    <li className="space-y-2 bg-neutral-50 px-4 py-3">
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="id" value={row.id} />
        <input name="name" required defaultValue={row.name} className="input-base" />
        <CompanySelect companies={companies} defaultValue={row.company_id} />
        <HsnGstFields hsn={row.hsn_code} gst={row.gst_pct} />
        {row.sku_count > 0 ? (
          <p className="text-xs text-amber-700">{t('changeCompanyWarning')}</p>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={row.is_active}
            className="h-5 w-5"
          />
          {t('activeLabel')}
        </label>
        {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}
        <div className="flex items-center gap-2">
          <SubmitButton
            label={tCommon('save')}
            pendingLabel={tCommon('saving')}
            className="btn-primary !w-auto px-4"
          />
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="btn-ghost border border-neutral-300"
          >
            {tCommon('cancel')}
          </button>
        </div>
      </form>
      <DeleteButton id={row.id} kind="group" />
    </li>
  );
}

/* ------------------------------------------------------------------ */

function InactiveBadge() {
  const t = useTranslations('billing.kiteSetup');
  return (
    <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-700">
      {t('inactive')}
    </span>
  );
}

function DeleteButton({ id, kind }: { id: string; kind: 'company' | 'group' }) {
  const tCommon = useTranslations('common');
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    deleteKiteSetupItemAction,
    null,
  );

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="btn-ghost border border-red-300 text-sm text-red-700"
      >
        {tCommon('actions.delete')}
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-2 rounded-md border border-red-200 bg-white p-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="kind" value={kind} />
      <p className="text-sm text-neutral-700">{tCommon('confirm.softDeleteBody')}</p>
      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}
      <div className="flex items-center gap-2">
        <SubmitButton
          label={tCommon('actions.delete')}
          pendingLabel={tCommon('actions.saving')}
          className="btn-primary !w-auto bg-red-700 px-4"
        />
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="btn-ghost border border-neutral-300"
        >
          {tCommon('actions.cancel')}
        </button>
      </div>
    </form>
  );
}
