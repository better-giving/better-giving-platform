import { type AnyColumn, eq, isNull } from "drizzle-orm";
import { redirect } from "react-router";
import Stripe from "stripe";
import { consume, get_session } from "#/.server/auth";
import { report_error } from "#/errors/report";
import { resp } from "@/helpers/https";
import { EDITABLE } from "@/reg/schema";
import type { TConnectErrorReason } from "@/stripe-connect/return";
import { stripe as stripe_env } from "$/env";
import { stripe } from "$/kit/stripe";
import { db } from "$/pg/db";
import { is_unique_violation } from "$/pg/errors";
import { npo_stripe_connect } from "$/pg/queries/npo";
import { reg_update_from } from "$/pg/queries/registration";
import { registrations } from "$/pg/schema/registration";
import { read_state, STATE_TTL_S } from "$/stripe-connect/state";
import { mirror_unset, sync_npo_account } from "$/stripe-connect/sync";
import {
  held_elsewhere,
  lock_acct,
  release_rejected,
  return_path,
  target_access,
} from "$/stripe-connect/target";
import type { Route } from "./+types/route";

/** stripe's oauth redirect. the code is never logged and the tokens it buys
 * are never kept: only the account id is. */
export async function loader({ request, url }: Route.LoaderArgs) {
  if (!stripe_env.connect_routing) return resp.status(404);
  const read = read_state(url.searchParams.get("state"));
  // unsigned, so its target can't be trusted as a place to send anyone
  if (read.status === "invalid") return resp.status(400, "invalid state");
  const { t, uid, nonce, replace } = read.state;
  const fail = (reason: TConnectErrorReason) =>
    redirect(return_path(t, "error", reason));

  // the one error stripe redirects with; the rest come back as json there
  if (url.searchParams.get("error") === "access_denied") {
    return redirect(return_path(t, "denied"));
  }
  if (read.status === "expired") return fail("expired");

  const { user } = await get_session(request);
  if (!user || user.id !== uid) return fail("forbidden");
  const access = await target_access(user, t);
  if (!access.ok) return fail("forbidden");
  if (access.replaces && !replace) return fail("replace_unconfirmed");

  const code = url.searchParams.get("code");
  if (!code) return fail("failed");
  // a second exchange of one code revokes the connection at stripe. this map
  // is per process, so it stops a double request, not a determined replay
  if (
    !consume(`stripe-connect-state:${nonce}`, { max: 1, window_s: STATE_TTL_S })
  ) {
    return fail("failed");
  }

  let acct: string | undefined;
  try {
    ({ stripe_user_id: acct } = await stripe.oauth.token({
      grant_type: "authorization_code",
      code,
    }));
  } catch (err) {
    if (!(err instanceof Stripe.errors.StripeError)) throw err;
    // not `err`: its message can quote the code
    report_error(new Error(`stripe connect code exchange failed: ${err.type}`));
    return fail("failed");
  }
  if (!acct) return fail("failed");

  // the account read by `target_access` must still be the one there: a
  // second tab connecting meanwhile would otherwise be replaced unconfirmed
  const held_as_read = (col: AnyColumn) =>
    access.acct ? eq(col, access.acct) : isNull(col);

  let claim: "connected" | TConnectErrorReason;
  try {
    claim = await db.transaction(async (tx) => {
      await lock_acct(tx, acct);
      if (await held_elsewhere(acct, t, tx)) return "already_linked";

      if (t.kind === "reg") {
        const { won, row } = await reg_update_from(
          tx,
          t.reg_id,
          EDITABLE,
          {
            o_stripe_account_id: acct,
            o_stripe_connected_at: new Date().toISOString(),
          },
          held_as_read(registrations.o_stripe_account_id)
        );
        if (won) {
          await release_rejected(acct, t, tx);
          return "connected";
        }
        // submitted between target_access above and this write
        return row?.status && EDITABLE.includes(row.status)
          ? "replace_unconfirmed"
          : "forbidden";
      }

      // the old account's flags must not stand for this one if the sync fails
      const written = await npo_stripe_connect(
        tx,
        t.npo_id,
        acct,
        access.acct,
        mirror_unset
      );
      if (!written) return "replace_unconfirmed";
      await release_rejected(acct, t, tx);
      return "connected";
    });
  } catch (err) {
    // a duplicate written before claims took the lock, now held by an npo
    if (is_unique_violation(err, "npos_stripe_account_id_unique")) {
      return fail("already_linked");
    }
    throw err;
  }
  if (claim !== "connected") return fail(claim);
  if (t.kind === "reg") return redirect(return_path(t, "connected"));

  try {
    await sync_npo_account(t.npo_id);
  } catch (err) {
    // connected regardless: account.updated or the next page load fills it
    if (!(err instanceof Stripe.errors.StripeError)) throw err;
    report_error(err);
  }
  return redirect(return_path(t, "connected"));
}
