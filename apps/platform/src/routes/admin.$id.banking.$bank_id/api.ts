import * as v from "valibot";
import { admin_ctx } from "#/.server/auth";
import { dataWithError, dataWithSuccess } from "#/.server/toast";
import { report_degraded_null } from "#/errors/report";
import { resp } from "@/helpers/https";
import { msg } from "@/queue";
import { $int_gte1 } from "@/schemas";
import { enqueue } from "$/kit/queue";
import { wise } from "$/kit/wise";
import { bapp_get, bapp_set_default } from "$/pg/queries/banking";
import type { Route } from "./+types/route";

export const loader = async (args: Route.LoaderArgs) => {
  const p = v.safeParse($int_gte1, args.params.bank_id);
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const bank_id = p.output;
  const npo_id = args.context.get(admin_ctx);

  const x = await bapp_get(bank_id.toString());
  if (!x || x.npo_id !== npo_id) throw resp.status(404);

  // a wise outage must not take the payout method down with it: its status, the
  // uploaded bank statement, Delete and Set Default are all ours. neither action
  // reads the account, so both stay live — the page just can't show the numbers.
  const y = await wise.v2_account(bank_id).catch(report_degraded_null);
  return { ...(y ?? {}), id: bank_id, ba: x, wacc_unavailable: !y };
};

export const default_action = async (args: Route.ActionArgs) => {
  const p_id = v.safeParse($int_gte1, args.params.bank_id);
  if (p_id.issues) throw resp.status(400, p_id.issues[0].message);
  const bank_id = p_id.output;
  const npo_id = args.context.get(admin_ctx);

  const x = await bapp_get(bank_id.toString());
  if (!x || x.npo_id !== npo_id) {
    return dataWithError(null, "Payout method not found");
  }
  if (x.status === "default") {
    return dataWithSuccess(null, "Payout method set as default");
  }
  if (x.status !== "approved") {
    return dataWithError(
      null,
      "Only an approved payout method can be set as default"
    );
  }

  // re-checked in the write: the method can change state after the read above
  const promoted = await bapp_set_default(bank_id.toString(), npo_id);
  if (!promoted) {
    return dataWithError(
      null,
      "Only an approved payout method can be set as default"
    );
  }
  await enqueue(msg("banking-default", { npo_id }));
  return dataWithSuccess(null, "Payout method set as default");
};
