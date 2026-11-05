import { type ActionFunction, href, redirect } from "react-router";
import { literal, object, safeParse, variant } from "valibot";
import { review_get } from "#/routes/platform.applications_.$id/api";
import { resp } from "@/helpers/https";
import { msg } from "@/queue";
import { Progress } from "@/reg/progress";
import { reg_id } from "@/reg/schema";
import { $ } from "@/schemas";
import { stripe as stripe_env } from "$/env";
import { enqueue, in_dedupe_window } from "$/kit/queue";
import { db } from "$/pg/db";
import { reg_get, reg_update_from } from "$/pg/queries/registration";
import type { Route } from "./+types/route";
import { announce_approval, npo_new } from "./npo-new";

export { ErrorModal as ErrorBoundary } from "#/components/error";
export { default } from "./prompt";

const approval = object({ type: literal("approved") });
const rejection = object({
  type: literal("rejected"),
  reason: $,
});
export const schema = variant("type", [approval, rejection]);

/** the detail page disables Approve; this keeps the URL from going around it */
export const loader = async (args: Route.LoaderArgs) => {
  if (args.params.verdict !== "approved") return null;
  const { approvable } = await review_get(args.params.id);
  if (!approvable) {
    throw redirect(href("/platform/applications/:id", { id: args.params.id }));
  }
  return null;
};

export const action: ActionFunction = async ({ request, params }) => {
  const fv: { reason?: string } | null | undefined = await request
    .json()
    .catch(() => undefined);
  if (!fv) throw resp.status(400, "invalid body");

  const p1 = safeParse(reg_id, params.id);
  if (p1.issues) throw resp.status(400, p1.issues[0].message);
  const id = p1.output;
  const p2 = safeParse(schema, {
    type: params.verdict,
    reason: fv.reason ?? "",
  });
  if (p2.issues) throw resp.status(400, p2.issues[0].message);
  const verdict = p2.output;

  const reg = await reg_get(id);
  if (!reg) throw new Response("Registration not found", { status: 404 });

  // a row already at this verdict's status is a repeat of it: a retry after
  // its response or enqueue was lost, or a stale prompt. inside qstash's dedupe
  // window it is announced again under the same keys; past it, it answers
  // success and enqueues nothing.
  const settled = verdict.type === "approved" ? "03" : "04";
  if (reg.status !== "02" && reg.status !== settled) {
    throw resp.status(
      409,
      `registration not in review, curr status:${reg.status}`
    );
  }

  if (verdict.type === "rejected") {
    const { row } = await reg_update_from(db, id, ["02"], {
      status: "04",
      status_rejected_reason: verdict.reason,
    });
    // a re-reject repeats the stored reason, or it is a second verdict
    if (row?.status !== "04" || row.status_rejected_reason !== verdict.reason) {
      throw resp.status(409, "registration not in review");
    }
    if (in_dedupe_window(row.updated_at)) {
      await enqueue(msg("reg-updated", row));
    }
    return redirect("../success");
  }
  if (reg.status === "03") {
    console.info("NPO approved:", await announce_approval(reg));
    return redirect("../success");
  }

  // only a new approval files banking; no need to look at fsa
  const r = new Progress(reg).banking_with(stripe_env.connect_routing);
  if (!r) throw resp.status(400, "registration has incomplete steps");
  const npo = await npo_new(r);
  console.info("NPO approved:", npo);
  return redirect("../success");
};
