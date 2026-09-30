CREATE TABLE "device_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"jti" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_proofs_jti_unique" UNIQUE("jti")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "public_key_jwk" jsonb;--> statement-breakpoint
ALTER TABLE "device_proofs" ADD CONSTRAINT "device_proofs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_proofs_created_idx" ON "device_proofs" USING btree ("created_at");