import { CronExpressionParser } from "cron-parser";
import { admin_ctx } from "#/.server/auth";
import { endowUpdate } from "#/pages/admin/endow-update-action";
import type { IBapp } from "@/banking";
import { GRANTS_CRON, GRANTS_EXEC_DELAY_DAYS } from "@/constants/grants";
import type { IComposition } from "@/nav/interfaces";
import type { IPayout } from "@/payouts";
import { payout_to, type TPayoutTo } from "@/payouts/payout-to";
import type { IPageKeyed } from "@/types/api";
import { stripe as stripe_env } from "$/env";
import { npo_bapp_in_review, npo_default_bapp } from "$/pg/queries/banking";
import { campaign_count, campaign_live_count } from "$/pg/queries/campaign";
import { nav_ltd } from "$/pg/queries/nav";
import { npo_get } from "$/pg/queries/npo";
import type { SettlementRow } from "$/pg/queries/payout";
import { npo_payouts, npo_settlements } from "$/pg/queries/payout";
import type { Route } from "./+types/route";

export interface DashboardData {
  id: number;
  bal_liq: number;
  bal_lock: number;
  bal_cash: number;
  /** compute in server save client bundle */
  recent_payouts: IPageKeyed<IPayout>;
  recent_settlements: IPageKeyed<SettlementRow>;
  next_payout: string;
  pm?: IBapp;
  payout_to: TPayoutTo;
  /** no default bank, and one filed waits for review */
  bank_pending: boolean;
  composition: IComposition;
  total_inv_value: number;
  campaign_count: number;
  campaign_live: number;
}

export const endowUpdateAction = endowUpdate({ redirect: "." });
export const loader = async (x: Route.LoaderArgs) => {
  const id = x.context.get(admin_ctx);

  const interval = CronExpressionParser.parse(GRANTS_CRON);
  const prev = interval.prev().toDate();
  const ms_delay = GRANTS_EXEC_DELAY_DAYS * 24 * 60 * 60 * 1000;
  const exec_from_prev = new Date(prev.getTime() + ms_delay);

  // if prev trigger's execution hasn't happened yet, that's the next payout
  const next =
    exec_from_prev > new Date()
      ? exec_from_prev
      : new Date(interval.next().toDate().getTime() + ms_delay);

  const [
    ltd,
    npo,
    recent_payouts,
    recent_settlements,
    pm,
    in_review,
    count,
    live,
  ] = await Promise.all([
    nav_ltd(),
    npo_get(id),
    npo_payouts(id, { limit: 3 }),
    npo_settlements(id, { limit: 3 }),
    npo_default_bapp(id),
    npo_bapp_in_review(id),
    campaign_count(id),
    campaign_live_count(id),
  ]);

  return {
    id,
    bal_liq: npo?.liq ?? 0,
    bal_lock: (npo?.lock_units ?? 0) * ltd.price,
    bal_cash: npo?.cash ?? 0,
    recent_payouts,
    recent_settlements,
    next_payout: next.toISOString(),
    pm,
    payout_to: payout_to(pm, npo, stripe_env.connect_routing),
    bank_pending: !pm && in_review,
    composition: ltd.composition,
    total_inv_value: ltd.value,
    campaign_count: count,
    campaign_live: live,
  } satisfies DashboardData;
};
