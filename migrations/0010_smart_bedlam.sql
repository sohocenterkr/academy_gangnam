CREATE TABLE "message_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"send_item_id" uuid NOT NULL,
	"attempt_no" integer DEFAULT 1 NOT NULL,
	"device_id" uuid,
	"request_status" text NOT NULL,
	"external_reference" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"error_code" text,
	"error_message_safe" text,
	"retry_campaign_id" uuid
);
--> statement-breakpoint
CREATE TABLE "message_campaign_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"message_type" text NOT NULL,
	"template_id" uuid,
	"body_source" text DEFAULT '' NOT NULL,
	"recipient_type" text NOT NULL,
	"filter_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"duplicate_strategy" text DEFAULT 'merge' NOT NULL,
	"device_id" uuid,
	"send_mode" text DEFAULT 'immediate' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"opt_out_override_confirmed" boolean DEFAULT false NOT NULL,
	"approved_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"total_students" integer DEFAULT 0 NOT NULL,
	"total_contacts" integer DEFAULT 0 NOT NULL,
	"total_send_items" integer DEFAULT 0 NOT NULL,
	"excluded_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"student_id" uuid,
	"guardian_id" uuid,
	"phone_normalized" text NOT NULL,
	"relationship_snapshot" text,
	"personalization_snapshot" jsonb,
	"rendered_body" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"exclusion_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_send_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"media_id" uuid,
	"sequence_no" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"requested_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message_safe" text
);
--> statement-breakpoint
CREATE TABLE "opt_outs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_normalized" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"effective_date" date NOT NULL,
	"released_at" timestamp with time zone,
	"reason" text,
	"release_reason" text,
	"processed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_attempts" ADD CONSTRAINT "message_attempts_send_item_id_message_send_items_id_fk" FOREIGN KEY ("send_item_id") REFERENCES "public"."message_send_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attempts" ADD CONSTRAINT "message_attempts_device_id_messaging_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."messaging_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attempts" ADD CONSTRAINT "message_attempts_retry_campaign_id_message_campaigns_id_fk" FOREIGN KEY ("retry_campaign_id") REFERENCES "public"."message_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_campaign_media" ADD CONSTRAINT "message_campaign_media_campaign_id_message_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."message_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_campaign_media" ADD CONSTRAINT "message_campaign_media_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_campaigns" ADD CONSTRAINT "message_campaigns_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_campaigns" ADD CONSTRAINT "message_campaigns_approved_by_admins_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_campaigns" ADD CONSTRAINT "message_campaigns_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_campaigns" ADD CONSTRAINT "message_campaigns_device_id_messaging_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."messaging_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_recipients" ADD CONSTRAINT "message_recipients_campaign_id_message_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."message_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_recipients" ADD CONSTRAINT "message_recipients_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_recipients" ADD CONSTRAINT "message_recipients_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_send_items" ADD CONSTRAINT "message_send_items_campaign_id_message_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."message_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_send_items" ADD CONSTRAINT "message_send_items_recipient_id_message_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."message_recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_send_items" ADD CONSTRAINT "message_send_items_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opt_outs" ADD CONSTRAINT "opt_outs_processed_by_admins_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_campaign_media_campaign_idx" ON "message_campaign_media" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_campaigns_idempotency_key_unique" ON "message_campaigns" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "message_campaigns_status_scheduled_idx" ON "message_campaigns" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "message_recipients_campaign_phone_idx" ON "message_recipients" USING btree ("campaign_id","phone_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "message_send_items_idempotency_key_unique" ON "message_send_items" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "message_send_items_status_sequence_idx" ON "message_send_items" USING btree ("status","sequence_no");--> statement-breakpoint
CREATE UNIQUE INDEX "opt_outs_active_phone_unique" ON "opt_outs" USING btree ("phone_normalized") WHERE "opt_outs"."status" = 'active';