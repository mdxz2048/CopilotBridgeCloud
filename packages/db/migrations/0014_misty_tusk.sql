CREATE TABLE "device_billing_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"device_name" text NOT NULL,
	"binding_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone NOT NULL,
	"charged_points" bigint NOT NULL,
	"start_event_id" uuid,
	"end_event_id" uuid,
	CONSTRAINT "device_billing_periods_end_event_id_unique" UNIQUE("end_event_id")
);
--> statement-breakpoint
CREATE TABLE "device_billing_states" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"charged_points" bigint DEFAULT 0 NOT NULL,
	"settled_points" bigint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"start_event_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_billing_periods" ADD CONSTRAINT "device_billing_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_billing_periods" ADD CONSTRAINT "device_billing_periods_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_billing_states" ADD CONSTRAINT "device_billing_states_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_billing_states" ADD CONSTRAINT "device_billing_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_billing_periods_user_date_idx" ON "device_billing_periods" USING btree ("user_id","ended_at");--> statement-breakpoint
CREATE INDEX "device_billing_states_user_idx" ON "device_billing_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wallet_transactions_account_date_idx" ON "wallet_transactions" USING btree ("wallet_id","created_at") WHERE "wallet_transactions"."type" <> 'USAGE';
--> statement-breakpoint
-- One-time historical cutover, run with the old API stopped before starting the new API.
INSERT INTO device_billing_states (device_id, user_id, charged_points, settled_points)
SELECT d.id, d.user_id, COALESCE(u.points,0), COALESCE(u.points,0)
FROM devices d LEFT JOIN (
  SELECT device_id, SUM(points_charged)::bigint AS points FROM usage_events GROUP BY device_id
) u ON u.device_id=d.id;
--> statement-breakpoint
INSERT INTO device_billing_periods (user_id, device_id, device_name, binding_id, kind, ended_at, charged_points)
SELECT s.user_id, s.device_id, d.device_name, d.device_id, 'HISTORICAL', s.updated_at, s.charged_points
FROM device_billing_states s JOIN devices d ON d.id=s.device_id WHERE s.charged_points>0;
