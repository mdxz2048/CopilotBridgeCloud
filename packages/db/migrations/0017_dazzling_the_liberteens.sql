CREATE TABLE "purchase_mail_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"kind" varchar(32) NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"delivery_attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"locked_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_claims" ADD COLUMN "notice_acknowledged_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_mail_outbox" ADD CONSTRAINT "purchase_mail_outbox_claim_id_purchase_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."purchase_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_mail_event_idx" ON "purchase_mail_outbox" USING btree ("claim_id","attempt","kind");--> statement-breakpoint
CREATE INDEX "purchase_mail_due_idx" ON "purchase_mail_outbox" USING btree ("status","next_attempt_at");
--> statement-breakpoint
UPDATE purchase_claims SET notice_acknowledged_attempt=attempt WHERE status IN ('APPROVED','REJECTED');
