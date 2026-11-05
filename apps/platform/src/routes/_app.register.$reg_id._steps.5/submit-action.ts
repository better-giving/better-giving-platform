import { eq } from "drizzle-orm";
import { type ActionFunctionArgs, redirect } from "react-router";
import { safeParse } from "valibot";
import { get_session, to_auth } from "#/.server/auth";
import { dataWithSuccess } from "#/.server/toast";
import { wizard_exit } from "#/pages/registration/data/step-loader";
import { resp } from "@/helpers/https";
import { msg } from "@/queue";
import { Progress } from "@/reg/progress";
import { EDITABLE, reg_id } from "@/reg/schema";
import { stripe as stripe_env } from "$/env";
import { enqueue, in_dedupe_window } from "$/kit/queue";
import { db } from "$/pg/db";
import {
  reg_get,
  reg_update_from,
  type TRegAttrs,
} from "$/pg/queries/registration";
import { registrations } from "$/pg/schema/registration";
import { held_elsewhere, lock_acct } from "$/stripe-connect/target";

export const submit_action = async ({
  request,
  params,
  url,
}: ActionFunctionArgs) => {
  const { user } = await get_session(request);
  if (!user) return to_auth(url);

  const p = safeParse(reg_id, params.reg_id);
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const id = p.output;
  const reg = await reg_get(id);

  if (!reg) throw resp.status(404, `reg:${id} not found`);

  const routing_on = stripe_env.connect_routing;
  const prog = new Progress(reg, routing_on);
  const r = prog.banking_with(routing_on);
  if (!r) throw resp.status(400, not_ready(prog, routing_on));

  if (user.email !== r.r_id && user.role !== "admin") {
    throw resp.status(403);
  }

  //reset previous review
  const to_review = { status: "02", status_rejected_reason: null } as const;
  const acct = r.o_stripe_account_id;
  const { won, row } = acct
    ? await submit_holding(r.id, acct, to_review)
    : await reg_update_from(db, r.id, EDITABLE, to_review);
  // in review on a miss too: an earlier press committed this submit. inside
  // qstash's dedupe window its message is enqueued again under the same key,
  // which reaches the queue only if the first enqueue never did. past the
  // window the press answers submitted and enqueues nothing, since the same
  // key would send again.
  if (row?.status !== "02") {
    const exit = row && wizard_exit(row, 5);
    if (exit) return redirect(exit);
    throw resp.status(
      409,
      "This application has already been submitted or approved."
    );
  }
  if (in_dedupe_window(row.updated_at)) {
    await enqueue(msg("reg-updated", row));
  }

  return dataWithSuccess(
    // a resubmit after rejection, or a press another one beat, is no new signup
    { first: won && reg.status !== "04" },
    "Your application has been submitted. We will get back to you soon!"
  );
};

/** why `prog` can't submit, in the applicant's words once only step 4 is left */
const not_ready = (prog: Progress, routing_on: boolean) => {
  if (prog.step < 4) return "Registration not ready for submission";
  if (!prog.stripe_eligible) {
    return "Stripe isn't available to this nonprofit, so it needs a bank account. Add one to submit.";
  }
  if (!routing_on) {
    return "We aren't paying out through Stripe right now, so you need a bank account to get paid. Add one to submit.";
  }
  return "You need a bank account or a Stripe account to get paid. Add one to submit.";
};

/** the submit of a registration holding `acct`, under the claim lock. a claim
 * elsewhere skips a rejected holder in `held_elsewhere`, and its
 * `release_rejected` skips one already back in review, so a resubmit racing
 * that claim would leave both holding the account: only the resubmit, holding
 * the same lock, can see the other claim and refuse */
const submit_holding = (id: string, acct: string, attrs: TRegAttrs) =>
  db.transaction(async (tx) => {
    await lock_acct(tx, acct);
    if (await held_elsewhere(acct, { kind: "reg", reg_id: id }, tx)) {
      throw resp.status(
        409,
        "This Stripe account is now connected elsewhere on Better Giving. Connect a different account or add a bank account, then submit again."
      );
    }
    const res = await reg_update_from(
      tx,
      id,
      EDITABLE,
      attrs,
      eq(registrations.o_stripe_account_id, acct)
    );
    // still editable, so the account moved off this row since it was read
    if (!res.won && res.row?.status && EDITABLE.includes(res.row.status)) {
      throw resp.status(
        409,
        "Your banking details changed while you were submitting. Check them and submit again."
      );
    }
    return res;
  });
