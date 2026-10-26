SET LOCAL lock_timeout = '2s';--> statement-breakpoint
CREATE TABLE "connector_photo_links" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"npo_id" integer NOT NULL,
	"campaign_id" text NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"expires_at" timestamptz NOT NULL,
	"used_at" timestamptz,
	CONSTRAINT "connector_photo_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "connector_photo_links_token_hash_hex" CHECK ("connector_photo_links"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "connector_photo_links" ADD CONSTRAINT "connector_photo_links_npo_id_npos_id_fk" FOREIGN KEY ("npo_id") REFERENCES "public"."npos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_photo_links" ADD CONSTRAINT "connector_photo_links_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connector_photo_links_expires_at_idx" ON "connector_photo_links" USING btree ("expires_at");