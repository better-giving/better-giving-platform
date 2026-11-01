import { user_ctx } from "#/.server/auth";
import { referred_by } from "#/.server/referrals";
import { report_degraded_null } from "#/errors/report";
import type { Referred } from "#/types/referrals";
import type { IPageKeyed } from "@/types/api";
import type { V2RecipientAccount } from "@/wise";
import { wise } from "$/kit/wise";
import { type INpoDonation, referrer_donations } from "$/pg/queries/dist";
import { payout_ltd_get, pending_earnings } from "$/pg/queries/referrer";
import { user_get } from "$/pg/queries/user";
import type { Route } from "./+types/route";

export interface LoaderData {
  referral_code: string;
  referreds: Referred[];
  earnings: IPageKeyed<INpoDonation>;
  pending_total: number;
  payout: V2RecipientAccount | null;
  payout_ltd: number;
  payout_min?: number;
  base_url: string;
  w_form?: string;
}

// a wise outage must not take the dashboard down with it: earnings, referreds
// and the payout total are all ours and are most of this page. a stored id that
// no longer parses is the same non-event — the row predates the checks in
// `dashboard.referrals_.payout/api.ts`.
function payout(raw: string) {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return wise.v2_account(id).catch(report_degraded_null);
}

export const loader = async ({ context, url }: Route.LoaderArgs) => {
  const user = context.get(user_ctx);
  const db_user = await user_get(user.email);
  if (!db_user) throw new Response("user not found", { status: 404 });

  // non-null: see `IUserRow`'s doc comment
  const referral_code = db_user.referral_code!;

  const [pending_total, referreds, earnings, p, payout_ltd] = await Promise.all(
    [
      pending_earnings(referral_code),
      referred_by(referral_code),
      referrer_donations(referral_code, { limit: 4 }),
      db_user.pay_id ? payout(db_user.pay_id) : null,
      payout_ltd_get(referral_code),
    ]
  );

  return {
    referral_code,
    base_url: url.origin,
    referreds,
    earnings,
    pending_total,
    payout: p,
    // non-null: see `IUserRow`'s doc comment
    payout_min: db_user.pay_min!,
    payout_ltd,
    w_form: db_user.w_form ?? undefined,
  } satisfies LoaderData;
};
