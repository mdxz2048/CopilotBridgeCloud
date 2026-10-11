CREATE TABLE "model_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"provider_model_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"native_protocols" jsonb DEFAULT '["chat_completions"]'::jsonb NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"health_status" varchar(16) DEFAULT 'UNKNOWN' NOT NULL,
	"health_checked_at" timestamp with time zone,
	"cooldown_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_requests" ADD COLUMN "instance_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD COLUMN "protocol_mode" varchar(16);--> statement-breakpoint
ALTER TABLE "model_sessions" ADD COLUMN "instance_id" uuid;--> statement-breakpoint
ALTER TABLE "model_instances" ADD CONSTRAINT "model_instances_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_instances" ADD CONSTRAINT "model_instances_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_instances_binding_unique" ON "model_instances" USING btree ("model_id","provider_id","provider_model_id");--> statement-breakpoint
CREATE INDEX "model_instances_model_idx" ON "model_instances" USING btree ("model_id");--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_instance_id_model_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."model_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_sessions" ADD CONSTRAINT "model_sessions_instance_id_model_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."model_instances"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO model_instances (model_id,provider_id,provider_model_id,enabled,native_protocols,capabilities,health_status)
SELECT id,provider_id,provider_model_id,true,'["chat_completions"]'::jsonb,
 jsonb_build_object('legacy',true,'tools',supports_tools,'vision',supports_vision,'reasoning',supports_reasoning,'streaming',supports_streaming), 'UNKNOWN' FROM models;
--> statement-breakpoint
UPDATE model_sessions s SET instance_id=i.id FROM model_instances i WHERE s.model_id=i.model_id AND s.provider_id=i.provider_id;
--> statement-breakpoint
ALTER TABLE model_instances ADD CONSTRAINT model_instances_weight_positive CHECK(weight BETWEEN 0 AND 100000);
