import { unit_per_usd } from "#/.server/unit-per-usd";
import { MIN_DONATION_USD } from "@/constants/common";
import type { IDonation, IStripeIntentReturn } from "@/donations";
import { rd2num } from "@/helpers/decimal";
import { resp } from "@/helpers/https";
import { db } from "$/pg/db";
import { donation_put, donation_update } from "$/pg/queries/donation";
import type { Provider } from "../types";
import { customer_with_currency } from "./customer-with-currency";
import { npo_descriptor_suffix } from "./descriptor-suffix";
import { donor_refusal } from "./donor-refusal";
import { payment_intent } from "./payment-intent";
import { recurring_bank_methods, setup_intent } from "./setup-intent";

export const stripe_intent: Provider = async ({
  to,
  from,
  donor,
  via,
  intent,
}) => {
  const upusd = await unit_per_usd(intent.currency);
  const base_usd = rd2num(intent.amount.base / upusd, 1);
  if (base_usd < MIN_DONATION_USD) {
    return resp.refuse(
      `The minimum donation is $${MIN_DONATION_USD}. Try a larger amount.`
    );
  }

  const bank_only = via === "bank";
  if (
    bank_only &&
    intent.frequency !== "one-time" &&
    recurring_bank_methods(intent.currency).length === 0
  ) {
    return resp.refuse(
      "Recurring bank payments are available in USD and CAD. Choose one of those currencies or pay by card."
    );
  }

  const customer_id = await customer_with_currency(
    intent.currency,
    donor.email
  );

  const r_id = crypto.randomUUID();
  const now = new Date().toISOString();
  const r: IDonation = {
    id: r_id,
    status: "created",
    via: "stripe",
    upusd,
    created_at: now,
    updated_at: now,
    ...to,
    ...from,
    ...intent,
  };
  const don = await donation_put(db, r);

  // a suffix shows on card charges only, and a subscription's charges take
  // none (they're stripe-created)
  const descriptor_suffix =
    intent.frequency === "one-time" && !bank_only
      ? await npo_descriptor_suffix(to)
      : undefined;

  let client_secret: string;
  try {
    client_secret =
      intent.frequency === "one-time"
        ? await payment_intent({
            ...don.amount,
            currency: don.currency,
            customer_id,
            order_id: don.id,
            bank_only,
            descriptor_suffix,
          })
        : await setup_intent(don.id, customer_id, don.currency, bank_only);
  } catch (err) {
    // no intent exists, so nothing can ever pay this row. left as `created` it
    // would read as a checkout that might still be paid, and keep its campaign
    // from being deleted
    await donation_update(db, don.id, { status: "failed" }).catch(() => {});
    const refusal = donor_refusal(err);
    if (!refusal) throw err;
    // 4xx is kept off sentry, so this line is the only record of the refusal
    console.info(
      `[stripe-intent] 400 - ${refusal.code} - don ${don.id} - ${refusal.message}`
    );
    return resp.refuse(refusal.reason);
  }

  const body: IStripeIntentReturn = {
    client_secret,
    order_id: don.id,
  };
  return { don_id: don.id, body };
};
