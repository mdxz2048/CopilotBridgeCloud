CREATE TABLE "public_rate_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "public_rate_hits_ip_time_idx" ON "public_rate_hits" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "public_rate_hits_created_idx" ON "public_rate_hits" USING btree ("created_at");