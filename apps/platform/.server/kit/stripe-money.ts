import type Stripe from "stripe";
import { currency_precision, from_stripe_amount } from "#/helpers/stripe";

/** a stripe atomic amount for an ops notice, e.g. `12.50 USD` */
export const money = (atomic: number, currency: string) =>
  `${from_stripe_amount(atomic, currency).toFixed(currency_precision(currency))} ${currency.toUpperCase()}`;

export const refund_list = (refunds: Stripe.Refund[], currency: string) =>
  refunds
    .map((r) => `${money(r.amount, currency)} (${r.id}, ${r.status})`)
    .join(", ");

/** for an alert's title and fields: `$6.00` in usd, else as `money` */
export const money_label = (atomic: number, currency: string) =>
  currency.toLowerCase() === "usd"
    ? `$${from_stripe_amount(atomic, currency).toFixed(2)}`
    : money(atomic, currency);
