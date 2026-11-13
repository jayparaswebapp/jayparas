'use client';

import Link from 'next/link';
import { useFormState } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ServerError } from '@/components/form-status';
import { formatRupees } from '@/lib/format/locale-shared';
import type { Locale } from '@/lib/i18n/config';
import type { ActionResult } from '@/lib/rpc/action-result';
import { saveInvoiceDraftAction } from './actions';
import { NewCustomerShortcut } from '../customers/new-customer-shortcut';
import { ScanButton } from './scan-button';
import { EMPTY_KITE_PRICING, type KitePricing } from '@/lib/billing/kite-pricing';
import { useInvoiceDraft } from './use-invoice-draft';

export type BusinessLine = 'rakhi' | 'kite';

export interface InvoiceLineValues {
  sku_id: string | null;
  /**
   * Snapshot of the SKU at line-pick time. `is_discountable` is frozen here
   * (not re-read from the SKU later) so changing a SKU's discountable flag
   * doesn't re-shuffle historical invoices that already grouped lines into
   * sections at the time of print.
   */
  sku_snapshot: {
    sku_code: string;
    design_name: string;
    pack_size: number;
    is_discountable?: boolean;
  } | null;
  description: string;
  hsn_code: string;
  qty: string;
  uom: string;
  rate: string;
  discount_pct: string;
  gst_pct: string;
}

export interface InvoiceFormValues {
  id?: string;
  business_line: BusinessLine;
  customer_id: string | null;
  invoice_date: string;
  place_of_supply: string;
  notes: string;
  terms: string;
  packing_charges: string;
  delivery_charges: string;
  lines: InvoiceLineValues[];
}

export interface CustomerOption {
  id: string;
  label: string;
  city: string | null;
  state: string | null;
}

export interface SkuOption {
  id: string;
  sku_code: string;
  /** Short 4-digit id encoded in the Code128 barcode. Null for SKUs created
   *  before the short-code migration. */
  short_code?: number | null;
  design_name: string;
  pack_size: number;
  price: number;
  discount_pct: number;
  is_discountable: boolean;
  /**
   * 'pack' = the SKU's stored rate is for the whole pack (e.g. ₹240/dozen);
   * 'piece' = the stored rate is per individual piece (e.g. ₹20/piece × 12).
   * Drives the qty / uom defaults when this SKU is picked on an invoice line.
   */
  rate_unit: 'pack' | 'piece';
  /** Missing = rakhi (older callers). */
  business_line?: BusinessLine;
  /** Kite only: product group → company (discount), default HSN + GST %. */
  product_group_id?: string | null;
}

const EMPTY_LINE: InvoiceLineValues = {
  sku_id: null,
  sku_snapshot: null,
  description: '',
  hsn_code: '',
  qty: '1',
  uom: 'Pcs',
  rate: '0',
  discount_pct: '0',
  gst_pct: '0',
};

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Overrides for a kite line: discount from the party's company-wise %, and
 * HSN / GST % from the product group's defaults.
 */
interface LinePricing {
  discount_pct: number;
  hsn_code: string;
  gst_pct: number;
}

function lineFromSku(sku: SkuOption, pricing?: LinePricing): InvoiceLineValues {
  // rate_unit = 'pack' (e.g. "1 Doz" tile): the saved price IS the per-pack
  // rate, so default qty = 1 pack and uom = the pack's friendly unit.
  // rate_unit = 'piece' (e.g. "12 pcs" tile, or any 1/3/4/6 pack): the saved
  // price is per piece, so default qty = pack_size pieces, uom = Pcs.
  const isPerPack = sku.rate_unit === 'pack';
  return {
    sku_id: sku.id,
    sku_snapshot: {
      sku_code: sku.sku_code,
      design_name: sku.design_name,
      pack_size: sku.pack_size,
      is_discountable: sku.is_discountable,
    },
    // Just the design name; the SKU code adds clutter on screen and the
    // printed invoice — the QR/label flow keeps the code, the bill doesn't
    // need to.
    description: sku.design_name,
    hsn_code: pricing?.hsn_code ?? '',
    qty: isPerPack ? '1' : String(sku.pack_size),
    uom: isPerPack ? (sku.pack_size === 12 ? 'Doz' : 'Pack') : 'Pcs',
    rate: String(sku.price),
    // Rakhi: the SKU's default discount. Kite: the party's % for the SKU's
    // company. Staff can override per line either way.
    discount_pct: String(pricing ? pricing.discount_pct : (sku.discount_pct ?? 0)),
    gst_pct: String(pricing?.gst_pct ?? 0),
  };
}

