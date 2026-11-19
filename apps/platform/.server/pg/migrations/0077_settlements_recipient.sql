SET LOCAL lock_timeout = '2s';--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "recipient_id" text;
