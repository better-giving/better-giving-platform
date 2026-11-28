CREATE TABLE "partner_payments" (
	"npo_id" integer NOT NULL,
	"gift_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"method" text NOT NULL,
	"currency" text NOT NULL,
	"amount" jsonb NOT NULL,
	"attribution" jsonb NOT NULL,
	"claim_id" text NOT NULL,
	"donation_id" text,
	"grant_id" text,
	"response" jsonb,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"claimed_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "partner_payments_npo_id_gift_id_pk" PRIMARY KEY("npo_id","gift_id")
);
--> statement-breakpoint
ALTER TABLE "partner_payments" ADD CONSTRAINT "partner_payments_npo_id_npos_id_fk" FOREIGN KEY ("npo_id") REFERENCES "public"."npos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payments_donation_id_idx" ON "partner_payments" USING btree ("donation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payments_grant_id_idx" ON "partner_payments" USING btree ("grant_id") WHERE "partner_payments"."grant_id" is not null;