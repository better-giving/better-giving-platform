import { currency_precision } from "#/helpers/stripe";
import type { ICurrencyFv } from "#/types/currency";
import { PROCESSING_RATES } from "@/constants/common";
import type { IAmount } from "@/donations";
import { snap, to_units } from "@/helpers/decimal";
import { min_fee_allowance } from "@/helpers/donation";
import { type TTipFormat, tip_val } from "../types";

export interface IAmountsInput {
  amount: number;
  tip_format: TTipFormat;
  tip: string;
  cover_processing_fee: boolean;
}

export interface IFeeTerms {
  rate: number;
  flat?: number;
  cap?: number;
}

/** each rail's fee terms, `flat` and `cap` in usd: a checkout in another
 * currency scales them by its rate */
export const fee_terms = {
  stripe: { rate: PROCESSING_RATES.stripe, flat: PROCESSING_RATES.stripe_flat },
  stripe_bank: {
    rate: PROCESSING_RATES.stripe_bank,
    cap: PROCESSING_RATES.stripe_bank_cap,
  },
  paypal: { rate: PROCESSING_RATES.paypal, flat: PROCESSING_RATES.paypal_flat },
  daf: { rate: PROCESSING_RATES.chariot },
  crypto: { rate: PROCESSING_RATES.crypto },
} as const satisfies Record<string, IFeeTerms>;

/** the parts a checkout shows and charges. tip and fee allowance land on the
 * currency's smallest unit (cents for usd), so with a base already at that
 * precision the summary and the charge total the same. the fee allowance
 * rounds up so it still covers the fee. */
export function donation_amounts(
  i: IAmountsInput,
  precision: number,
  { rate, flat = 0, cap = Number.POSITIVE_INFINITY }: IFeeTerms
): IAmount {
  const in_units = (x: number, mode?: "up") =>
    to_units(x, precision, mode) / 10 ** precision;

  const tip = in_units(tip_val(i.tip_format, i.tip, i.amount));
  // down to the smallest unit, so rounding the fee up can't carry it past the cap
  const cap_in_units =
    Math.floor(snap(cap * 10 ** precision)) / 10 ** precision;
  const fee = i.cover_processing_fee
    ? Math.min(min_fee_allowance(tip + i.amount, rate, flat), cap_in_units)
    : 0;

  return { base: i.amount, tip, fee_allowance: in_units(fee, "up") };
}

/** dafs grant whole dollars only: the total rounds up to the next dollar, the
 * difference landing on the fee allowance when the donor covers fees, else on
 * the tip. with neither, the base is the total as entered. */
export function whole_dollar_amounts({
  base,
  tip,
  fee_allowance,
}: IAmount): IAmount {
  if (!tip && !fee_allowance) return { base, tip, fee_allowance };
  const cents = (x: number) => to_units(x, 2);
  const total = cents(base) + cents(tip) + cents(fee_allowance);
  const topup = Math.ceil(total / 100) * 100 - total;
  return fee_allowance
    ? { base, tip, fee_allowance: (cents(fee_allowance) + topup) / 100 }
    : { base, tip: (cents(tip) + topup) / 100, fee_allowance };
}

export interface IStripeAmountsInput extends IAmountsInput {
  currency: Pick<ICurrencyFv, "code" | "rate">;
  bank_only?: boolean;
}

export function stripe_amounts(i: IStripeAmountsInput): IAmount {
  const { rate: fx } = i.currency;
  const { stripe, stripe_bank } = fee_terms;
  const fee: IFeeTerms = i.bank_only
    ? // bank fee capped at $5 converted to donor currency
      { rate: stripe_bank.rate, cap: stripe_bank.cap * fx }
    : { rate: stripe.rate, flat: stripe.flat * fx };
  return donation_amounts(i, currency_precision(i.currency.code), fee);
}
