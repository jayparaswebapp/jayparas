/**
 * Number → Indian English words (lakh / crore system).
 * Used for the "Rupees ... Only" line on printed invoices.
 *
 * Handles up to 99,99,99,999.99 (99 crore range). Paisa is rendered as
 * "and XX paisa only" when non-zero, otherwise "only".
 */

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function under100(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? (TENS[t] ?? '') : `${TENS[t]} ${ONES[o]}`;
}

function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h > 0) parts.push(`${ONES[h]} Hundred`);
  if (r > 0) parts.push(under100(r));
  return parts.join(' ');
}

function rupeesInWords(rupees: number): string {
  if (rupees === 0) return 'Zero';
  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;
  const parts: string[] = [];
  if (crore > 0) parts.push(`${under100(crore)} Crore`);
  if (lakh > 0) parts.push(`${under100(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${under100(thousand)} Thousand`);
  if (rest > 0) parts.push(under1000(rest));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function indianAmountInWords(total: number): string {
  const rounded = Math.round(total * 100);
  const rupees = Math.floor(rounded / 100);
  const paisa = rounded % 100;
  const rupeesWords = rupeesInWords(rupees);
  if (paisa === 0) return `Rupees ${rupeesWords} Only`;
  return `Rupees ${rupeesWords} and ${under100(paisa)} Paisa Only`;
}
