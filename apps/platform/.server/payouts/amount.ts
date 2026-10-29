import { to_units } from "@/helpers/decimal";

/** the usd `amounts` as the whole cents a payout sends: their sum, rounded half down */
export const payout_cents = (amounts: number[]): number =>
  to_units(
    amounts.reduce((a, b) => a + b, 0),
    2,
    "half_down"
  );

/**
 * what a payout run sends to Wise for these amounts: `payout_cents` as usd.
 * the minimum check, the ref, the quote and every record of the payout take
 * this one figure.
 */
export function payout_total(amounts: number[]): number {
  return payout_cents(amounts) / 100;
}
