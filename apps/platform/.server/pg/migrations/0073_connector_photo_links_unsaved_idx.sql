SET LOCAL lock_timeout = '2s';--> statement-breakpoint
DROP INDEX "connector_photo_links_expires_at_idx";--> statement-breakpoint
CREATE INDEX "connector_photo_links_unsaved_expires_at_idx" ON "connector_photo_links" USING btree ("expires_at") WHERE "connector_photo_links"."saved_pathname" is null;
