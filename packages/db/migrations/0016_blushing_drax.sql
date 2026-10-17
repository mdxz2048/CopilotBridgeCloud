CREATE TABLE "reward_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_transaction_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "reward_notices_wallet_transaction_id_unique" UNIQUE("wallet_transaction_id")
);
--> statement-breakpoint
ALTER TABLE "reward_notices" ADD CONSTRAINT "reward_notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_notices" ADD CONSTRAINT "reward_notices_wallet_transaction_id_wallet_transactions_id_fk" FOREIGN KEY ("wallet_transaction_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reward_notices_user_ack_idx" ON "reward_notices" USING btree ("user_id","acknowledged_at");