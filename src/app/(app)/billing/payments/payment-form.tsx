'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { ServerError } from '@/components/form-status';
import { formatRupees } from '@/lib/format/locale-shared';
import type { Locale } from '@/lib/i18n/config';
import type { ActionResult } from '@/lib/rpc/action-result';
import { createPaymentAction } from './actions';

export type PaymentMethod = 'cash' | 'upi' | 'bank_transfer';

export interface CustomerOption {
  id: string;
  label: string;
}

export interface InvoiceBalanceOption {
  invoice_id: string;
  invoice_number: string | null;
  customer_id: string;
  invoice_date: string;
  grand_total: number;
  amount_paid: number;
  balance_due: number;
}

interface AllocationDraft {
  invoice_id: string;
  selected: boolean;
  amount: string;
}

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function PaymentForm({
  customers,
  balances,
  locale,
}: {
  customers: CustomerOption[];
  balances: InvoiceBalanceOption[];
  locale: Locale;
}) {
  const t = useTranslations('billing.payments');
  const tForm = useTranslations('billing.payments.form');
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    createPaymentAction,
    null,
  );

  const [customerId, setCustomerId] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amount, setAmount] = useState<string>('0');
  const [reference, setReference] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [allocations, setAllocations] = useState<Record<string, AllocationDraft>>({});

  const balancesByCustomer = useMemo(() => {
    const map = new Map<string, InvoiceBalanceOption[]>();
    for (const b of balances) {
      const arr = map.get(b.customer_id) ?? [];
      arr.push(b);
      map.set(b.customer_id, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) =>
        a.invoice_date === b.invoice_date
          ? (a.invoice_number ?? '').localeCompare(b.invoice_number ?? '')
          : a.invoice_date.localeCompare(b.invoice_date),
      );
    }
    return map;
  }, [balances]);

  const customerInvoices = useMemo(
    () => (customerId ? (balancesByCustomer.get(customerId) ?? []) : []),
    [customerId, balancesByCustomer],
  );

  function onCustomerChange(id: string) {
    setCustomerId(id);
    // Reset allocations when switching customers.
    setAllocations({});
  }

  function toggleInvoice(inv: InvoiceBalanceOption) {
    setAllocations((curr) => {
      const next = { ...curr };
      const existing = next[inv.invoice_id];
      if (existing && existing.selected) {
        next[inv.invoice_id] = { ...existing, selected: false };
      } else {
        // Default to settling the full remaining balance for this invoice.
        next[inv.invoice_id] = {
          invoice_id: inv.invoice_id,
          selected: true,
          amount: inv.balance_due.toFixed(2),
        };
      }
      return next;
    });
  }

  function setAllocationAmount(invoiceId: string, value: string) {
    setAllocations((curr) => ({
      ...curr,
      [invoiceId]: {
        invoice_id: invoiceId,
        selected: curr[invoiceId]?.selected ?? true,
        amount: value,
      },
    }));
  }

  // Auto-fill: when method/customer set + amount entered + no allocations,
  // fill oldest-first up to the entered amount.
  function autoAllocate() {
    const target = round2(num(amount));
    if (target <= 0) return;
    let remaining = target;
    const next: Record<string, AllocationDraft> = {};
    for (const inv of customerInvoices) {
      if (remaining <= 0) break;
      const take = round2(Math.min(remaining, inv.balance_due));
      if (take <= 0) continue;
      next[inv.invoice_id] = {
        invoice_id: inv.invoice_id,
        selected: true,
        amount: take.toFixed(2),
      };
      remaining = round2(remaining - take);
    }
    setAllocations(next);
  }

  const activeAllocations = useMemo(() => {
    return Object.values(allocations).filter((a) => a.selected && num(a.amount) > 0);
  }, [allocations]);

  const allocatedTotal = useMemo(() => {
    return round2(activeAllocations.reduce((acc, a) => acc + num(a.amount), 0));
  }, [activeAllocations]);

  const amountNum = num(amount);
  const diff = round2(allocatedTotal - amountNum);
  const matches = Math.abs(diff) <= 0.005 && amountNum > 0 && activeAllocations.length > 0;
  const needsRef = method === 'upi' || method === 'bank_transfer';

  const payload = useMemo(
    () =>
      JSON.stringify({
        header: {
          customer_id: customerId || undefined,
          payment_date: paymentDate,
          payment_method: method,
          amount: amountNum,
          reference_no: reference || undefined,
          notes: notes || undefined,
        },
        allocations: activeAllocations.map((a) => ({
          invoice_id: a.invoice_id,
          amount_applied: round2(num(a.amount)),
        })),
      }),
    [customerId, paymentDate, method, amountNum, reference, notes, activeAllocations],
  );

  const canSubmit =
    customerId.length > 0 && amountNum > 0 && matches && (!needsRef || reference.trim().length > 0);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="payload" value={payload} />

      {/* Header */}
      <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          {tForm('headerSection')}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="customer_id" className="label-base">
              {tForm('customerLabel')}
            </label>
            <select
              id="customer_id"
              value={customerId}
              onChange={(e) => onCustomerChange(e.target.value)}
              className="input-base"
              required
            >
              <option value="">{tForm('customerPickerPlaceholder')}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="payment_date" className="label-base">
              {tForm('paymentDateLabel')}
            </label>
            <input
              id="payment_date"
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              required
              className="input-base"
            />
          </div>

          <div>
            <label className="label-base">{tForm('methodLabel')}</label>
            <div className="flex flex-wrap items-center gap-2">
              {(['cash', 'upi', 'bank_transfer'] as PaymentMethod[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`btn-ghost border ${
                    method === m
                      ? 'border-brand-700 bg-brand-50 text-brand-900'
                      : 'border-neutral-300'
                  }`}
                >
                  {t(
                    m === 'cash' ? 'methodCash' : m === 'upi' ? 'methodUpi' : 'methodBankTransfer',
                  )}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="amount" className="label-base">
              {tForm('amountLabel')}
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-lg text-neutral-500">
                ₹
              </span>
              <input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                required
                className="input-base pl-8"
              />
            </div>
          </div>

          <div>
            <label htmlFor="reference_no" className="label-base">
              {tForm('referenceLabel')}{' '}
              {needsRef ? (
                <span className="text-red-700">*</span>
              ) : (
                <span className="text-xs text-neutral-500">({tForm('optional')})</span>
              )}
            </label>
            <input
              id="reference_no"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={
                method === 'upi'
                  ? tForm('referenceHintUpi')
                  : method === 'bank_transfer'
                    ? tForm('referenceHintBank')
                    : tForm('referenceHintCash')
              }
              className="input-base"
              required={needsRef}
            />
          </div>
        </div>
      </section>

      {/* Allocations */}
      <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
            {tForm('allocationsSection')}
          </h2>
          {customerId && customerInvoices.length > 0 ? (
            <button
              type="button"
              onClick={autoAllocate}
              className="btn-ghost border border-neutral-300 text-sm"
            >
              {tForm('autoAllocateButton')}
            </button>
          ) : null}
        </div>

        {!customerId ? (
          <p className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3 text-sm text-neutral-500">
            {tForm('pickCustomerFirst')}
          </p>
        ) : customerInvoices.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3 text-sm text-neutral-500">
            {tForm('noOutstandingInvoices')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="w-8 px-2 py-2"></th>
                  <th className="px-2 py-2 text-left">{tForm('invoiceColumn')}</th>
                  <th className="px-2 py-2 text-left">{tForm('dateColumn')}</th>
                  <th className="px-2 py-2 text-right">{tForm('grandTotalColumn')}</th>
                  <th className="px-2 py-2 text-right">{tForm('paidColumn')}</th>
                  <th className="px-2 py-2 text-right">{tForm('balanceColumn')}</th>
                  <th className="px-2 py-2 text-right">{tForm('applyColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {customerInvoices.map((inv) => {
                  const draft = allocations[inv.invoice_id];
                  const selected = draft?.selected ?? false;
                  const dateStr = new Intl.DateTimeFormat(locale === 'gu' ? 'gu-IN' : 'en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: '2-digit',
                  }).format(new Date(inv.invoice_date));
                  return (
                    <tr key={inv.invoice_id} className="border-t border-neutral-100">
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleInvoice(inv)}
                          className="h-4 w-4"
                        />
                      </td>
                      <td className="px-2 py-2 font-mono text-xs">{inv.invoice_number ?? '—'}</td>
                      <td className="px-2 py-2 text-xs text-neutral-600">{dateStr}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {Number(inv.grand_total).toFixed(2)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-neutral-600">
                        {Number(inv.amount_paid).toFixed(2)}
                      </td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">
                        {Number(inv.balance_due).toFixed(2)}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max={inv.balance_due}
                          disabled={!selected}
                          value={draft?.amount ?? '0'}
                          onChange={(e) => setAllocationAmount(inv.invoice_id, e.target.value)}
                          inputMode="decimal"
                          className="input-base !min-h-0 !py-1 !text-right !text-sm disabled:bg-neutral-100"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Live summary */}
        <div className="ml-auto max-w-sm rounded-md bg-neutral-50 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-neutral-600">{tForm('amountEnteredLabel')}</span>
            <span className="font-medium">{formatRupees(amountNum, locale)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-neutral-600">{tForm('allocatedLabel')}</span>
            <span className="font-medium">{formatRupees(allocatedTotal, locale)}</span>
          </div>
          {!matches && amountNum > 0 && activeAllocations.length > 0 ? (
            <div className="mt-1 flex items-center justify-between border-t border-neutral-200 pt-1">
              <span className="text-neutral-600">{tForm('differenceLabel')}</span>
              <span className={`font-semibold ${diff > 0 ? 'text-amber-700' : 'text-red-700'}`}>
                {diff > 0 ? '+ ' : '− '}
                {formatRupees(Math.abs(diff), locale)}
              </span>
            </div>
          ) : null}
          {matches ? (
            <div className="mt-1 border-t border-neutral-200 pt-1 text-xs text-emerald-700">
              {tForm('matchesAmount')}
            </div>
          ) : null}
        </div>
      </section>

      {/* Notes */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <label htmlFor="notes" className="label-base">
          {tForm('notesLabel')}
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="input-base resize-y"
        />
      </section>

      {state && state.ok === false ? <ServerError messageKey={state.messageKey} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="btn-primary !w-auto bg-brand-700 px-4 disabled:opacity-50"
        >
          {tForm('saveButton')}
        </button>
        <Link href="/billing/payments" className="btn-ghost border border-neutral-300">
          {tForm('cancelButton')}
        </Link>
      </div>
    </form>
  );
}
