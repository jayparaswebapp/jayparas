'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isAvailable, listPrinters } from '@/lib/print/qz';
import { getPrinter, setPrinter, type PrinterRole } from '@/lib/print/printer-settings';

/**
 * QZ Tray printer binding UI. Everything runs client-side: settings are
 * per-device (localStorage) and the printer list itself comes from the
 * QZ Tray service on this same device, not the server.
 *
 * Flow:
 *   1. On mount, probe QZ Tray. If unreachable → show install instructions
 *      and disable the pickers.
 *   2. If reachable → fetch printer list and hydrate the two selects with
 *      whatever's currently saved in localStorage.
 *   3. Each pick fires an immediate localStorage write — no explicit Save
 *      button, so operators don't leave the page thinking they hit save
 *      when they didn't.
 */
export function PrintSettingsForm() {
  const t = useTranslations('admin.printSettings');
  const [status, setStatus] = useState<'probing' | 'ok' | 'unreachable' | 'error'>('probing');
  const [printers, setPrinters] = useState<string[]>([]);
  const [labelPrinter, setLabelPrinterState] = useState<string>('');
  const [invoicePrinter, setInvoicePrinterState] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ok = await isAvailable();
        if (cancelled) return;
        if (!ok) {
          setStatus('unreachable');
          setLabelPrinterState(getPrinter('label') ?? '');
          setInvoicePrinterState(getPrinter('invoice') ?? '');
          return;
        }
        const list = await listPrinters();
        if (cancelled) return;
        setPrinters(list);
        setLabelPrinterState(getPrinter('label') ?? '');
        setInvoicePrinterState(getPrinter('invoice') ?? '');
        setStatus('ok');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function onPick(role: PrinterRole, name: string) {
    setPrinter(role, name || null);
    if (role === 'label') setLabelPrinterState(name);
    else setInvoicePrinterState(name);
  }

  return (
    <div className="space-y-4">
      <StatusPill status={status} />

      {status === 'unreachable' ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="mb-1 font-semibold">{t('installTitle')}</div>
          <p className="mb-2">{t('installHint')}</p>
          <ol className="ml-4 list-decimal space-y-1">
            <li>{t('installStep1')}</li>
            <li>{t('installStep2')}</li>
            <li>{t('installStep3')}</li>
          </ol>
        </div>
      ) : null}

      <PrinterRow
        role="label"
        label={t('labelPrinterLabel')}
        hint={t('labelPrinterHint')}
        value={labelPrinter}
        printers={printers}
        disabled={status !== 'ok'}
        placeholder={t('pickerPlaceholder')}
        onChange={(v) => onPick('label', v)}
      />

      <PrinterRow
        role="invoice"
        label={t('invoicePrinterLabel')}
        hint={t('invoicePrinterHint')}
        value={invoicePrinter}
        printers={printers}
        disabled={status !== 'ok'}
        placeholder={t('pickerPlaceholder')}
        onChange={(v) => onPick('invoice', v)}
      />

      <p className="text-xs text-neutral-500">{t('savedHint')}</p>
    </div>
  );
}

function StatusPill({ status }: { status: 'probing' | 'ok' | 'unreachable' | 'error' }) {
  const t = useTranslations('admin.printSettings.status');
  if (status === 'probing') {
    return (
      <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
        {t('probing')}
      </div>
    );
  }
  if (status === 'ok') {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        {t('ok')}
      </div>
    );
  }
  if (status === 'unreachable') {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        {t('unreachable')}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
      {t('error')}
    </div>
  );
}

function PrinterRow({
  role,
  label,
  hint,
  value,
  printers,
  disabled,
  placeholder,
  onChange,
}: {
  role: PrinterRole;
  label: string;
  hint: string;
  value: string;
  printers: string[];
  disabled: boolean;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  const inputId = `printer_${role}`;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <label htmlFor={inputId} className="label-base">
        {label}
      </label>
      <select
        id={inputId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="input-base disabled:cursor-not-allowed disabled:bg-neutral-100"
      >
        <option value="">{placeholder}</option>
        {/* If a printer was saved but is not currently in the list (device
         * offline, driver removed) we still keep the option visible so the
         * user knows what was configured and can either re-connect it or
         * pick a replacement. */}
        {value && !printers.includes(value) ? (
          <option value={value}>{value} (offline)</option>
        ) : null}
        {printers.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-neutral-500">{hint}</p>
    </div>
  );
}
