DROP INDEX "usage_events_request_idx";--> statement-breakpoint
ALTER TABLE "ai_requests" ADD COLUMN "rate_card_version_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_rate_card_version_id_rate_card_versions_id_fk" FOREIGN KEY ("rate_card_version_id") REFERENCES "public"."rate_card_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_request_idx" ON "usage_events" USING btree ("request_id");