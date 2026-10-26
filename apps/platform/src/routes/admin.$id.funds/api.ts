import { href, redirect } from "react-router";
import { safeParse } from "valibot";
import { admin_ctx } from "#/.server/auth";
import { dataWithError, dataWithSuccess } from "#/.server/toast";
import { fund_id } from "@/campaign/schema";
import { resp } from "@/helpers/https";
import { msg } from "@/queue";
import { enqueue } from "$/kit/queue";
import {
  fund_get_or_slug,
  fund_has_member,
  fund_member_remove,
  fund_members_get,
} from "$/pg/queries/fund";
import type { Route } from "./+types/route";
import { fund_creator } from "./creator";

export const loader = ({ request, context }: Route.LoaderArgs) => {
  const id = context.get(admin_ctx);
  const creator = fund_creator(
    new URL(request.url).searchParams.get("creator")
  );
  const q = new URLSearchParams({ tab: "supporters" });
  if (creator) q.set("creator", creator);
  return redirect(`${href("/admin/:id/campaigns", { id: String(id) })}?${q}`);
};

export const action = async (x: Route.ActionArgs) => {
  const id = x.context.get(admin_ctx);

  const fv = await x.request.formData();
  const p = safeParse(fund_id, fv.get("fund_id"));
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const fid = p.output;

  const fund = await fund_get_or_slug(fid);
  if (!fund) return dataWithError(null, "Campaign not found");

  const is_member = await fund_has_member(fund.id, id);
  if (!is_member) {
    return dataWithError(null, "You're no longer part of this campaign.");
  }

  const members = await fund_members_get(fund.id);
  const removed = await fund_member_remove(fund.id, id, members.length === 1);
  if (removed) await enqueue(msg("fund-member-removed", removed));

  return dataWithSuccess(
    null,
    "You left this campaign. It will disappear from this list shortly."
  );
};
