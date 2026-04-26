import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const INDIAN_NUMBER_FORMAT = new Intl.NumberFormat('en-IN');

export function formatIndianNumber(n: number): string {
  return INDIAN_NUMBER_FORMAT.format(n);
}

export function formatRupees(n: number): string {
  return `₹${INDIAN_NUMBER_FORMAT.format(Math.round(n * 100) / 100)}`;
}
