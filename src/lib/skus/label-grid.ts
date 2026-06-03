/**
 * Thermal roll geometry — kept in this single constants file so swapping
 * stock (or moving to a different printer / paper) is a one-line change.
 *
 * v1 hardware: 25 × 15 mm continuous-roll thermal labels, 2-up. Each printed
 * row is one pair of labels separated by a 2 mm gap; the roll feeds vertically
 * with a 1 mm gap between rows.
 *
 * @media print uses `@page { size: 54mm auto }` so the browser hands the
 * printer a fixed-width, variable-height page (matching the roll), and rows
 * flow continuously without a forced page break.
 */

export interface LabelRollGrid {
  format: 'roll';
  /** Per-label physical dimensions. */
  labelWidth: string;
  labelHeight: string;
  /** Number of labels per row (2-up). */
  columns: number;
  /** Horizontal gap between the two columns. */
  gapX: string;
  /** Vertical gap between successive rows on the roll. */
  gapY: string;
  /** Side margin (applied symmetrically as left and right padding). */
  marginX: string;
  /** Total page width (roll width) — marginX + labels + gapX + marginX. */
  pageWidth: string;
}

export const ROLL_2UP_25x15: LabelRollGrid = {
  format: 'roll',
  // Printed cell is 23 × 13 mm — 1 mm inset on every side of the physical
  // 25 × 15 mm sticker so a slight head misalignment doesn't run ink onto
  // the backing paper.
  labelWidth: '23mm',
  labelHeight: '13mm',
  columns: 2,
  // 1 mm safe + 3 mm physical roll gap + 1 mm safe = 5 mm between printed
  // cells; 1 mm safe + 1 mm physical row gap + 1 mm safe = 3 mm vertically.
  gapX: '5mm',
  gapY: '3mm',
  // 2 mm physical roll edge + 1 mm safe inside the first sticker.
  marginX: '3mm',
  // 3 (left) + 23 + 5 (gap) + 23 + 3 (right) = 57 mm physical roll width.
  pageWidth: '57mm',
};

export const DEFAULT_LABEL_GRID = ROLL_2UP_25x15;

/**
 * Font sizes for the printed label (Variant C — Bigger, picked by the user).
 * Stored here so the label component reads from one source.
 */
export const LABEL_FONT = {
  name: { sizePt: 8, weight: 700 },
  rate: { sizePt: 8, weight: 400 },
  unit: { sizePt: 7, weight: 700 },
  qrSize: '8mm',
} as const;
