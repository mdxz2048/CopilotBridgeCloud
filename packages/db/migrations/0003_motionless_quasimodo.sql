CREATE TABLE "wallet_lot_spends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"source_transaction_id" uuid NOT NULL,
	"granted_points" integer NOT NULL,
	"remaining_points" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_lots_source_transaction_id_unique" UNIQUE("source_transaction_id")
);
--> statement-breakpoint
ALTER TABLE "wallet_lot_spends" ADD CONSTRAINT "wallet_lot_spends_lot_id_wallet_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."wallet_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_lot_spends" ADD CONSTRAINT "wallet_lot_spends_transaction_id_wallet_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_lots" ADD CONSTRAINT "wallet_lots_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_lots" ADD CONSTRAINT "wallet_lots_source_transaction_id_wallet_transactions_id_fk" FOREIGN KEY ("source_transaction_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_lot_spend_unique" ON "wallet_lot_spends" USING btree ("lot_id","transaction_id");--> statement-breakpoint
CREATE INDEX "wallet_lots_expiry_idx" ON "wallet_lots" USING btree ("wallet_id","expires_at");
--> statement-breakpoint
ALTER TABLE "wallet_lots" ADD CONSTRAINT "wallet_lot_balance_valid" CHECK ("granted_points" > 0 AND "remaining_points" >= 0 AND "remaining_points" <= "granted_points");
--> statement-breakpoint
ALTER TABLE "wallet_lot_spends" ADD CONSTRAINT "wallet_lot_spend_positive" CHECK ("points" > 0);
--> statement-breakpoint
CREATE TRIGGER wallet_lot_spends_immutable BEFORE UPDATE OR DELETE ON "wallet_lot_spends"
  FOR EACH ROW EXECUTE FUNCTION bridge_v2_reject_immutable_change();
--> statement-breakpoint
CREATE FUNCTION bridge_v2_lot_change_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.wallet_id IS DISTINCT FROM OLD.wallet_id OR NEW.source_transaction_id IS DISTINCT FROM OLD.source_transaction_id
    OR NEW.granted_points IS DISTINCT FROM OLD.granted_points OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.remaining_points > OLD.remaining_points THEN
    RAISE EXCEPTION 'wallet lot source or remaining points cannot increase';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER wallet_lot_change_guard BEFORE UPDATE ON "wallet_lots"
  FOR EACH ROW EXECUTE FUNCTION bridge_v2_lot_change_guard();
--> statement-breakpoint
CREATE TRIGGER wallet_lots_no_delete BEFORE DELETE ON "wallet_lots"
  FOR EACH ROW EXECUTE FUNCTION bridge_v2_reject_immutable_change();
