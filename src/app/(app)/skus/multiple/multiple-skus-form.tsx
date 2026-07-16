'use client';

import { useMemo, useState } from 'react';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { createMultipleSkusAction, type CreateMultipleResult } from './actions';

/**
 * Pack tile values mirror the single-create form on /skus/new. Each entry
 * pairs a UI label with the (pack_size, rate_unit) the SKU is saved with.
 * "1 Doz" and "12 pcs" both have pack_size=12 but a different rate_unit so
 * invoice line behaviour matches the picker's mental model — see
 * lib/skus/code.ts → packCodeSuffix().
 */
const PACK_TILES = [
  { key: '1', label: '1', pack_size: 1, rate_unit: 'piece' as const },
  { key: '3', label: '3', pack_size: 3, rate_unit: 'piece' as const },
  { key: '4', label: '4', pack_size: 4, rate_unit: 'piece' as const },
  { key: '6', label: '6', pack_size: 6, rate_unit: 'piece' as const },
  { key: 'doz', label: '1 Doz', pack_size: 12, rate_unit: 'pack' as const },
  { key: '12p', label: '12 pcs', pack_size: 12, rate_unit: 'piece' as const },
];

const CUSTOM_KEY = 'custom';

type PackKey = (typeof PACK_TILES)[number]['key'] | typeof CUSTOM_KEY;

const PACK_BY_KEY: Record<string, (typeof PACK_TILES)[number]> = Object.fromEntries(
  PACK_TILES.map((tile) => [tile.key, tile]),
);

interface RowValues {
  design_name: string;
  pack_key: PackKey;
  /** Only used when pack_key === 'custom'. Otherwise ignored. */
  custom_pack_size: string;
  /** Only used when pack_key === 'custom'. Otherwise ignored. */
  custom_rate_unit: 'pack' | 'piece';
  price: string;
  discount_pct: string;
  is_discountable: boolean;
  print_qty: string;
}

/**
 * Convert a paste cell into a boolean. Accepts "y/n", "yes/no", "1/0",
 * "true/false", "✓", or empty. Anything truthy => discountable, anything
 * else => not. Case-insensitive.
 */
function parseFlag(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === 'y' || v === 'yes' || v === '1' || v === 'true' || v === '✓';
}

/**
 * Map a paste cell to a pack-tile key + custom-size fallback. Accepts:
 *   plain digits: "1", "3", "4", "6" (map to preset tiles)
 *   friendly names: "1 Doz"/"doz"/"dozen" → doz, "12 pcs"/"12p" → 12p
 *   any other positive number ("20", "100", "500") → custom pack
 * Falls back to "1" if the cell is unparseable.
 */
function parsePackKey(raw: string | undefined): {
  key: PackKey;
  custom_pack_size: string;
  custom_rate_unit: 'pack' | 'piece';
} {
  const empty = { custom_pack_size: '', custom_rate_unit: 'piece' as const };
  if (!raw) return { key: '1', ...empty };
  const v = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (v === '1' || v === '3' || v === '4' || v === '6') return { key: v as PackKey, ...empty };
  if (v === 'doz' || v === '1doz' || v === 'dozen') return { key: 'doz', ...empty };
  if (v === '12p' || v === '12pcs' || v === '12pc' || v === '12') return { key: '12p', ...empty };
  // Anything else: try to parse a positive integer for the custom slot.
  // Rate unit defaults to 'piece' — the common bulk-pack case ("500 pcs at
  // ₹X per piece"). Paste flow can still opt into per-pack with the tiles.
  const asNum = Number.parseInt(v.replace(/[^\d]/g, ''), 10);
  if (Number.isFinite(asNum) && asNum >= 1 && asNum <= 9999) {
    return {
      key: CUSTOM_KEY,
      custom_pack_size: String(asNum),
      custom_rate_unit: 'piece',
    };
  }
  return { key: '1', ...empty };
}

function emptyRow(): RowValues {
  return {
    design_name: '',
    pack_key: '1',
    custom_pack_size: '',
    custom_rate_unit: 'piece',
    price: '0',
    discount_pct: '0',
    is_discountable: false,
    print_qty: '0',
  };
}

/**
 * Parses a TSV/CSV block copied from Excel/Sheets. We accept tabs OR commas
 * as the delimiter (Excel copies as tabs; some Sheets exports use commas) and
 * tolerate trailing whitespace + blank rows. Column order is now:
 * Design Name | Pack | Price | Discount % | Disc? | Print Qty
 */
