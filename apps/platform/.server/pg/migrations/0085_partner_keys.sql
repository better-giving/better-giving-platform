CREATE TABLE "partner_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"npo_id" integer NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"last4" text NOT NULL,
	"minted_by" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"last_used_at" timestamptz,
	"revoked_at" timestamptz,
	"revoked_by" text,
	CONSTRAINT "partner_keys_key_hash_unique" UNIQUE("key_hash"),
	CONSTRAINT "partner_keys_key_hash_hex" CHECK ("partner_keys"."key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "partner_keys_prefix_len" CHECK (char_length("partner_keys"."prefix") = 8),
	CONSTRAINT "partner_keys_last4_len" CHECK (char_length("partner_keys"."last4") = 4)
);
--> statement-breakpoint
CREATE TABLE "partner_tenants" (
	"npo_id" integer PRIMARY KEY NOT NULL,
	"event_secret" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"fingerprint" text,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partner_keys" ADD CONSTRAINT "partner_keys_npo_id_npos_id_fk" FOREIGN KEY ("npo_id") REFERENCES "public"."npos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_keys" ADD CONSTRAINT "partner_keys_minted_by_user_id_fk" FOREIGN KEY ("minted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_keys" ADD CONSTRAINT "partner_keys_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_tenants" ADD CONSTRAINT "partner_tenants_npo_id_npos_id_fk" FOREIGN KEY ("npo_id") REFERENCES "public"."npos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_keys_npo_id_live_idx" ON "partner_keys" USING btree ("npo_id") WHERE "partner_keys"."revoked_at" is null;