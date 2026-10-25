import { sql } from "drizzle-orm";
import { bigint, integer, pgView, text } from "drizzle-orm/pg-core";
import { numeric_as_number } from "./columns";

// per-npo revenue totals by type
export const v_rev_ltd = pgView("v_rev_ltd", {
  npo_id: integer("npo_id"),
  type: text("type"),
  total: numeric_as_number("total", { precision: 38, scale: 18 }),
}).as(
  sql`SELECT npo_id, type, SUM(revenue) as total FROM rev_logs WHERE status = 'final' AND npo_id IS NOT NULL GROUP BY npo_id, type`
);

// per-npo loss totals
export const v_loss_ltd = pgView("v_loss_ltd", {
  npo_id: integer("npo_id"),
  total: numeric_as_number("total", { precision: 38, scale: 18 }),
}).as(sql`SELECT npo_id, SUM(amount) as total FROM loss_logs GROUP BY npo_id`);

// per-npo settled contribution total and count
export const v_contributions = pgView("v_contributions", {
  npo_id: integer("npo_id"),
  total: numeric_as_number("total", { precision: 38, scale: 18 }),
  count: bigint("count", { mode: "number" }),
}).as(
  sql`SELECT to_id as npo_id, COALESCE(SUM(amount_usd), 0) as total, COUNT(*) as count FROM dists WHERE status = 'settled' GROUP BY to_id`
);

// per-campaign settled donation total, net (after fees). the gift stays an
// npo dist; the campaign is only the donation that produced it. a campaign
// folded from an org fund also counts that fund's historic settled gifts,
// which live on `dists.fund_id` rather than `donations.campaign_id`
export const v_campaign_total_usd = pgView("v_campaign_total_usd", {
  campaign_id: text("campaign_id"),
  total: numeric_as_number("total", { precision: 38, scale: 18 }),
}).as(
  sql`SELECT campaign_id, COALESCE(SUM(net), 0) as total FROM (SELECT d.campaign_id as campaign_id, dists.net as net FROM donations d INNER JOIN dists ON dists.donation_id = d.id WHERE d.campaign_id IS NOT NULL AND dists.status = 'settled' UNION ALL SELECT c.id as campaign_id, dists.net as net FROM campaigns c INNER JOIN dists ON dists.fund_id = c.legacy_fund_id WHERE c.legacy_fund_id IS NOT NULL AND dists.status = 'settled') s GROUP BY campaign_id`
);

// per-fund settled donation total, net (after fees)
export const v_donation_total_usd = pgView("v_donation_total_usd", {
  fund_id: text("fund_id"),
  total: numeric_as_number("total", { precision: 38, scale: 18 }),
}).as(
  sql`SELECT fund_id, COALESCE(SUM(net), 0) as total FROM dists WHERE fund_id IS NOT NULL AND status = 'settled' GROUP BY fund_id`
);

// lifetime payouts per referrer. a row with `error` is a failed attempt kept
// for the referrer's history — no money moved
export const v_referrer_payout_ltd = pgView("v_referrer_payout_ltd", {
  referrer: text("referrer"),
  total: numeric_as_number("total", { precision: 38, scale: 18 }),
}).as(
  sql`SELECT COALESCE(referrer_user, referrer_npo) as referrer, SUM(amount) as total FROM referrer_payouts WHERE error IS NULL GROUP BY COALESCE(referrer_user, referrer_npo)`
);

// lifetime commissions per referrer and npo
export const v_referrer_commissions_ltd = pgView("v_referrer_commissions_ltd", {
  referrer: text("referrer"),
  npo_id: integer("npo_id"),
  total: numeric_as_number("total", { precision: 38, scale: 18 }),
}).as(
  sql`SELECT COALESCE(referrer_user, referrer_npo) as referrer, npo_id, SUM(amount) as total FROM referrer_commissions WHERE status = 'paid' GROUP BY COALESCE(referrer_user, referrer_npo), npo_id`
);
