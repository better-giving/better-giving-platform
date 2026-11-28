import { ChariotError } from "@better-giving/chariot";
import { and, eq, ne } from "drizzle-orm";
import { report_degraded } from "#/errors/report";
import { MIN_DONATION_USD } from "@/constants/common";
import type { ChariotMetadata, IDonation } from "@/donations";
import { amnt_sum } from "@/donations/helpers";
import { snap } from "@/helpers/decimal";
import { put_or_reuse } from "$/donation-intents/put-once";
import { type Refusal, refuse, to_response } from "$/donation-intents/refusal";
import { chariot } from "$/kit/chariot";
import { db } from "$/pg/db";
import { is_unique_violation } from "$/pg/errors";
import {
  donation_get,
  donation_put,
  donation_tribute_upsert,
} from "$/pg/queries/donation";
import { donations } from "$/pg/schema/donation";
import type { Ctx, IntentResult, Provider } from "../types";

/** create grant answers these having made no grant, so the donor can go again.
 * not 409: that's this session's grant already processing, so one may exist */
const NO_GRANT = new Set([400, 404, 410]);
// chariot's own reason can be about our key or config, so it goes to the report
const NO_GRANT_MSG =
  "Your fund couldn't make this grant. Please check the amount and try again.";

/** the grant's row, refusals as data (see `stripe_create`). a grant answered
 * 410 is an authorization that ran out */
export const chariot_create = async ({
  to,
  from,
  via,
  via_extra,
  don_id: minted_id,
  tribute,
  intent,
}: Ctx): Promise<Refusal | IntentResult> => {
  // chariot is usd-only; upusd = 1 so base_usd === intent.amount.base
  if (intent.amount.base < MIN_DONATION_USD)
    return refuse(
      "below_minimum",
      `The minimum DAF donation is ${MIN_DONATION_USD} USD.`,
      400,
      { minimum_usd: MIN_DONATION_USD, upusd: 1 }
    );

  // dafs grant whole dollars only; chariot 400s anything else after the donor
  // has already authorized, so it's refused here with a message they can read
  const dollars = snap(amnt_sum(intent.amount));
  if (!Number.isInteger(dollars))
    return refuse("invalid", "DAF grants must be a whole dollar amount", 400);

  const cents = dollars * 100;
  const now = new Date().toISOString();
  const row = (id: string, via_extra: string): IDonation => ({
    id,
    status: "intent",
    via,
    via_extra,
    upusd: 1, // chariot only supports usd
    created_at: now,
    updated_at: now,
    ...to,
    ...from,
    ...intent,
  });

  // a caller that mints its own id writes the row before the grant, under the
  // authorization's session, so a grant is never made without a row for it
  // (the grant id replaces the session once it exists). a retry finds its row
  if (minted_id) {
    await put_or_reuse(db, row(minted_id, via_extra), true, true);
    // written before the grant exists, so a grant that settles at once finds
    // it, and on a retry of a request that died, whether or not its first
    // attempt wrote one
    if (tribute) {
      await donation_tribute_upsert(db, {
        donation_id: minted_id,
        name: tribute.full_name,
        notif_email: tribute.notif?.to_email ?? null,
        notif_fullname: tribute.notif?.to_fullname ?? null,
        notif_msg: tribute.notif?.from_msg || null,
      });
    }
  }

  const grant = await chariot
    .create_grant({ workflowSessionId: via_extra, amount: cents })
    .catch((err) => {
      if (!(err instanceof ChariotError) || !NO_GRANT.has(err.http_status))
        throw err;
      return err;
    });
  if (grant instanceof ChariotError) {
    report_degraded(grant, {
      status: grant.http_status,
      request_id: grant.request_id,
      reason: grant.reason,
    });
    return refuse(
      grant.http_status === 410 ? "authorization_expired" : "invalid",
      NO_GRANT_MSG,
      grant.http_status
    );
  }

  if (minted_id) {
    // a repeat create for a session answers the grant it first made. it must
    // not be recorded at an amount it wasn't made for, or a second time
    if (grant.amount !== cents) {
      return refuse(
        "invalid",
        "This authorization was made for a different amount.",
        400
      );
    }
    const [recorded] = await db
      .select({ id: donations.id })
      .from(donations)
      .where(
        and(
          eq(donations.via, "chariot"),
          eq(donations.via_extra, grant.id),
          ne(donations.id, minted_id)
        )
      );
    if (recorded) {
      return refuse(
        "invalid",
        "This authorization already made a payment.",
        400
      );
    }
    await db
      .update(donations)
      .set({ via_extra: grant.id })
      .where(eq(donations.id, minted_id));
    return { don_id: minted_id, body: { id: minted_id } };
  }

  const meta = grant.metadata as Partial<ChariotMetadata> | undefined;
  const don_id = meta?.don_id;
  if (!don_id) throw new Error(`chariot grant ${grant.id} carries no don_id`);
  const r = row(don_id, grant.id);

  const don = await db
    .transaction((tx) => donation_put(tx, r))
    .catch(async (err) => {
      if (!is_unique_violation(err, "donations_pkey")) throw err;
      // create grant answers a repeat for the same workflow session with the
      // same grant, so a row for it means an earlier request already recorded it
      const prior = await donation_get(don_id);
      if (prior?.via_extra !== grant.id) throw err;
      return prior;
    });
  return { don_id: don.id, body: { id: don.id } };
};

export const chariot_intent: Provider = async (ctx) =>
  to_response(await chariot_create(ctx));
