import { admin_ctx } from "#/.server/auth";
import { referred_by } from "#/.server/referrals";
import type { Referred } from "#/types/referrals";
import type { IBapp } from "@/banking";
import { resp } from "@/helpers/https";
import type { IPageKeyed } from "@/types/api";
import { npo_default_bapp } from "$/pg/queries/banking";
import { type INpoDonation, referrer_donations } from "$/pg/queries/dist";
import { npo_get } from "$/pg/queries/npo";
import { payout_ltd_get, pending_earnings } from "$/pg/queries/referrer";
import type { Route } from "./+types/route";
import { config } from "./config";

export interface LoaderData {
  id: string;
  /** null until the npo is issued one; every other field is then empty */
  referral_id: string | null;
  referreds: Referred[];
  earnings: IPageKeyed<INpoDonation>;
  pending_total: number;
  payout?: IBapp;
  payout_ltd: number;
  payout_min?: number;
  base_url: string;
}

export const loader = async (x: Route.LoaderArgs): Promise<LoaderData> => {
  const id = x.context.get(admin_ctx);

  const endow = await npo_get(id);
  if (!endow) throw resp.status(404, `npo:${id} not found`);

  if (!endow.referral_id) {
    return {
      id: "",
      referral_id: null,
      base_url: x.url.origin,
      referreds: [],
      earnings: { items: [] },
      pending_total: 0,
      payout_ltd: 0,
    };
  }

  const [pending_total, referreds, earnings, p, payout_ltd] = await Promise.all(
    [
      pending_earnings(endow.referral_id),
      referred_by(endow.referral_id),
      referrer_donations(endow.referral_id, { limit: 4 }),
      npo_default_bapp(endow.id),
      payout_ltd_get(endow.referral_id),
    ]
  );

  return {
    id: endow.referral_id,
    referral_id: endow.referral_id,
    base_url: x.url.origin,
    referreds,
    earnings,
    pending_total,
    payout: p,
    payout_min: config.pay_min,
    payout_ltd,
  };
};
