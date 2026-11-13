import { banking } from "emails";
import { report_error } from "#/errors/report";
import type { IBankingPayload } from "@/queue";
import { send_email_or_throw } from "$/email";
import { base_url, stage } from "$/env";
import { aws_monitor } from "$/kit/slack";
import { resend_returned } from "$/payouts/resend-returned";
import { npo_admins } from "$/pg/queries/user";

/** the account grants pay may have changed: payouts held after a returned
 * transfer go out again with the next grants run. idempotent, so a retried
 * message moves nothing twice */
async function release_returned(npo_id: number) {
  const res = await resend_returned(npo_id);
  if (res.status === "none") return;
  const a =
    res.status === "resent"
      ? {
          type: "NOTICE" as const,
          title: `Returned payouts re-sent for npo:${npo_id}`,
          body: "a new bank account was approved: these payouts whose transfer came back are pending again and go out with the next grants run",
          fields: [{ name: "payout_ids", value: res.ids.join(", ") }],
        }
      : {
          type: "ERROR" as const,
          title: `Returned payouts still held for npo:${npo_id}`,
          body: `a bank account was approved or made default, but payouts whose transfer came back stay held: ${res.reason}. make the new account the npo's default to send them`,
        };
  try {
    await aws_monitor.send_alert({ ...a, from: `wise-returns:${stage}` });
  } catch (err) {
    report_error(err, { alert: a.title });
  }
}

async function send_banking_email(
  npo_id: number,
  template_data: Omit<banking.IData, "base_url">
) {
  const admins = await npo_admins(npo_id);
  if (admins.length === 0) return;
  const { node, subject } = banking.template({ ...template_data, base_url });
  await send_email_or_throw({ node, subject, to: admins.map((a) => a.email) });
}

export async function handle_banking_new_account(data: IBankingPayload) {
  await send_banking_email(data.npo_id, {
    action: "new",
    account_summary: data.bank_summary ?? "",
  });
}

export async function handle_banking_approved(data: IBankingPayload) {
  await release_returned(data.npo_id);
  await send_banking_email(data.npo_id, {
    action: "approved",
    account_summary: data.bank_summary ?? "",
  });
}

export async function handle_banking_rejected(data: IBankingPayload) {
  await send_banking_email(data.npo_id, {
    action: "rejected",
    account_summary: data.bank_summary ?? "",
    rejection_reason: data.rejection_reason,
  });
}

export async function handle_banking_set_default(data: IBankingPayload) {
  await release_returned(data.npo_id);
  await send_banking_email(data.npo_id, {
    action: "default",
    account_summary: data.bank_summary ?? "",
  });
}
