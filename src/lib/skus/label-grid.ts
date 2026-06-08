/**
 * Thermal roll geometry — kept in this single constants file so swapping
 * stock (or moving to a different printer / paper) is a one-line change.
 *
 * Active stock: 25 × 15 mm die-cut thermal labels, 2-up across a 57 mm
 * carrier (3 mm gap between columns, 3 mm gap between rows). The printer's
 * gap sensor handles the row-to-row advance, so each @page is exactly one
 * row's printable area (57 × 15 mm). Each @page is force-page-broken so
 * N labels feed exactly ceil(N / 2) rows of stickers — no more A4 worth
 * of blank labels.
 */

export interface LabelRollGrid {
  format: 'roll';
  labelWidth: string;
  labelHeight: string;
  columns: number;
  /** Horizontal gap between the two columns. */
  gapX: string;
  /**
   * Physical row gap on the roll. Not printed (the printer's gap sensor
   * advances over it). Kept here for documentation / future stock swaps.
   */
  gapY: string;
  /** Page (= one row) width. */
  pageWidth: string;
  /** Page (= one row) height — exactly one sticker tall. */
  pageHeight: string;
}

export const ROLL_2UP_25x15: LabelRollGrid = {
  format: 'roll',
  labelWidth: '25mm',
  labelHeight: '15mm',
  columns: 2,
  gapX: '3mm',
  gapY: '3mm',
  pageWidth: '57mm',
  pageHeight: '15mm',
};

export const DEFAULT_LABEL_GRID = ROLL_2UP_25x15;

/**
 * Font sizes for the printed label. Sized for a 25 × 15 mm sticker — three
 * stacked text rows on the left, square QR on the right.
 */
export const LABEL_FONT = {
  name: { sizePt: 8, weight: 700 },
  rate: { sizePt: 8, weight: 400 },
  unit: { sizePt: 7, weight: 700 },
  qrSize: '9mm',
} as const;
