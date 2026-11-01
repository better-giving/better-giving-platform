import { admin_ctx } from "#/.server/auth";
import { resp, search } from "@/helpers/https";
import { subscription_dists } from "$/pg/queries/subscription";
import type { Route } from "./+types/admin.$id.subscribers.dists";

export const loader = async (x: Route.LoaderArgs) => {
  const npo_id = x.context.get(admin_ctx);
  const { sub_ids } = search(x.url);
  if (!sub_ids) throw resp.status(400, "sub_ids required");
  return { dists: await subscription_dists(npo_id, sub_ids.split(",")) };
};
