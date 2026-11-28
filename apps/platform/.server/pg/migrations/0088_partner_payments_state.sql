ALTER TABLE "partner_payments" ADD COLUMN "provider_state" jsonb;--> statement-breakpoint
ALTER TABLE "partner_payments" ADD COLUMN "superseded_at" timestamptz;