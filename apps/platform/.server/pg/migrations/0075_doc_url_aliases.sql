CREATE TABLE "doc_url_aliases" (
	"old_url" text NOT NULL,
	"new_url" text NOT NULL,
	CONSTRAINT "doc_url_aliases_old_url_new_url_pk" PRIMARY KEY("old_url","new_url"),
	CONSTRAINT "doc_url_aliases_moved" CHECK ("doc_url_aliases"."old_url" <> "doc_url_aliases"."new_url")
);
