SET LOCAL lock_timeout = '2s';--> statement-breakpoint
ALTER TABLE "payouts" DROP CONSTRAINT "type_check";--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "type_check" CHECK ("payouts"."type" IN ('pending','processing','settled','error','refunded','refunded_loss','cancelled','returned','void')) NOT VALID;--> statement-breakpoint
ALTER TABLE "payouts" VALIDATE CONSTRAINT "type_check";--> statement-breakpoint
ALTER TABLE "banking_apps" ADD COLUMN "account_holder" text;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "hold_alerted_at" timestamptz;
