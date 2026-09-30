CREATE TABLE "registration_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_hash" varchar(64) NOT NULL,
	"ip_hash" varchar(64) NOT NULL,
	"code_hash" varchar(64),
	"state" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "registration_challenges_email_idx" ON "registration_challenges" USING btree ("email_hash","created_at");--> statement-breakpoint
CREATE INDEX "registration_challenges_ip_idx" ON "registration_challenges" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "registration_challenges_created_idx" ON "registration_challenges" USING btree ("created_at");