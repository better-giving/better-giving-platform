import type Stripe from "stripe";
import { msg } from "@/queue";
import { stage } from "$/env";
import { enqueue } from "$/kit/queue";
import { npo_default_bapp } from "$/pg/queries/banking";
import {
  npo_stripe_deauthorize,
  type TStripeDeauthorizeTie,
} from "$/pg/queries/npo";
import { reg_stripe_deauthorize } from "$/pg/queries/registration";
import { account_access_live } from "$/stripe-connect/sync";

/** what a disconnect did. `stale`: the npo connected the account again after
 * the event, so it is a redelivery of an earlier disconnect and changes
 * nothing. `reg_cleared`: an applicant's registration no longer holds it.
 * `reg_stale`: the registration connected it again after the event */
export type TDeauthorized =
  | { status: "marked"; npo_id: number }
  | { status: "stale"; npo_id: number }
  | { status: "reg_cleared"; reg_id: string }
  | { status: "reg_stale"; reg_id: string }
  | { status: "unknown" };

/** a connect and a disconnect in one second: stripe's clock has no fraction,
 * so the account's access now says which one landed last */
async function resolve_tie<T extends { status: string }>(
  acct: string,
  first: T,
  again: (tie: Exclude<TStripeDeauthorizeTie, "ask">) => Promise<T>
): Promise<T> {
  if (first.status !== "tied") return first;
  return again((await account_access_live(acct)) ? "stale" : "mark");
}

/** `ev.account` disconnected us from its stripe dashboard. an npo holding it
 * is stamped, so its later settlements fall back to pooled; a registration
 * holding it drops it, so the applicant can connect again */
export async function handle_account_deauthorized(
  ev: Stripe.AccountApplicationDeauthorizedEvent
): Promise<TDeauthorized> {
  if (!ev.account) return { status: "unknown" };
  const acct = ev.account;
  const at = new Date(ev.created * 1000).toISOString();
  const npo = await resolve_tie(
    acct,
    await npo_stripe_deauthorize(acct, at),
    (tie) => npo_stripe_deauthorize(acct, at, undefined, tie)
  );
  if (npo.status === "stale") return npo;
  if (npo.status === "unknown") {
    const reg = await resolve_tie(
      acct,
      await reg_stripe_deauthorize(acct, at),
      (tie) => reg_stripe_deauthorize(acct, at, undefined, tie)
    );
    if (reg.status === "cleared")
      return { status: "reg_cleared", reg_id: reg.reg_id };
    if (reg.status === "stale")
      return { status: "reg_stale", reg_id: reg.reg_id };
    return { status: "unknown" };
  }
  if (npo.status !== "marked") {
    throw new Error(
      `stripe disconnect of ${acct} was not settled (${npo.status})`
    );
  }

  // pooled pays out over wise to the default bank details, the grants run's
  // recipient: without them, and with the stripe account gone, nothing the
  // npo is given reaches it
  if (!(await npo_default_bapp(npo.npo_id))) {
    // awaited: a lost notice fails the delivery, and the redelivery re-stamps
    // as a no-op. keyed on the event, so it collapses into one notice
    await enqueue(
      msg("fiat-notice", {
        id: ev.id,
        alert: {
          type: "NOTICE",
          from: `stripe-connect-${stage}`,
          title: "Disconnected Nonprofit Has No Way To Get Paid",
          body: [
            `npo ${npo.npo_id} disconnected stripe account ${acct} (event ${ev.id}).`,
            "it has no default bank details and no stripe account left: every donation is held in its better giving balance until it adds bank details or reconnects stripe.",
          ].join("\n"),
        },
      })
    );
  }
  return npo;
}
