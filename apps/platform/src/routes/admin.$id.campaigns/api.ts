import { admin_ctx, user_ctx } from "#/.server/auth";
import { get_funds_npo_memberof } from "#/.server/funds";
import { resp } from "@/helpers/https";
import { campaign_list, campaign_shown_status } from "$/pg/queries/campaign";
import { npo_get } from "$/pg/queries/npo";
import type { Route } from "./+types/route";

export const loader = async ({ context, request }: Route.LoaderArgs) => {
  const id = context.get(admin_ctx);
  const endow = await npo_get(id);
  if (!endow) throw resp.status(404);

  const url = new URL(request.url);
  // "fundraisers" is this tab's previous query value; an old bookmarked link
  // must keep landing on the supporters view
  const tab = url.searchParams.get("tab");
  if (tab === "supporters" || tab === "fundraisers") {
    // org-created funds list on Your campaigns; a stale ?creator= is ignored
    const funds = await get_funds_npo_memberof(id, { creator: "others" });
    return {
      view: "supporters" as const,
      endow,
      funds,
      user: context.get(user_ctx),
    };
  }

  // org funds fold into campaigns (BG-1943). a folded fund lives on as its
  // campaign, so it is excluded here; an org fund not yet folded (the backfill
  // is gated) still lists alongside the real campaigns so it never vanishes
  const [campaigns, org_funds] = await Promise.all([
    campaign_list(id),
    get_funds_npo_memberof(id, { creator: "ours", exclude_folded: true }),
  ]);
  return {
    view: "campaigns" as const,
    endow,
    campaigns: campaigns.map((c) => ({
      ...c,
      status_label: campaign_shown_status(c),
    })),
    org_funds,
  };
};
