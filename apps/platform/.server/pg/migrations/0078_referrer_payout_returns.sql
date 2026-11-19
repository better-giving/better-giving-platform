SET LOCAL lock_timeout = '2s';--> statement-breakpoint
ALTER TABLE "referrer_commissions" DROP CONSTRAINT "status_check";--> statement-breakpoint
ALTER TABLE "referrer_commissions" ADD CONSTRAINT "status_check" CHECK ("referrer_commissions"."status" IN ('pending','processing','paid','returned','refunded','refunded_loss')) NOT VALID;--> statement-breakpoint
ALTER TABLE "referrer_commissions" VALIDATE CONSTRAINT "status_check";--> statement-breakpoint
ALTER TABLE "referrer_payouts" ADD COLUMN "status" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "referrer_payouts" ADD COLUMN "recipient_id" text;--> statement-breakpoint
CREATE OR REPLACE VIEW "public"."v_referrer_payout_ltd" AS (SELECT COALESCE(referrer_user, referrer_npo) as referrer, SUM(amount) as total FROM referrer_payouts WHERE error IS NULL AND status <> 'returned' GROUP BY COALESCE(referrer_user, referrer_npo));
