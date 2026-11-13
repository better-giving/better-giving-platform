import type { ActionFunction } from "react-router";
import * as v from "valibot";
import { admin_ctx } from "#/.server/auth";
import { redirectWithSuccess } from "#/.server/toast";
import { report_degraded_null } from "#/errors/report";
import { routes } from "#/pages/admin/routes";
import { new_bank as schema } from "@/banking/schema";
import { resp } from "@/helpers/https";
import { msg } from "@/queue";
import { enqueue } from "$/kit/queue";
import { wise } from "$/kit/wise";
import { is_own_recipient } from "$/payouts/own-accounts";
import { db } from "$/pg/db";
import { bapp_get, bapp_put, npo_bapp_count } from "$/pg/queries/banking";

export const action: ActionFunction = async (args) => {
  const payload = await args.request.json();
  const p = v.safeParse(schema, payload);
  if (p.issues) return resp.fail(400, p.issues[0].message);
  const x = p.output;
  // `npo_admin_mdlwr` vouches for the url's npo only; the body's id is the client's say-so
  const npo_id = args.context.get(admin_ctx);
  if (x.endowmentID !== npo_id)
    return resp.fail(
      403,
      "A payout method can only be added to your own nonprofit"
    );

  // read from wise, never the body
  const wacc = await wise
    .v2_account(+x.wiseRecipientID)
    .catch(report_degraded_null);
  // a failed lookup files it anyway: approval and every payout check again
  if (wacc && (await is_own_recipient(wacc).catch(report_degraded_null))) {
    return resp.fail(
      409,
      "This bank account belongs to Better Giving and can't receive your payouts. Add your nonprofit's own bank account."
    );
  }

  const count = await npo_bapp_count(npo_id);
  const filed =
    count < 10 &&
    (await bapp_put(db, {
      id: x.wiseRecipientID,
      npo_id,
      bank_summary: x.bankSummary,
      bank_statement_url: x.bankStatementFile.publicUrl,
      rejection_reason: "",
      status: "under-review",
      date_created: new Date().toISOString(),
    }));
  if (!filed) {
    const existing = await bapp_get(x.wiseRecipientID);
    if (!existing) return resp.fail(400, "Max 10 payout methods allowed");
    if (existing.npo_id !== npo_id) {
      return resp.fail(
        409,
        "This bank account is already registered to another nonprofit"
      );
    }
    if (existing.status === "rejected") {
      return resp.fail(
        409,
        "This bank account was rejected. Contact support, or use different account details."
      );
    }
    if (existing.status !== "under-review") {
      return resp.fail(409, "This bank account is already on file");
    }
    // a retried submit: its first try may have filed the row but failed to enqueue
  }
  // `banking.new_${npo_id}` dedupes, so a retry's second notice is collapsed
  await enqueue(msg("banking-new", { npo_id }));

  return redirectWithSuccess(
    `../${routes.banking}`,
    "Banking application submitted"
  );
};
