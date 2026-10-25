-- contract: 7a17e28 v_campaign_total_usd recreated with the same columns (campaign_id, total); it only adds legacy-fund settled gifts to the sum, so the deployment still serving reads it unchanged
DROP VIEW "public"."v_campaign_total_usd";--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "legacy_fund_id" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_legacy_fund_id_funds_id_fk" FOREIGN KEY ("legacy_fund_id") REFERENCES "public"."funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_legacy_fund_id_unique" UNIQUE("legacy_fund_id");--> statement-breakpoint
CREATE VIEW "public"."v_campaign_total_usd" AS (SELECT campaign_id, COALESCE(SUM(net), 0) as total FROM (SELECT d.campaign_id as campaign_id, dists.net as net FROM donations d INNER JOIN dists ON dists.donation_id = d.id WHERE d.campaign_id IS NOT NULL AND dists.status = 'settled' UNION ALL SELECT c.id as campaign_id, dists.net as net FROM campaigns c INNER JOIN dists ON dists.fund_id = c.legacy_fund_id WHERE c.legacy_fund_id IS NOT NULL AND dists.status = 'settled') s GROUP BY campaign_id);--> statement-breakpoint
-- BG-1943 decision 6: a campaign folded from an org fund keeps the fund's
-- several beneficiaries, so drop 0067's one-member/owner-only guard on
-- campaign_members. nothing reads campaign_members expecting a single owner row;
-- campaign_create and the connector still insert only the owner for new campaigns
DROP TRIGGER IF EXISTS campaign_members_owner ON campaign_members;--> statement-breakpoint
DROP FUNCTION IF EXISTS campaign_member_is_owner();