const DEFAULT_DOMAIN = 'jayparas.internal';

/**
 * Map a 10-digit Indian mobile to the synthetic Supabase Auth email.
 * The mobile is the user-facing identifier; the email is an implementation detail.
 */
export function mobileToSyntheticEmail(mobile: string): string {
  const domain = process.env.AUTH_EMAIL_DOMAIN || DEFAULT_DOMAIN;
  return `${mobile}@${domain}`;
}

export function isValidIndianMobile(mobile: string): boolean {
  return /^[6-9]\d{9}$/.test(mobile);
}

export function isValidPin(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}
