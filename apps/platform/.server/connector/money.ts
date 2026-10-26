import { base_url } from "#/constants/env";

export type Money = { amount: string; currency: "USD" };

// 12 whole digits keeps a dollar amount's cents exact as a double, with room to spare
export const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
export const AMOUNT_MSG =
  'is a positive amount in US dollars, written like "2500" or "2500.50"';

/** USD major units as a two-digit decimal string. */
export function usd_amount(value: number): string {
  const cents = Math.round(value * 100);
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export function usd_minor(value: number): number {
  return Math.round(value * 100);
}

export function usd(value: number | null | undefined): Money | null {
  if (value == null || !Number.isFinite(value)) return null;
  return { amount: usd_amount(value), currency: "USD" };
}

export function absolute(path: string): string {
  const base = base_url.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
