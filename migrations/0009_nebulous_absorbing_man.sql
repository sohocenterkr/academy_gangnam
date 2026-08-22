CREATE TABLE "ai_generation_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"photos_sent" integer DEFAULT 0 NOT NULL,
	"input_summary_safe" text,
	"output_json" jsonb,
	"usage_json" jsonb,
	"estimated_cost" integer,
	"actual_cost" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_news_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"layout_json" jsonb,
	"title" text,
	"body" text,
	"rendered_media_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "card_news_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"card_id" uuid,
	"media_id" uuid NOT NULL,
	"role" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_news_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"preset_id" uuid NOT NULL,
	"title" text,
	"story" text,
	"event_date" date,
	"related_course_id" uuid,
	"related_student_id" uuid,
	"student_name_display_mode" text DEFAULT 'masked' NOT NULL,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"show_academy_info" boolean DEFAULT true NOT NULL,
	"ai_provider" text,
	"ai_model" text,
	"send_photos_to_ai" boolean DEFAULT false NOT NULL,
	"privacy_confirmed_by" uuid,
	"privacy_confirmed_at" timestamp with time zone,
	"estimated_cost" integer,
	"actual_usage" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "platform_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"post_type" text NOT NULL,
	"name" text NOT NULL,
	"width_px" integer NOT NULL,
	"height_px" integer NOT NULL,
	"safe_area" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "ai_generation_logs" ADD CONSTRAINT "ai_generation_logs_project_id_card_news_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."card_news_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generation_logs" ADD CONSTRAINT "ai_generation_logs_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_news_cards" ADD CONSTRAINT "card_news_cards_project_id_card_news_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."card_news_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_news_cards" ADD CONSTRAINT "card_news_cards_rendered_media_id_media_assets_id_fk" FOREIGN KEY ("rendered_media_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_news_cards" ADD CONSTRAINT "card_news_cards_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_news_cards" ADD CONSTRAINT "card_news_cards_updated_by_admins_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_news_media" ADD CONSTRAINT "card_news_media_project_id_card_news_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."card_news_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_news_media" ADD CONSTRAINT "card_news_media_card_id_card_news_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."card_news_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_news_media" ADD CONSTRAINT "card_news_media_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_news_projects" ADD CONSTRAINT "card_news_projects_preset_id_platform_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."platform_presets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_news_projects" ADD CONSTRAINT "card_news_projects_related_course_id_courses_id_fk" FOREIGN KEY ("related_course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_news_projects" ADD CONSTRAINT "card_news_projects_related_student_id_students_id_fk" FOREIGN KEY ("related_student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_news_projects" ADD CONSTRAINT "card_news_projects_privacy_confirmed_by_admins_id_fk" FOREIGN KEY ("privacy_confirmed_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_news_projects" ADD CONSTRAINT "card_news_projects_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_news_projects" ADD CONSTRAINT "card_news_projects_updated_by_admins_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_presets" ADD CONSTRAINT "platform_presets_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_presets" ADD CONSTRAINT "platform_presets_updated_by_admins_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_news_cards_project_sort_idx" ON "card_news_cards" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE INDEX "card_news_media_project_idx" ON "card_news_media" USING btree ("project_id");