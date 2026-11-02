import { admin_ctx } from "#/.server/auth";
import { resp, search } from "@/helpers/https";
import type { IPayout } from "@/referrals";
import type { IPage } from "$/pg/queries/helpers";
import { npo_get } from "$/pg/queries/npo";
import {
  type IOwedHistoryRow,
  referrer_owed_history,
} from "$/pg/queries/owed-history";
import { referrer_payout_list } from "$/pg/queries/referrer";
import type { Route } from "./+types/route";

export interface LoaderData extends IPage<IPayout> {
  owed?: IOwedHistoryRow[];
  referral_id: string | null;
}

export const loader = async (args: Route.LoaderArgs): Promise<LoaderData> => {
  const id = args.context.get(admin_ctx);

  const x = await npo_get(id);
  if (!x) throw resp.status(404);

  if (!x.referral_id) return { items: [], referral_id: null };

  const { nextKey: next } = search(args.url);
  // the history is the page's: a load-more reads only its payouts
  const [page, owed] = await Promise.all([
    referrer_payout_list(x.referral_id, { next, limit: 8 }),
    next ? undefined : referrer_owed_history({ referrer_npo: x.referral_id }),
  ]);
  return { ...page, ...(owed && { owed }), referral_id: x.referral_id };
};