export function InvoiceForm({
  initial,
  customers,
  skus,
  sellerState,
  locale,
  kitePricing = EMPTY_KITE_PRICING,
}: {
  initial: InvoiceFormValues;
  customers: CustomerOption[];
  skus: SkuOption[];
  sellerState: string | null;
  locale: Locale;
  kitePricing?: KitePricing;
}) {
  const t = useTranslations('billing.invoices');
  const tForm = useTranslations('billing.invoices.form');
  const [state, formAction] = useFormState<ActionResult | null, FormData>(
    saveInvoiceDraftAction,
    null,
  );

  const [businessLine, setBusinessLine] = useState<BusinessLine>(initial.business_line);
  const [customerId, setCustomerId] = useState<string>(initial.customer_id ?? '');
  const [placeOfSupply, setPlaceOfSupply] = useState<string>(initial.place_of_supply ?? '');
  const [invoiceDate, setInvoiceDate] = useState<string>(initial.invoice_date);
  const [notes, setNotes] = useState<string>(initial.notes ?? '');
  const [terms, setTerms] = useState<string>(initial.terms ?? '');
  const [packingCharges, setPackingCharges] = useState<string>(initial.packing_charges ?? '0');
  const [deliveryCharges, setDeliveryCharges] = useState<string>(initial.delivery_charges ?? '0');
  const [lines, setLines] = useState<InvoiceLineValues[]>(
    initial.lines.length ? initial.lines : [{ ...EMPTY_LINE }],
  );

  const [scanValue, setScanValue] = useState<string>('');
  const [scanError, setScanError] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const linesContainerRef = useRef<HTMLDivElement | null>(null);
  // Track line count across renders so we can distinguish an "add" from a
  // "remove" — only additions should auto-scroll to the bottom, otherwise a
  // delete of the last row would fight the user's cursor position.
  const previousLineCountRef = useRef<number>(lines.length);

  // Auto-scroll the line-items container to the bottom whenever the count
  // grows so the newly-added row is visible without the user reaching for
  // the scrollbar. Uses useLayoutEffect so the scroll happens synchronously
  // after the new row's layout but before paint — no flicker.
  useLayoutEffect(() => {
    const box = linesContainerRef.current;
    if (box && lines.length > previousLineCountRef.current) {
      box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
    }
    previousLineCountRef.current = lines.length;
  }, [lines.length]);

  const skuByCode = useMemo(() => {
    const m = new Map<string, SkuOption>();
    for (const s of skus) m.set(s.sku_code.toUpperCase(), s);
    return m;
  }, [skus]);

  /**
   * New Code128 labels encode a 4-digit short_code; older labels (and the QR
   * labels, and anything typed by hand) carry the full text sku_code. Both
   * must keep working — old stickers are already on stock and won't be
   * reprinted — so scans are resolved against whichever map matches.
   */
  const skuByShortCode = useMemo(() => {
    const m = new Map<string, SkuOption>();
    for (const s of skus) {
      if (typeof s.short_code === 'number') {
        m.set(String(s.short_code).padStart(4, '0'), s);
      }
    }
    return m;
  }, [skus]);

  const resolveScan = useCallback(
    (raw: string): SkuOption | undefined => {
      const code = raw.trim().toUpperCase();
      if (!code) return undefined;
      // All-digit payload => new short-code label. Text => legacy sku_code.
      if (/^\d{1,4}$/.test(code)) {
        const hit = skuByShortCode.get(code.padStart(4, '0'));
        if (hit) return hit;
      }
      return skuByCode.get(code);
    },
    [skuByCode, skuByShortCode],
  );

  const skuById = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const lineOf = (s: SkuOption): BusinessLine => s.business_line ?? 'rakhi';

  /** Products shown in the search list / item dropdown: this bill type only. */
  const lineSkus = useMemo(
    () => skus.filter((s) => (s.business_line ?? 'rakhi') === businessLine),
    [skus, businessLine],
  );

  /** Kite pricing for one SKU and party; undefined for rakhi SKUs. */
  function kitePricingFor(sku: SkuOption, custId: string): LinePricing | undefined {
    if (lineOf(sku) !== 'kite') return undefined;
    const group = sku.product_group_id ? kitePricing.groups[sku.product_group_id] : undefined;
    const pct = group ? (kitePricing.discounts[custId]?.[group.company_id] ?? 0) : 0;
    return { discount_pct: pct, hsn_code: group?.hsn_code ?? '', gst_pct: group?.gst_pct ?? 0 };
  }

  function groupNameForLine(l: InvoiceLineValues): string | null {
    const sku = l.sku_id ? skuById.get(l.sku_id) : undefined;
    if (!sku?.product_group_id) return null;
    return kitePricing.groups[sku.product_group_id]?.name ?? null;
  }

  /**
   * Switching Rakhi ↔ Kite: lines of the other type would be wrong on this
   * bill, so ask, then drop them.
   */
  function changeBusinessLine(next: BusinessLine) {
    if (next === businessLine) return;
    const mismatched = lines.filter((l) => {
      const sku = l.sku_id ? skuById.get(l.sku_id) : undefined;
      return sku ? lineOf(sku) !== next : false;
    });
    if (mismatched.length > 0) {
      if (!window.confirm(tForm('switchLineConfirm', { count: mismatched.length }))) return;
      setLines((curr) => {
        const kept = curr.filter((l) => !mismatched.includes(l));
        return kept.length ? kept : [{ ...EMPTY_LINE }];
      });
    }
    setBusinessLine(next);
  }

  /** Rejects a SKU of the other bill type with a clear message. */
  function checkLine(sku: SkuOption): boolean {
    if (lineOf(sku) === businessLine) return true;
    setScanError(lineOf(sku) === 'kite' ? tForm('scanIsKiteProduct') : tForm('scanIsRakhiProduct'));
    return false;
  }

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) ?? null,
    [customers, customerId],
  );

  function onCustomerChange(id: string) {
    setCustomerId(id);
    if (id) {
      const c = customers.find((x) => x.id === id);
      if (c && c.state && !placeOfSupply) setPlaceOfSupply(c.state);
    }
    // Kite: re-price every kite line with the NEW party's company-wise %.
    if (businessLine === 'kite') {
      setLines((curr) =>
        curr.map((l) => {
          const sku = l.sku_id ? skuById.get(l.sku_id) : undefined;
          const pricing = sku ? kitePricingFor(sku, id) : undefined;
          return pricing ? { ...l, discount_pct: String(pricing.discount_pct) } : l;
        }),
      );
    }
  }

  function updateLine(idx: number, patch: Partial<InvoiceLineValues>) {
    setLines((curr) => curr.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addBlankLine() {
    setLines((curr) => [...curr, { ...EMPTY_LINE }]);
  }

  function addOrIncrementSku(sku: SkuOption) {
    // One scan / one "add same SKU" = one more pack. With rate_unit 'pack'
    // (1 Doz tile) qty is in packs/dozens → increment by 1. With rate_unit
    // 'piece' (12 pcs / 6 / 4 / 3 / 1) qty is in pieces → increment by
    // pack_size (= pieces in one pack). Without this branch a second scan
    // of a "1 Doz" SKU would jump qty 1 → 13 and the total to rate × 13.
    const qtyPerPack = sku.rate_unit === 'pack' ? 1 : sku.pack_size;
    setLines((curr) => {
      const existingIdx = curr.findIndex((l) => l.sku_id === sku.id);
      if (existingIdx >= 0) {
        return curr.map((l, i) =>
          i === existingIdx ? { ...l, qty: String(num(l.qty) + qtyPerPack) } : l,
        );
      }
      const first = curr[0];
      const isEmptyFirst =
        curr.length === 1 && first && first.sku_id === null && !first.description;
      const fresh = lineFromSku(sku, kitePricingFor(sku, customerId));
      return isEmptyFirst ? [fresh] : [...curr, fresh];
    });
  }

  function pickSkuForLine(idx: number, skuId: string) {
    if (!skuId) {
      updateLine(idx, { sku_id: null, sku_snapshot: null });
      return;
    }
    const s = skuById.get(skuId);
    if (!s) return;
    const pricing = kitePricingFor(s, customerId);
    const fresh = lineFromSku(s, pricing);
    // Keep a hand-typed HSN unless the product group supplies one.
    setLines((curr) =>
      curr.map((l, i) => (i === idx ? { ...fresh, hsn_code: pricing?.hsn_code || l.hsn_code } : l)),
    );
  }

  function removeLine(idx: number) {
    setLines((curr) => (curr.length <= 1 ? curr : curr.filter((_, i) => i !== idx)));
  }

  function handleScan() {
    const code = scanValue.trim().toUpperCase();
    if (!code) return;
    const sku = resolveScan(code);
    if (!sku) {
      setScanError(`SKU ${code} not found`);
      return;
    }
    if (!checkLine(sku)) return;
    addOrIncrementSku(sku);
    setScanError(null);
    setScanValue('');
    scanInputRef.current?.focus();
  }

  const intraState = useMemo(() => {
    if (!sellerState || !placeOfSupply) return null;
    return sellerState.trim().toLowerCase() === placeOfSupply.trim().toLowerCase();
  }, [sellerState, placeOfSupply]);

  const showGst = businessLine === 'kite';

  const totals = useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    for (const l of lines) {
      const qty = num(l.qty);
      const rate = num(l.rate);
      const disc = num(l.discount_pct);
      const
