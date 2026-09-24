CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"response_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"provider_account_id" uuid,
	"billing_policy" varchar(24) NOT NULL,
	"status" varchar(24) DEFAULT 'CREATED' NOT NULL,
	"error_code" text,
	"legacy_usage_record_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_requests_response_id_unique" UNIQUE("response_id")
);
--> statement-breakpoint
CREATE TABLE "device_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ip_hash" text,
	"request_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_account_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"tag" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_account_credentials_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "provider_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"user_id" uuid,
	"ownership" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'DISABLED' NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_card_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_card_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" varchar(16) DEFAULT 'DRAFT' NOT NULL,
	"input_rate" numeric(20, 6) DEFAULT '0' NOT NULL,
	"output_rate" numeric(20, 6) DEFAULT '0' NOT NULL,
	"cached_input_rate" numeric(20, 6) DEFAULT '0' NOT NULL,
	"reasoning_rate" numeric(20, 6) DEFAULT '0' NOT NULL,
	"image_input_rate" numeric(20, 6) DEFAULT '0' NOT NULL,
	"image_output_rate" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tool_rate" numeric(20, 6) DEFAULT '0' NOT NULL,
	"minimum_charge" integer DEFAULT 0 NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"billing_policy" varchar(24) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code" varchar(24) NOT NULL,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_codes_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "referral_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "referral_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referral_id" uuid NOT NULL,
	"beneficiary_user_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"wallet_transaction_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_user_id" uuid NOT NULL,
	"referred_user_id" uuid NOT NULL,
	"referral_code_id" uuid NOT NULL,
	"source_device_id" uuid,
	"status" varchar(16) DEFAULT 'REGISTERED' NOT NULL,
	"risk_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"registration_ip_hash" text,
	"payment_identity_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"qualified_at" timestamp with time zone,
	CONSTRAINT "referrals_referred_user_id_unique" UNIQUE("referred_user_id")
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"image_input" integer DEFAULT 0 NOT NULL,
	"image_output" integer DEFAULT 0 NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"provider_reported_usage" jsonb,
	"provider_cost" numeric(20, 8),
	"provider_currency" varchar(3),
	"rate_card_version_id" uuid,
	"points_rated" integer DEFAULT 0 NOT NULL,
	"points_charged" integer DEFAULT 0 NOT NULL,
	"billing_status" varchar(16) DEFAULT 'SETTLED' NOT NULL,
	"billing_policy" varchar(24) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_events_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"points" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reference_type" varchar(32) NOT NULL,
	"reference_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_transactions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "monthly_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "rollover_policy" varchar(16) DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_legacy_usage_record_id_usage_records_id_fk" FOREIGN KEY ("legacy_usage_record_id") REFERENCES "public"."usage_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_account_credentials" ADD CONSTRAINT "provider_account_credentials_account_id_provider_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_versions" ADD CONSTRAINT "rate_card_versions_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_versions" ADD CONSTRAINT "rate_card_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_beneficiary_user_id_users_id_fk" FOREIGN KEY ("beneficiary_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_wallet_transaction_id_wallet_transactions_id_fk" FOREIGN KEY ("wallet_transaction_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referral_code_id_referral_codes_id_fk" FOREIGN KEY ("referral_code_id") REFERENCES "public"."referral_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_source_device_id_devices_id_fk" FOREIGN KEY ("source_device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_request_id_ai_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ai_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_rate_card_version_id_rate_card_versions_id_fk" FOREIGN KEY ("rate_card_version_id") REFERENCES "public"."rate_card_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_requests_user_date_idx" ON "ai_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_sessions_device_idx" ON "device_sessions" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "provider_accounts_user_idx" ON "provider_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_card_versions_number_idx" ON "rate_card_versions" USING btree ("rate_card_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_cards_provider_model_policy_idx" ON "rate_cards" USING btree ("provider_id","model_id","billing_policy");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_rewards_beneficiary_idx" ON "referral_rewards" USING btree ("referral_id","beneficiary_user_id");--> statement-breakpoint
CREATE INDEX "referrals_referrer_date_idx" ON "referrals" USING btree ("referrer_user_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_user_date_idx" ON "usage_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_request_idx" ON "usage_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "wallet_transactions_wallet_date_idx" ON "wallet_transactions" USING btree ("wallet_id","created_at");
--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallet_balance_nonnegative" CHECK ("balance" >= 0);
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transaction_valid" CHECK ("points" <> 0 AND "balance_after" >= 0);
--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_monthly_points_nonnegative" CHECK ("monthly_points" >= 0);
--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_not_self" CHECK ("referrer_user_id" <> "referred_user_id");
--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_event_nonnegative" CHECK (
  "input_tokens" >= 0 AND "output_tokens" >= 0 AND "cached_input_tokens" >= 0 AND "reasoning_tokens" >= 0
  AND "image_input" >= 0 AND "image_output" >= 0 AND "tool_calls" >= 0
  AND "cached_input_tokens" <= "input_tokens" AND "reasoning_tokens" <= "output_tokens"
  AND "points_rated" >= 0 AND "points_charged" >= 0 AND "points_charged" <= "points_rated");
--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_account_ownership" CHECK (
  ("ownership" = 'MANAGED' AND "user_id" IS NULL) OR ("ownership" IN ('BYOS', 'LOCAL') AND "user_id" IS NOT NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX "rate_card_one_active_version" ON "rate_card_versions" ("rate_card_id") WHERE "status" = 'ACTIVE';
--> statement-breakpoint
CREATE FUNCTION bridge_v2_reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'immutable V2 financial record';
END $$;
--> statement-breakpoint
CREATE TRIGGER usage_events_immutable BEFORE UPDATE OR DELETE ON "usage_events"
  FOR EACH ROW EXECUTE FUNCTION bridge_v2_reject_immutable_change();
--> statement-breakpoint
CREATE TRIGGER wallet_transactions_immutable BEFORE UPDATE OR DELETE ON "wallet_transactions"
  FOR EACH ROW EXECUTE FUNCTION bridge_v2_reject_immutable_change();
--> statement-breakpoint
CREATE FUNCTION bridge_v2_rate_fields_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.status <> 'DRAFT' AND (
    NEW.input_rate, NEW.output_rate, NEW.cached_input_rate, NEW.reasoning_rate,
    NEW.image_input_rate, NEW.image_output_rate, NEW.tool_rate, NEW.minimum_charge,
    NEW.rate_card_id, NEW.version
  ) IS DISTINCT FROM (
    OLD.input_rate, OLD.output_rate, OLD.cached_input_rate, OLD.reasoning_rate,
    OLD.image_input_rate, OLD.image_output_rate, OLD.tool_rate, OLD.minimum_charge,
    OLD.rate_card_id, OLD.version
  ) THEN RAISE EXCEPTION 'published rate fields are immutable'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER rate_fields_immutable BEFORE UPDATE ON "rate_card_versions"
  FOR EACH ROW EXECUTE FUNCTION bridge_v2_rate_fields_immutable();
