import { href } from "react-router";
import { safeParse, union } from "valibot";
import { get_fund } from "#/.server/fund";
import { segment } from "#/api/schema/segment";
import { moved } from "#/helpers/moved";
import type { IFund } from "#/types/fund";
import { fund_id } from "@/campaign/schema";
import { resp } from "@/helpers/https";
import {
  campaign_by_legacy_fund,
  type IFoldedCampaign,
} from "$/pg/queries/campaign";
import type { Route } from "./+types/route";

/** the public campaign page an org fund was folded into */
export function campaign_moved(
  campaign: {
    slug: string;
    owner_npo_id: number | null;
    owner_slug: string | null;
  },
  search: string
) {
  const org = campaign.owner_slug ?? String(campaign.owner_npo_id);
  return moved(
    `${href("/org/:org/:campaign", { org, campaign: campaign.slug })}${search}`
  );
}

/** whether a folded fund should hand its public page/donate flow to its
 * campaign. Two guards keep a 301 from sending a donor somewhere worse than the
 * fund's own page:
 * - the campaign page must be what the public would actually see — non-draft,
 *   owner published and active — the same rule `/org/:org/:campaign` enforces;
 *   otherwise the 301 lands on a 404.
 * - the fund must have at most one beneficiary. The campaign donate form pays
 *   the owner npo alone, so a multi-beneficiary fund would silently drop its
 *   co-beneficiaries' share; those keep the fund flow. */
export function folded_campaign_public(
  campaign: IFoldedCampaign | undefined,
  member_count: number
): campaign is IFoldedCampaign {
  if (!campaign) return false;
  if (member_count > 1) return false;
  return (
    campaign.status !== "draft" &&
    campaign.owner_published === true &&
    campaign.owner_active === true
  );
}

export interface LoaderData extends IFund {
  url: string;
  /** the request's time as ISO, so server and client render one status */
  now: string;
}

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

const schema = union([fund_id, segment]);

export const loader = async ({ request, params }: Route.LoaderArgs) => {
  const url = new URL(request.url);
  const p = safeParse(schema, params.fund_id);
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const fund = await get_fund(p.output);
  if (!fund) throw new Response(null, { status: 404 });
  // a fund folded into a campaign lives there now; an unfolded fund still
  // renders here. redirect only when `folded_campaign_public` allows it, else
  // keep serving the fund page
  const campaign = await campaign_by_legacy_fund(fund.id);
  if (folded_campaign_public(campaign, fund.members.length)) {
    throw campaign_moved(campaign, url.search);
  }
  return {
    ...fund,
    url: url.toString(),
    now: new Date().toISOString(),
  } satisfies LoaderData;
};
