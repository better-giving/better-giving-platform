import { admin_ctx } from "#/.server/auth";
import { resp, search } from "@/helpers/https";
import type { IPageKeyed } from "@/types/api";
import { type INpoDonation, referrer_donations } from "$/pg/queries/dist";
import { npo_get } from "$/pg/queries/npo";
import type { Route } from "./+types/route";

export interface LoaderData extends IPageKeyed<INpoDonation> {
  referral_id: string | null;
}

export const loader = async (args: Route.LoaderArgs): Promise<LoaderData> => {
  const { nextKey } = search(args.url);
  const id = args.context.get(admin_ctx);

  const x = await npo_get(id);
  if (!x) throw resp.status(404);

  if (!x.referral_id) return { items: [], referral_id: null };
  const page = await referrer_donations(x.referral_id, {
    limit: 4,
    next: nextKey,
  });
  return { ...page, referral_id: x.referral_id };
};
