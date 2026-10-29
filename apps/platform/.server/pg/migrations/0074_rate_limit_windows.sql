CREATE TABLE "rate_limit_windows" (
	"key" text NOT NULL,
	"window_start" timestamptz NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamptz NOT NULL,
	CONSTRAINT "rate_limit_windows_key_window_start_pk" PRIMARY KEY("key","window_start"),
	CONSTRAINT "rate_limit_windows_count_nonneg" CHECK ("rate_limit_windows"."count" >= 0),
	CONSTRAINT "rate_limit_windows_expires_after_start" CHECK ("rate_limit_windows"."expires_at" > "rate_limit_windows"."window_start")
);
--> statement-breakpoint
CREATE INDEX "rate_limit_windows_expires_at_idx" ON "rate_limit_windows" USING btree ("expires_at");