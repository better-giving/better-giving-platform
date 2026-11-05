import { safeParse } from "valibot";
import { report_degraded_null } from "#/errors/report";
import { resp } from "@/helpers/https";
import type { IReg } from "@/reg";
import { reg_id } from "@/reg/schema";
import type { V2RecipientAccount } from "@/wise";
import { wise } from "$/kit/wise";
import { reg_get } from "$/pg/queries/registration";
import type { Route } from "./+types/route";

export interface LoaderData {
  reg: IReg;
  wacc: V2RecipientAccount | null;
  /** wise was unreachable — distinct from an application carrying no account */
  wacc_unavailable: boolean;
}

export const loader = ({ params }: Route.LoaderArgs) => review_get(params.id);

/** the review a reviewer reads, from a URL's `:id` */
export const review_get = async (raw_id: string): Promise<LoaderData> => {
  const p = safeParse(reg_id, raw_id);
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const id = p.output;

  const reg = await reg_get(id);
  if (!reg) throw new Response("Registration not found", { status: 404 });

  // a wise outage must not take the page down with it: the page's other rows
  // come off our own row and are what a reviewer needs. approval does read the
  // account — `$verdict/npo-new.ts` feeds `longAccountSummary` into the banking
  // app — so where a bank is on file, Approve is gated on the account in
  // `loaded.tsx`; reject is not.
  const wacc = reg.o_bank_id
    ? await wise.v2_account(+reg.o_bank_id).catch(report_degraded_null)
    : null;

  return {
    reg,
    wacc,
    wacc_unavailable: !!reg.o_bank_id && !wacc,
  };
};
