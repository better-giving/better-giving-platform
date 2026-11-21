SET LOCAL lock_timeout = '2s';--> statement-breakpoint
LOCK TABLE "npos" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
LOCK TABLE "settlements", "user" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
CREATE TABLE "manual_wires" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "manual_wires_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"npo_id" integer NOT NULL,
	"provider" text NOT NULL,
	"provider_tx_id" text NOT NULL,
	"wire_date" date NOT NULL,
	"amount_sent" numeric(38, 18) NOT NULL,
	"wire_fee" numeric(38, 18) NOT NULL,
	"settlement_id" text NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "manual_wires_settlement_id_uniq" UNIQUE("settlement_id"),
	CONSTRAINT "manual_wires_provider_tx_uniq" UNIQUE("provider","provider_tx_id"),
	CONSTRAINT "manual_wires_amount_sent_check" CHECK ("manual_wires"."amount_sent" > 0),
	CONSTRAINT "manual_wires_wire_fee_check" CHECK ("manual_wires"."wire_fee" >= 0),
	CONSTRAINT "manual_wires_provider_tx_id_check" CHECK (btrim("manual_wires"."provider_tx_id") <> '')
);
--> statement-breakpoint
ALTER TABLE "manual_wires" ADD CONSTRAINT "manual_wires_npo_id_npos_id_fk" FOREIGN KEY ("npo_id") REFERENCES "public"."npos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_wires" ADD CONSTRAINT "manual_wires_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_wires" ADD CONSTRAINT "manual_wires_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npos" ADD COLUMN "payout_method" text DEFAULT 'wise' NOT NULL;--> statement-breakpoint
ALTER TABLE "npos" ADD CONSTRAINT "npos_payout_method_check" CHECK ("npos"."payout_method" IN ('wise', 'manual_wire')) NOT VALID;--> statement-breakpoint
ALTER TABLE "npos" VALIDATE CONSTRAINT "npos_payout_method_check";
