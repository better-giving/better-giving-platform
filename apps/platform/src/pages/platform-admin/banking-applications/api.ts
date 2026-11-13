import { valibotResolver } from "@hookform/resolvers/valibot";
import type { ActionFunction, LoaderFunctionArgs } from "react-router";
import { getValidatedFormData } from "remix-hook-form";
import * as v from "valibot";
import { safeParse } from "valibot";
import { redirectWithSuccess } from "#/.server/toast";
import { report_degraded, report_degraded_null } from "#/errors/report";
import { is_approvable } from "#/routes/platform.banking-applications_.$id/approvable";
import type { IBapp, IUpdate } from "@/banking";
import { holder_match, type THolderMatch } from "@/banking/holder-match";
import { update } from "@/banking/schema";
import { resp } from "@/helpers/https";
import { msg } from "@/queue";
import { $int_gte1 } from "@/schemas";
import type { V2RecipientAccount } from "@/wise";
import { enqueue } from "$/kit/queue";
import { wise } from "$/kit/wise";
import {
  is_own_recipient,
  OWN_ACCOUNT_REFUSAL,
  OWN_LOOKUP_REFUSAL,
} from "$/payouts/own-accounts";
import { npo_return_hold } from "$/payouts/resend-returned";
import {
  bapp_approve,
  bapp_get,
  bapp_update_status,
  npo_legal_names,
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
  /** stored when the application was filed, else wise's name for the account */
  account_holder: string | null;
  /** the name the npo registered under; absent when the npo row is gone */
  legal_name?: string;
  holder_match: THolderMatch;
  /** the account is one of Better Giving's own wise balances; false when
   * that couldn't be checked, which the approve action refuses on */
  own_account: boolean;
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
  const [y, [npo], legal] = await Promise.all([
    wise.v2_account(bank_id).catch(report_degraded_null),
    npos_batch_get([x.npo_id]),
    npo_legal_names([x.npo_id]),
  ]);
  const own_account = y
    ? await is_own_recipient(y).catch((err) => {
        report_degraded(err);
        return false;
      })
    : false;
  const account_holder = x.account_holder ?? y?.name?.fullName ?? null;
  const legal_name = legal.get(x.npo_id);
  return {
    ba: x,
    id: bank_id,
    ...(y ?? {}),
    wacc_unavailable: !y,
    npo_name: npo?.name,
    account_holder,
    legal_name,
    holder_match: holder_match(account_holder, legal_name),
    own_account,
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
    if (!wacc || !is_approvable({ ba: x, wacc_unavailable: false })) {
      throw resp.status(409);
    }
    // fail closed: a payout to our own balance is the money never reaching the npo
    const own = await is_own_recipient(wacc).catch(report_degraded_null);
    if (own === null) throw resp.refuse(OWN_LOOKUP_REFUSAL, 409);
    if (own) throw resp.refuse(OWN_ACCOUNT_REFUSAL, 409);

    const holder = x.account_holder ?? wacc.name?.fullName ?? null;
    const legal = (await npo_legal_names([x.npo_id])).get(x.npo_id);
    const matched = holder_match(holder, legal);
    if (matched === "mismatch" && !fv.data.confirm_holder) {
      throw resp.refuse(
        `The account holder, ${holder}, doesn't match the nonprofit's legal name, ${legal}. Confirm the account holder to approve this account.`,
        409
      );
    }
    if (matched === "no_legal_name" && !fv.data.confirm_holder) {
      throw resp.refuse(
        `The nonprofit has no legal name on file to check the account holder, ${holder}, against. Confirm the account holder to approve this account.`,
        409
      );
    }
    // a held npo's old default is the account that bounced: the replacement
    // has to be the one the grants run pays, or `banking-approved` releases
    // nothing. read before the write, which is safe: the hold keys on the
    // current default, not on this application
    const held = Boolean(await npo_return_hold(x.npo_id));
    // auto-default when nothing pays out yet: rejected and pending rows don't count
    const prev = await bapp_approve(bank_id.toString(), x.npo_id, {
      as_default: held,
    });
    // a verdict that landed after the read above stands, and nothing applied
    if (prev?.status !== "under-review") {
      throw resp.status(409, "This application is no longer under review.");
    }
    await enqueue(msg("banking-approved", { npo_id: x.npo_id }));
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
