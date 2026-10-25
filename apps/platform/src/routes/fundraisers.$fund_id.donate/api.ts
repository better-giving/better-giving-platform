import { safeParse, union } from "valibot";
import { get_session } from "#/.server/auth";
import { get_fund } from "#/.server/fund";
import { segment } from "#/api/schema/segment";
import {
  campaign_moved,
  folded_campaign_public,
} from "#/routes/_app.fundraisers.$fund_id/api";
import type { AuthUser } from "#/types/auth";
import type { IFund } from "#/types/fund";
import { fund_id } from "@/fundraiser/schema";
import { resp } from "@/helpers/https";
import { campaign_by_legacy_fund } from "$/pg/queries/campaign";
import type { Route } from "./+types/route";

export interface LoaderData {
  user: AuthUser | undefined;
  fund: IFund;
  /** the request's time as ISO, so server and client first render one state */
  now: string;
  base_url: string;
}

const schema = union([fund_id, segment]);

export const loader = async ({ params, request }: Route.LoaderArgs) => {
  const { user } = await get_session(request);
  const p = safeParse(schema, params.fund_id);
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const id = p.output;
  const fund = await get_fund(id);
  if (!fund) throw new Response(null, { status: 404 });
  // the campaign page carries the donation form; a folded fund donates there.
  // redirect only when `folded_campaign_public` allows it, else keep serving the
  // fund's own donate page
  const campaign = await campaign_by_legacy_fund(fund.id);
  if (folded_campaign_public(campaign, fund.members.length)) {
    throw campaign_moved(campaign, new URL(request.url).search);
  }

  return {
    user,
    fund,
    now: new Date().toISOString(),
    base_url: new URL(request.url).origin,
  } satisfies LoaderData;
};
