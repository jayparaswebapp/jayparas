/**
 * Indian states / UTs for party state and place of supply. GST split depends
 * on this: same state as us → CGST + SGST, any other → IGST. Keep
 * normalizeState() in step with public._norm_state() in the database.
 */
export const INDIAN_STATES = [
  'Gujarat',
  'Maharashtra',
  'Rajasthan',
  'Madhya Pradesh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
] as const;

const ALIASES: Record<string, string> = {
  gujrat: 'gujarat',
  gujaratstate: 'gujarat',
  gj: 'gujarat',
  valsad: 'gujarat',
  vapi: 'gujarat',
  surat: 'gujarat',
  maharastra: 'maharashtra',
  maharashtr: 'maharashtra',
  mh: 'maharashtra',
  mumbai: 'maharashtra',
  rajsthan: 'rajasthan',
  rj: 'rajasthan',
  mp: 'madhyapradesh',
  dadranagarhaveli: 'dadranagarhavelianddamananddiu',
  dnhdd: 'dadranagarhavelianddamananddiu',
  silvassa: 'dadranagarhavelianddamananddiu',
  daman: 'dadranagarhavelianddamananddiu',
};

/** Spelling-proof key for comparing states; null when blank. */
export function normalizeState(s: string | null | undefined): string | null {
  const k = (s ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!k) return null;
  return ALIASES[k] ?? k;
}

/** Standard name for a typed state, or the text as-is if not recognised. */
export function canonicalState(s: string | null | undefined): string {
  const key = normalizeState(s);
  if (!key) return '';
  return INDIAN_STATES.find((x) => normalizeState(x) === key) ?? (s ?? '').trim();
}
