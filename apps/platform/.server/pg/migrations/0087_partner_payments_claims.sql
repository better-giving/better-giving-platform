ALTER TABLE "partner_payments" ADD COLUMN "claim_id" text DEFAULT gen_random_uuid()::text NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_payments" ADD COLUMN "authorized_session_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payments_session_id_idx" ON "partner_payments" USING btree ("authorized_session_id") WHERE "partner_payments"."authorized_session_id" is not null;