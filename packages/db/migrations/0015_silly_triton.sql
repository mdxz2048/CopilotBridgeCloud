CREATE TABLE "purchase_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"order_no" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"points" integer,
	"reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"attempt" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_claims_order_no_unique" UNIQUE("order_no")
);
--> statement-breakpoint
CREATE TABLE "purchase_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"status" varchar(16) NOT NULL,
	"points" integer,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"device_version" integer,
	"web_session_id" uuid,
	"token_hash" text NOT NULL,
	"mobile_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"claim_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_tickets_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "purchase_tickets_mobile_hash_unique" UNIQUE("mobile_hash")
);
--> statement-breakpoint
ALTER TABLE "purchase_claims" ADD CONSTRAINT "purchase_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_claims" ADD CONSTRAINT "purchase_claims_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_reviews" ADD CONSTRAINT "purchase_reviews_claim_id_purchase_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."purchase_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_reviews" ADD CONSTRAINT "purchase_reviews_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_tickets" ADD CONSTRAINT "purchase_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_tickets" ADD CONSTRAINT "purchase_tickets_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_tickets" ADD CONSTRAINT "purchase_tickets_web_session_id_web_sessions_id_fk" FOREIGN KEY ("web_session_id") REFERENCES "public"."web_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_tickets" ADD CONSTRAINT "purchase_tickets_claim_id_purchase_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."purchase_claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_claims_user_created_idx" ON "purchase_claims" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "purchase_claims_status_deadline_idx" ON "purchase_claims" USING btree ("status","deadline_at");--> statement-breakpoint
CREATE INDEX "purchase_reviews_claim_idx" ON "purchase_reviews" USING btree ("claim_id","created_at");--> statement-breakpoint
CREATE INDEX "purchase_tickets_user_source_idx" ON "purchase_tickets" USING btree ("user_id","device_id","web_session_id");--> statement-breakpoint
CREATE INDEX "purchase_tickets_expiry_idx" ON "purchase_tickets" USING btree ("expires_at");