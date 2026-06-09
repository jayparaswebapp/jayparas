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
  // Printed cell matches the physical sticker exactly (25 × 15 mm). Each
  // cell sits flush over its sticker so content can use the full sticker
  // area, and the per-cell internal padding in <SkuLabel> handles the
  // visual breathing room.
  labelWidth: '25mm',
  labelHeight: '15mm',
  columns: 2,
  // Physical layout: 2 + 25 + 3 + 25 + 2 = 57 mm carrier width, with a
  // 3 mm gap between the two stickers in a row and a 3 mm gap between
  // successive rows.
  gapX: '3mm',
  gapY: '3mm',
  marginX: '2mm',
  pageWidth: '57mm',
};

export const DEFAULT_LABEL_GRID = ROLL_2UP_25x15;

/**
 * Font sizes for the printed label (Variant C — Bigger, picked by the user).
 * Stored here so the label component reads from one source.
 */
export const LABEL_FONT = {
  name: { sizePt: 9, weight: 700 },
  rate: { sizePt: 9, weight: 700 },
  unit: { sizePt: 7, weight: 700 },
  qrSize: '9mm',
} as const;
