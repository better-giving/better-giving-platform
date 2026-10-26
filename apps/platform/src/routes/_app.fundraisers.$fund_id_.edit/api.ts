import { and, eq } from "drizzle-orm";
import { href } from "react-router";
import { safeParse } from "valibot";
import { type AuthUser, get_session, to_auth } from "#/.server/auth";
import { get_fund } from "#/.server/fund";
import { dataWithError, dataWithSuccess } from "#/.server/toast";
import { moved } from "#/helpers/moved";
import { slug_taken_message } from "#/routes/admin.$id.campaigns/copy";
import type { IFund } from "#/types/fund";
import { fund_id, fund_update } from "@/campaign/schema";
import { resp } from "@/helpers/https";
import { db } from "$/pg/db";
import { campaign_by_legacy_fund } from "$/pg/queries/campaign";
import {
  fund_by_slug,
  fund_close,
  fund_update as fund_update_fn,
} from "$/pg/queries/fund";
import { funds } from "$/pg/schema/fund";
import { user_fund_memberships, user_npo_memberships } from "$/pg/schema/user";
import type { Route } from "./+types/route";

export interface LoaderData {
  fund: IFund;
  base_url: string;
  user: AuthUser;
}

/** throws the 403 both loader and action answer a non-editor with */
const assert_fund_editor = async (
  user: AuthUser,
  fund: Pick<IFund, "id" | "npo_owner">
) => {
  if (user.role === "admin") return;
  const [fund_mem] = await db
    .select({ fund_id: user_fund_memberships.fund_id })
    .from(user_fund_memberships)
    .where(
      and(
        eq(user_fund_memberships.user_id, user.id),
        eq(user_fund_memberships.fund_id, fund.id)
      )
    )
    .limit(1);

  if (!fund_mem && fund.npo_owner) {
    const [npo_mem] = await db
      .select({ npo_id: user_npo_memberships.npo_id })
      .from(user_npo_memberships)
      .where(
        and(
          eq(user_npo_memberships.user_id, user.id),
          eq(user_npo_memberships.npo_id, fund.npo_owner)
        )
      )
      .limit(1);
    if (!npo_mem) throw resp.status(403);
  } else if (!fund_mem) {
    throw resp.status(403);
  }
};

export const loader = async ({ request, params }: Route.LoaderArgs) => {
  const { user } = await get_session(request);
  if (!user) return to_auth(request);

  const p_id = safeParse(fund_id, params.fund_id);
  if (p_id.issues) throw resp.status(400, p_id.issues[0].message);
  const id = p_id.output;

  const fund = await get_fund(id);
  if (!fund) throw resp.status(404);

  // a folded fund is edited as its campaign; the campaign editor gates access.
  // a multi-beneficiary fund keeps its own editor, because the campaign it was
  // folded into pays the owner npo alone (see `folded_campaign_public`)
  const campaign = await campaign_by_legacy_fund(fund.id);
  if (campaign?.owner_npo_id != null && fund.members.length <= 1) {
    throw moved(
      `${href("/admin/:id/campaigns/:campaign_id", {
        id: String(campaign.owner_npo_id),
        campaign_id: campaign.id,
      })}${new URL(request.url).search}`
    );
  }

  await assert_fund_editor(user, fund);

  const base_url = new URL(request.url).origin;

  return { fund, user, base_url } satisfies LoaderData;
};

export const action = async ({ request, params }: Route.ActionArgs) => {
  const { user } = await get_session(request);
  if (!user) return to_auth(request);

  const p_id = safeParse(fund_id, params.fund_id);
  if (p_id.issues) throw resp.status(400, p_id.issues[0].message);
  const id = p_id.output;

  const [fund] = await db
    .select({ id: funds.id, npo_owner: funds.npo_owner })
    .from(funds)
    .where(eq(funds.id, id));
  if (!fund) throw resp.status(404);
  await assert_fund_editor(user, fund);

  const { close = false, ...update } = await request.json();

  if (close) {
    await fund_close(id);
    return dataWithSuccess(null, "Campaign closed");
  }

  const p_upd = safeParse(fund_update, update);
  if (p_upd.issues) throw resp.status(400, p_upd.issues[0].message);
  const parsed = p_upd.output;

  // check if new slug is already taken (allow fund's own slug)
  if (parsed.slug) {
    const res = await fund_by_slug(parsed.slug);
    if (res && res.id !== id) {
      return dataWithError(null, slug_taken_message());
    }
  }

  await fund_update_fn(id, parsed);

  return dataWithSuccess(null, "Campaign updated");
};