function parsePastedRows(raw: string): RowValues[] {
  const out: RowValues[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cells = line.includes('\t') ? line.split('\t') : line.split(',');
    const cleaned = cells.map((c) => c.trim());
    if (cleaned.length < 3 || !cleaned[0]) continue;
    const packInfo = parsePackKey(cleaned[1]);
    out.push({
      design_name: cleaned[0] ?? '',
      pack_key: packInfo.key,
      custom_pack_size: packInfo.custom_pack_size,
      custom_rate_unit: packInfo.custom_rate_unit,
      price: cleaned[2] ?? '0',
      discount_pct: cleaned[3] ?? '0',
      is_discountable: parseFlag(cleaned[4]),
      print_qty: cleaned[5] ?? '0',
    });
  }
  return out;
}

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function MultipleSkusForm() {
  const t = useTranslations('skus.multiple');
  const tCommon = useTranslations('common');
  // Root translator so we can resolve any full dotted key like
  // `skus.errors.duplicate` that comes back from a server action's
  // messageKey — `t` above is scoped to `skus.multiple` and would 404 on
  // out-of-namespace keys.
  const tAny = useTranslations();
  const [rows, setRows] = useState<RowValues[]>([emptyRow()]);
  const [paste, setPaste] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [state, formAction] = useFormState<CreateMultipleResult | null, FormData>(
    createMultipleSkusAction,
    null,
  );

  const payload = useMemo(
    () =>
      JSON.stringify({
        rows: rows.map((r) => {
          let pack_size: number;
          let rate_unit: 'pack' | 'piece';
          if (r.pack_key === CUSTOM_KEY) {
            const parsed = Number.parseInt(r.custom_pack_size, 10);
            // Fall back to 1 when custom slot is blank so the row is still
            // structurally valid; the disabled-submit guard below prevents
            // shipping an incomplete row.
            pack_size = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
            rate_unit = r.custom_rate_unit;
          } else {
            const tile = PACK_BY_KEY[r.pack_key] ?? PACK_TILES[0]!;
            pack_size = tile.pack_size;
            rate_unit = tile.rate_unit;
          }
          return {
            design_name: r.design_name.trim(),
            pack_size,
            rate_unit,
            price: num(r.price),
            discount_pct: num(r.discount_pct),
            is_discountable: r.is_discountable,
            print_qty: num(r.print_qty),
          };
        }),
      }),
    [rows],
  );

  function updateRow(idx: number, patch: Partial<RowValues>) {
    setRows((curr) => curr.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((curr) => [...curr, emptyRow()]);
  }
  function removeRow(idx: number) {
    setRows((curr) => (curr.length <= 1 ? curr : curr.filter((_, i) => i !== idx)));
  }
  function clearAll() {
    setRows([emptyRow()]);
  }

  function handleParse() {
    const parsed = parsePastedRows(paste);
    if (parsed.length === 0) return;
    // If the current sheet is just one empty starter row, replace it; else
    // append, so accidentally pasting twice doesn't wipe what was typed.
    const first = rows[0];
    const isStarter = rows.length === 1 && !!first && !first.design_name.trim();
    setRows(isStarter ? parsed : [...rows, ...parsed]);
    setPaste('');
    setPasteOpen(false);
  }

  const totalLabels = rows.reduce((acc, r) => acc + Math.max(0, num(r.print_qty)), 0);
  const allRowsHaveRequired = rows.every((r) => {
    if (!r.design_name.trim()) return false;
    if (r.pack_key === CUSTOM_KEY) {
      const parsed = Number.parseInt(r.custom_pack_size, 10);
      return Number.isFinite(parsed) && parsed >= 1 && parsed <= 9999;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-neutral-600">{t('subtitle')}</p>
        </div>
        <Link href="/skus" className="btn-ghost border border-neutral-300 text-sm">
          {tCommon('actions.back')}
        </Link>
      </div>

      {/* Excel paste */}
      <section className="rounded-md border border-neutral-200 bg-white">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
          onClick={() => setPasteOpen((v) => !v)}
        >
          <span>{t('pasteTitle')}</span>
          <span className="text-xs text-neutral-500">{pasteOpen ? '−' : '+'}</span>
        </button>
        {pasteOpen ? (
          <div className="space-y-2 border-t border-neutral-200 px-4 py-3">
            <p className="text-xs text-neutral-600">{t('pasteHint')}</p>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={6}
              className="input-base h-auto min-h-0 w-full font-mono text-xs"
              placeholder={'Dori\t6\t120\t5\ty\t10\nFestive\t1 Doz\t240\t0\t\t20'}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="btn-ghost border border-neutral-300 text-sm"
                onClick={() => {
                  setPaste('');
                  setPasteOpen(false);
                }}
              >
                {tCommon('actions.cancel')}
              </button>
              <button
                type="button"
                className="btn-primary !w-auto px-4 text-sm"
                onClick={handleParse}
                disabled={!paste.trim()}
              >
                {t('pasteButton')}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {/* Editable grid */}
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="payload" value={payload} />

        <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">{t('col.designName')}</th>
                <th className="px-2 py-2">{t('col.pack')}</th>
                <th className="px-2 py-2">{t('col.mrp')}</th>
                <th className="px-2 py-2">{t('col.discount')}</th>
                <th className="px-2 py-2 text-center" title={t('col.discountableHint')}>
                  {t('col.discountable')}
                </th>
                <th className="px-2 py-2">{t('col.printQty')}</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} className="border-t border-neutral-100">
                  <td className="px-2 py-1 text-neutral-500">{idx + 1}</td>
                  <td className="px-1 py-1">
                    <input
                      className="input-base !min-h-0 !py-1 !text-sm"
                      value={r.design_name}
                      onChange={(e) => updateRow(idx, { design_name: e.target.value })}
                      placeholder={t('placeholders.designName')}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <div className="space-y-1">
                      <select
                        className="input-base !min-h-0 !py-1 !text-sm"
                        value={r.pack_key}
                        onChange={(e) => updateRow(idx, { pack_key: e.target.value as PackKey })}
                      >
                        {PACK_TILES.map((tile) => (
                          <option key={tile.key} value={tile.key}>
                            {tile.label}
                          </option>
                        ))}
                        <option value={CUSTOM_KEY}>{t('customPack')}</option>
                      </select>
                      {r.pack_key === CUSTOM_KEY ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min="1"
                            max="9999"
                            step="1"
                            placeholder="e.g. 100"
                            value={r.custom_pack_size}
                            onChange={(e) =>
                              updateRow(idx, {
                                custom_pack_size: e.target.value.replace(/[^\d]/g, ''),
                              })
                            }
                            className="input-base !min-h-0 w-16 !py-1 !text-sm"
                          />
                          <select
                            className="input-base !min-h-0 !py-1 !text-xs"
                            value={r.custom_rate_unit}
                            onChange={(e) =>
                              updateRow(idx, {
                                custom_rate_unit: e.target.value as 'pack' | 'piece',
                              })
                            }
                            title={t('customRateUnitHint')}
                          >
                            <option value="piece">{t('customRateUnitPiece')}</option>
                            <option value="pack">{t('customRateUnitPack')}</option>
                          </select>
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="input-base !min-h-0 !py-1 !text-sm"
                      value={r.price}
                      onChange={(e) => updateRow(idx, { price: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      className="input-base !min-h-0 !py-1 !text-sm"
                      value={r.discount_pct}
                      onChange={(e) => updateRow(idx, { discount_pct: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1 text-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-700"
                      checked={r.is_discountable}
                      onChange={(e) => updateRow(idx, { is_discountable: e.target.checked })}
                      aria-label={t('col.discountable')}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      className="input-base !min-h-0 !py-1 !text-sm"
                      value={r.print_qty}
                      onChange={(e) => updateRow(idx, { print_qty: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      disabled={rows.length <= 1}
                      className="text-sm text-neutral-500 hover:text-red-600 disabled:opacity-40"
                      aria-label={t('removeRow')}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={addRow}
            className="btn-ghost border border-neutral-300 text-sm"
          >
            {t('addRow')}
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="btn-ghost border border-neutral-300 text-sm"
          >
            {t('clearAll')}
          </button>
          <div className="ml-auto text-sm text-neutral-600">
            {t('summary', { rows: rows.length, labels: totalLabels })}
          </div>
        </div>

        {state && !state.ok ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {state.rowIndex !== undefined ? t('errorOnRow', { row: state.rowIndex + 1 }) : null}{' '}
            <span>{tAny(state.messageKey)}</span>
            {state.duplicateSkuCode ? (
              <span className="ml-1">({state.duplicateSkuCode})</span>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center justify-end">
          <button
            type="submit"
            className="btn-primary !w-auto px-5"
            disabled={!allRowsHaveRequired}
          >
            {totalLabels > 0 ? t('submitWithPrint') : t('submitNoPrint')}
          </button>
        </div>
      </form>
    </div>
  );
}
