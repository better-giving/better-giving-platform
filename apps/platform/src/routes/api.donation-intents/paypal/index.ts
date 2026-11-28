import { unit_per_usd } from "#/.server/unit-per-usd";
import { paypal_currencies } from "#/constants/paypal";
import { report_error } from "#/errors/report";
import { MIN_DONATION_USD } from "@/constants/common";
import type { IDonation } from "@/donations";
import { rd2num } from "@/helpers/decimal";
import { put_or_reuse } from "$/donation-intents/put-once";
import { type Refusal, refuse, to_response } from "$/donation-intents/refusal";
import { db } from "$/pg/db";
import { donation_update } from "$/pg/queries/donation";
import {
  type Ctx,
  type IntentResult,
  type Provider,
  REFUSED_COPY,
} from "../types";
import { paypal_charge } from "./charge";
import { create_order } from "./create-order";
import { create_subs, subscription_quantity } from "./create-subs";

/** the order or subscription, refusals as data (see `stripe_create`) */
export const paypal_create = async ({
  to,
  from,
  via_extra,
  don_id,
  intent,
}: Ctx): Promise<Refusal | IntentResult> => {
  // venmo rides paypal's rail: its donor reads the method they clicked
  const method = via_extra === "venmo" ? "Venmo" : "PayPal";
  const scale = paypal_currencies[intent.currency];
  if (scale === undefined) {
    return refuse(
      "unsupported",
      `${method} doesn't accept ${intent.currency}. Try another payment method.`
    );
  }
  const charge = paypal_charge(intent.amount, scale);

  // a total paypal can't take as a subscription quantity is refused before a
  // row or a paypal object exists
  if (
    intent.frequency !== "one-time" &&
    subscription_quantity(charge.total) === null
  ) {
    console.info(`[resp] 400 - paypal quantity: ${charge.total}`);
    return refuse("invalid", REFUSED_COPY);
  }

  const upusd = await unit_per_usd(intent.currency);
  const base_usd = rd2num(charge.amount.base / upusd, 1);
  if (base_usd < MIN_DONATION_USD) {
    const usd = `${MIN_DONATION_USD} USD`;
    return refuse(
      "below_minimum",
      intent.currency === "USD"
        ? `The minimum ${method} donation is ${usd}.`
        : `The minimum ${method} donation is ${usd}, or its equivalent in ${intent.currency}.`,
      400,
      { minimum_usd: MIN_DONATION_USD, upusd }
    );
  }

  const r_id = don_id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const r: IDonation = {
    id: r_id,
    status: "created",
    via: "paypal",
    upusd,
    created_at: now,
    updated_at: now,
    ...to,
    ...from,
    ...intent,
    amount: charge.amount,
  };
  const don = await put_or_reuse(db, r, !!don_id);

  let tx_id: string;
  try {
    if (intent.frequency === "one-time") {
      tx_id = await create_order({
        order_id: don.id,
        currency: don.currency,
        npo_name: to.to_name,
        charge,
      });
    } else {
      tx_id = await create_subs({
        charge,
        order_id: don.id,
        freq: intent.frequency,
        currency: don.currency,
      });
    }
  } catch (err) {
    // nothing at paypal for the donor to approve, so the row is not pending
    await donation_update(db, don.id, { status: "failed" }).catch((e) =>
      report_error(e, { don_id: don.id })
    );
    throw err;
  }

  return {
    don_id: don.id,
    body: { tx_id, don_id: don.id, amount: charge.total },
  };
};

export const paypal_intent: Provider = async (ctx) =>
  to_response(await paypal_create(ctx));
