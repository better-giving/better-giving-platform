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
import { reg_get, reg_update_from } from "$/pg/queries/registration";

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

  const prog = new Progress(reg);
  const r = prog.banking_with(stripe_env.connect_routing);
  if (!r) throw resp.status(400, not_ready(prog, stripe_env.connect_routing));

  if (user.email !== r.r_id && user.role !== "admin") {
    throw resp.status(403);
  }

  //reset previous review
  const { won, row } = await reg_update_from(db, r.id, EDITABLE, {
    status: "02",
    status_rejected_reason: null,
  });
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
  return routing_on && prog.stripe_eligible
    ? "You need a bank account or a Stripe account to get paid. Add one to submit."
    : "Stripe isn't available to this nonprofit, so it needs a bank account. Add one to submit.";
};
