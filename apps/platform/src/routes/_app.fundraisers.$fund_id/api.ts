import { href } from "react-router";
import { safeParse, union } from "valibot";
import { get_fund } from "#/.server/fund";
import { segment } from "#/api/schema/segment";
import { moved } from "#/helpers/moved";
import type { IFund } from "#/types/fund";
import { fund_id } from "@/fundraiser/schema";
import { resp } from "@/helpers/https";
import { campaign_by_legacy_fund } from "$/pg/queries/campaign";
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
  // a fund folded into a campaign lives there now; an unfolded fund still renders
  const campaign = await campaign_by_legacy_fund(fund.id);
  if (campaign) throw campaign_moved(campaign, url.search);
  return {
    ...fund,
    url: url.toString(),
    now: new Date().toISOString(),
  } satisfies LoaderData;
};
