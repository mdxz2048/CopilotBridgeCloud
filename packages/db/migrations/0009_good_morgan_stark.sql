CREATE TABLE "site_page_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" varchar(10) NOT NULL,
	"page" varchar(16) NOT NULL,
	"views" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "site_page_views_day_page_idx" ON "site_page_views" USING btree ("day","page");