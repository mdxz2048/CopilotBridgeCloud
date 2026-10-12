CREATE TABLE "failure_diagnostics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"user_email" text NOT NULL,
	"app_version" varchar(64) NOT NULL,
	"trace_id" uuid NOT NULL,
	"stage" varchar(32) NOT NULL,
	"error_code" varchar(100) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_bytes" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "failure_diagnostics" ADD CONSTRAINT "failure_diagnostics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_diagnostics" ADD CONSTRAINT "failure_diagnostics_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "failure_diagnostics_user_created_idx" ON "failure_diagnostics" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "failure_diagnostics_created_idx" ON "failure_diagnostics" USING btree ("created_at");