CREATE TABLE "site_download_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" varchar(10) NOT NULL,
	"version" text NOT NULL,
	"platform" text NOT NULL,
	"arch" text NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "site_download_stats_scope_idx" ON "site_download_stats" USING btree ("day","version","platform","arch");--> statement-breakpoint
CREATE INDEX "audit_logs_action_created_idx" ON "audit_logs" USING btree ("action","created_at");
--> statement-breakpoint
INSERT INTO system_settings(key,value) VALUES ('admin_telemetry_started',jsonb_build_object('startedAt',now())) ON CONFLICT(key) DO NOTHING;
