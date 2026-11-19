import { addMinutes } from "date-fns";
import { paypal as paypal_env } from "$/env";
import { paypal } from "$/kit/paypal";
import type { ICharge } from "./charge";

type TFreq = "monthly" | "weekly" | "annual";

export interface IInput {
  order_id: string;
  currency: string;
  freq: TFreq;
  charge: ICharge;
}

// paypal's subscription `quantity` is a string of `^([0-9]+|([0-9]+)?[.][0-9]+)$`,
// 1 to 32 characters, and it rejects one past five integer digits
const QUANTITY = /^(\d+|\d*\.\d+)$/;
const QUANTITY_CEILING = 100_000;

/** the charge total as the quantity paypal takes, or null when it can't be
 * represented: a malformed string, zero, or past the ceiling */
export const subscription_quantity = (total: string): string | null => {
  if (total.length > 32 || !QUANTITY.test(total)) return null;
  const n = Number(total);
  return n > 0 && n < QUANTITY_CEILING ? total : null;
};

// read per call: this module loads with every donation rail, so a bad plan
// var must fail its own frequency, not the import
const plan_id_of = (freq: TFreq, currency: string): string => {
  const raw = paypal_env.plans[freq];
  const id = raw
    ? (JSON.parse(raw) as Record<string, string>)[currency]
    : undefined;
  if (!id) throw new Error(`no paypal ${freq} plan for ${currency}`);
  return id;
};

export const create_subs = async (i: IInput): Promise<string> => {
  const plan_id = plan_id_of(i.freq, i.currency);
  const quantity = subscription_quantity(i.charge.total);
  if (quantity === null) {
    throw new Error(`no paypal quantity for a total of ${i.charge.total}`);
  }

  // order_id is stable per intent — use it as the idempotency key so a retry
  // after a timeout returns the original subscription instead of a duplicate
  const { id = "invalid subs id" } = await paypal.create_subscription(
    {
      custom_id: i.order_id,
      plan_id: plan_id,
      // each plan prices one unit of its currency, so the quantity is the
      // per-cycle total; paypal's quantity takes decimals
      quantity,
      auto_renewal: true,
      start_time: addMinutes(new Date(), 5).toISOString(),
    },
    `subs-${i.order_id}`
  );

  return id;
};
