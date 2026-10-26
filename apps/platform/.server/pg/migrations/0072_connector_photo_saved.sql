SET LOCAL lock_timeout = '2s';--> statement-breakpoint
ALTER TABLE "connector_photo_links" ADD COLUMN "saved_url" text;--> statement-breakpoint
ALTER TABLE "connector_photo_links" ADD COLUMN "saved_pathname" text;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "updated_at" timestamptz;--> statement-breakpoint
CREATE INDEX "connector_photo_links_campaign_saved_idx" ON "connector_photo_links" USING btree ("campaign_id","saved_pathname");