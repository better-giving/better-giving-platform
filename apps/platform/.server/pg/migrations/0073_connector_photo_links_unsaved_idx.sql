SET LOCAL lock_timeout = '2s';--> statement-breakpoint
DROP INDEX "connector_photo_links_expires_at_idx";--> statement-breakpoint
CREATE INDEX "connector_photo_links_unsaved_expires_at_idx" ON "connector_photo_links" USING btree ("expires_at") WHERE "connector_photo_links"."saved_pathname" is null;--> statement-breakpoint
ALTER TABLE "connector_idempotency" ADD COLUMN "resource_id" text DEFAULT gen_random_uuid()::text NOT NULL;
