/**
 * Code128 barcode encoder producing SVG. Self-contained — no external
 * dependencies, no runtime allocations beyond the output string.
 *
 * We only implement **Code Set B** (uppercase, lowercase, digits, common
 * punctuation) because every SKU code we generate is drawn from that range.
 * Set A (control chars) and Set C (double-density digits) would add
 * complexity for zero gain on this dataset. If the SKU code contains a
 * character outside Set B, `encode()` throws — better than emitting a
 * silently-corrupt barcode.
 *
 * Bar pattern reference: each Code128 symbol is 11 modules wide,
 * alternating black-white-black-white-black-white. `PATTERNS[i]` encodes
 * six digits: bar/space/bar/space/bar/space widths in modules. The stop
 * character is special — 13 modules with a trailing 2-module black bar.
 *
 * Layout: an SVG <svg> whose viewBox is `moduleCount × 100`. The caller
 * sets the CSS width/height. Bars are `<rect>`s. Because module widths are
 * unitless integers in the viewBox, the barcode scales cleanly at any
 * physical size — 20mm on the sticker, 200mm on a review page — with no
 * blur or sub-pixel snapping issues.
 */

// Bar/space widths per Code128 value (0-105). Each entry is six digits
// b s b s b s (module widths). Values 0-95 map to Set B chars ' ' - '~';
// 96-107 are control (shift codes, function codes, start codes, stop).
const PATTERNS = [
  '212222',
  '222122',
  '222221',
  '121223',
  '121322',
  '131222',
  '122213',
  '122312',
  '132212',
  '221213',
  '221312',
  '231212',
  '112232',
  '122132',
  '122231',
  '113222',
  '123122',
  '123221',
  '223211',
  '221132',
  '221231',
  '213212',
  '223112',
  '312131',
  '311222',
  '321122',
  '321221',
  '312212',
  '322112',
  '322211',
  '212123',
  '212321',
  '232121',
  '111323',
  '131123',
  '131321',
  '112313',
  '132113',
  '132311',
  '211313',
  '231113',
  '231311',
  '112133',
  '112331',
  '132131',
  '113123',
  '113321',
  '133121',
  '313121',
  '211331',
  '231131',
  '213113',
  '213311',
  '213131',
  '311123',
  '311321',
  '331121',
  '312113',
  '312311',
  '332111',
  '314111',
  '221411',
  '431111',
  '111224',
  '111422',
  '121124',
  '121421',
  '141122',
  '141221',
  '112214',
  '112412',
  '122114',
  '122411',
  '142112',
  '142211',
  '241211',
  '221114',
  '413111',
  '241112',
  '134111',
  '111242',
  '121142',
  '121241',
  '114212',
  '124112',
  '124211',
  '411212',
  '421112',
  '421211',
  '212141',
  '214121',
  '412121',
  '111143',
  '111341',
  '131141',
  '114113',
  '114311',
  '411113',
  '411311',
  '113141',
  '114131',
  '311141',
  '411131',
  '211412',
  '211214',
  '211232',
  '2331112',
] as const;

const START_B = 104;
const STOP = 106;

/**
 * Map an ASCII character code to its Code128 Set B value.
 * Set B covers ASCII 32 ('space') through 127 ('DEL') → Code128 values 0-95.
 */
function setBValue(charCode: number): number {
  if (charCode >= 32 && charCode <= 127) return charCode - 32;
  throw new Error(
    `Code128: character ${JSON.stringify(String.fromCharCode(charCode))} not in Set B`,
  );
}

/**
 * Encode a string as a Code128 (Set B) module pattern.
 * Returns the pattern as a string of "01" characters where 1=black bar.
 * That representation is trivial to render as SVG rects.
 */
function encodeToPattern(data: string): { pattern: string; moduleCount: number } {
  if (!data || data.length === 0) throw new Error('Code128: empty data');

  const values: number[] = [START_B];
  for (let i = 0; i < data.length; i += 1) {
    values.push(setBValue(data.charCodeAt(i)));
  }

  // Checksum: sum of (start * 1) + (value_i * position_i) mod 103.
  let sum = values[0]!;
  for (let i = 1; i < values.length; i += 1) sum += values[i]! * i;
  const checksum = sum % 103;
  values.push(checksum);
  values.push(STOP);

  // Compose the "01" pattern. Each symbol is 11 modules of alternating
  // bar/space starting with a bar. The stop symbol tacks on an extra 2-
  // module bar at the end, encoded as the 7-digit stop pattern above.
  let out = '';
  for (let i = 0; i < values.length; i += 1) {
    const widths = PATTERNS[values[i]!]!;
    for (let w = 0; w < widths.length; w += 1) {
      const bit = w % 2 === 0 ? '1' : '0'; // even index = bar, odd = space
      out += bit.repeat(Number(widths[w]!));
    }
  }
  return { pattern: out, moduleCount: out.length };
}

export interface Code128Options {
  /** CSS width / height for the outer <svg>. Widths default to '100%'. */
  width?: string;
  height?: string;
  /**
   * Quiet-zone modules on both sides. Code128 spec requires at least 10
   * modules; anything more is safety margin. Default 10.
   */
  quietModules?: number;
  /** Bar color. Defaults to `#000` — always black on white for label print. */
  color?: string;
}

/**
 * Render a Code128 barcode as an SVG string. Caller-provided width/height
 * apply to the outer <svg>; the internal viewBox is expressed in module
 * units so bar widths stay pixel-perfect at any physical size.
 */
export function code128Svg(data: string, options: Code128Options = {}): string {
  const { width = '100%', height = '100%', quietModules = 10, color = '#000' } = options;
  const { pattern } = encodeToPattern(data);
  const total = pattern.length + quietModules * 2;

  // Collect contiguous bar runs into single <rect> elements — cheaper output
  // and easier for the printer/renderer to snap to whole pixels.
  let x = quietModules;
  let rects = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '1') {
      let w = 1;
      while (i + w < pattern.length && pattern[i + w] === '1') w += 1;
      rects += `<rect x="${x}" y="0" width="${w}" height="100" fill="${color}"/>`;
      x += w;
      i += w;
    } else {
      x += 1;
      i += 1;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${total} 100" preserveAspectRatio="none" shape-rendering="crispEdges">` +
    rects +
    `</svg>`
  );
}
