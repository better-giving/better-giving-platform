import { unit_per_usd } from "#/.server/unit-per-usd";
import { MIN_DONATION_USD } from "@/constants/common";
import type { IDonation, IStripeIntentReturn } from "@/donations";
import { rd2num } from "@/helpers/decimal";
import { put_or_reuse } from "$/donation-intents/put-once";
import { type Refusal, refuse, to_response } from "$/donation-intents/refusal";
import { db } from "$/pg/db";
import { donation_update } from "$/pg/queries/donation";
import type { Ctx, IntentResult, Provider } from "../types";
import { customer_with_currency } from "./customer-with-currency";
import { npo_descriptor_suffix } from "./descriptor-suffix";
import { donor_refusal } from "./donor-refusal";
import { payment_intent } from "./payment-intent";
import { recurring_bank_methods, setup_intent } from "./setup-intent";

/** the intent for card, wallets and bank, refusals as data: checkout words
 * them as a response (`stripe_intent`), the partner API as problem codes */
export const stripe_create = async ({
  to,
  from,
  donor,
  via,
  don_id,
  intent,
}: Ctx): Promise<Refusal | IntentResult> => {
  const upusd = await unit_per_usd(intent.currency);
  const base_usd = rd2num(intent.amount.base / upusd, 1);
  if (base_usd < MIN_DONATION_USD) {
    return refuse(
      "below_minimum",
      `The minimum donation is $${MIN_DONATION_USD}. Try a larger amount.`,
      400,
      { minimum_usd: MIN_DONATION_USD, upusd }
    );
  }

  const bank_only = via === "bank";
  if (
    bank_only &&
    intent.frequency !== "one-time" &&
    recurring_bank_methods(intent.currency).length === 0
  ) {
    return refuse(
      "unsupported",
      "Recurring bank payments are available in USD and CAD. Choose one of those currencies or pay by card."
    );
  }

  // a caller that minted the id may retry: every object made for it is keyed
  // by it, so the retry's params match the first attempt's
  const customer_id = don_id
    ? await customer_with_currency(
        intent.currency,
        donor.email,
        `partner-cus-${don_id}`
      )
    : await customer_with_currency(intent.currency, donor.email);

  const r_id = don_id ?? crypto.randomUUID();
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
  const don = await put_or_reuse(db, r, !!don_id);

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
            // a minted id means a caller that may retry: the same key finds
            // the same intent
            ...(don_id && { idempotency_key: `partner-pi-${don.id}` }),
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
    return refuse(
      refusal.code === "amount_too_small" ? "below_minimum" : "above_maximum",
      refusal.reason
    );
  }

  const body: IStripeIntentReturn = {
    client_secret,
    order_id: don.id,
  };
  return { don_id: don.id, body };
};

export const stripe_intent: Provider = async (ctx) =>
  to_response(await stripe_create(ctx));
