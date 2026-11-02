import { valibotResolver } from "@hookform/resolvers/valibot";
import type { ActionFunction, LoaderFunctionArgs } from "react-router";
import { getValidatedFormData } from "remix-hook-form";
import * as v from "valibot";
import { safeParse } from "valibot";
import { redirectWithSuccess } from "#/.server/toast";
import { report_degraded_null } from "#/errors/report";
import { is_approvable } from "#/routes/platform.banking-applications_.$id/approvable";
import type { IBapp, IUpdate } from "@/banking";
import { update } from "@/banking/schema";
import { resp } from "@/helpers/https";
import { msg } from "@/queue";
import { $int_gte1 } from "@/schemas";
import type { V2RecipientAccount } from "@/wise";
import { enqueue } from "$/kit/queue";
import { wise } from "$/kit/wise";
import {
  bapp_get,
  bapp_update_status,
  npo_bapp_count,
} from "$/pg/queries/banking";
import { npos_batch_get } from "$/pg/queries/npo";

export type LoaderData = Partial<V2RecipientAccount> & {
  ba: IBapp;
  /** the wise account id, which is also the application's — carried separately
   * so it still renders when wise is unreachable */
  id: number;
  /** wise was unreachable; the account may still exist */
  wacc_unavailable: boolean;
  /** absent when the npo row is gone */
  npo_name?: string;
};

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const p = safeParse($int_gte1, params.id);
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const bank_id = p.output;

  const x = await bapp_get(bank_id.toString());
  if (!x) throw resp.status(404);

  // a wise outage must not take the review page down with it: the application
  // row, the uploaded bank statement and Reject are all ours. approving one the
  // reviewer cannot see is the actual defect, so `loaded.tsx` gates Approve on
  // this flag — same split as `platform.applications_.$id`.
  const [y, [npo]] = await Promise.all([
    wise.v2_account(bank_id).catch(report_degraded_null),
    npos_batch_get([x.npo_id]),
  ]);
  return {
    ba: x,
    id: bank_id,
    ...(y ?? {}),
    wacc_unavailable: !y,
    npo_name: npo?.name,
  } satisfies LoaderData;
};

export const action: ActionFunction = async ({ params, request }) => {
  const fv = await getValidatedFormData<IUpdate>(
    request,
    valibotResolver(update)
  );
  if (fv.errors) return fv;

  const p_id = v.safeParse($int_gte1, params.id);
  if (p_id.issues) throw resp.status(400, p_id.issues[0].message);
  const bank_id = p_id.output;

  const x = await bapp_get(bank_id.toString());
  if (!x) throw resp.status(404, `Bank:${bank_id} not found`);

  if (fv.data.type === "approved") {
    // the detail page disables Approve and the approve route redirects when
    // the application isn't approvable; a POST sent around both must not land
    const wacc = await wise.v2_account(bank_id).catch(report_degraded_null);
    if (!is_approvable({ ba: x, wacc_unavailable: !wacc })) {
      throw resp.status(409);
    }
    // auto-default if npo has no other banking apps
    const count = await npo_bapp_count(x.npo_id);
    const new_status = count <= 1 ? "default" : "approved";
    const prev = await bapp_update_status(bank_id.toString(), {
      status: new_status,
    });
    if (prev?.status === "under-review") {
      await enqueue(msg("banking-approved", { npo_id: x.npo_id }));
    }
  } else {
    const prev = await bapp_update_status(bank_id.toString(), {
      status: fv.data.type,
      rejection_reason: fv.data.reason,
    });
    if (prev?.status === "under-review") {
      await enqueue(msg("banking-rejected", { npo_id: x.npo_id }));
    }
  }
  return redirectWithSuccess("../success", "Application updated");
};
