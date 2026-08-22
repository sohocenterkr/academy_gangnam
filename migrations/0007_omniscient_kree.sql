CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_admin_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"cloudinary_public_id" text NOT NULL,
	"cloudinary_asset_id" text,
	"secure_url" text NOT NULL,
	"resource_type" text NOT NULL,
	"format" text,
	"mime_type" text,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"duration" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_admin_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"expected_resource_type" text NOT NULL,
	"expected_folder" text NOT NULL,
	"expected_bytes" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_admin_id_admins_id_fk" FOREIGN KEY ("owner_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_deleted_by_admins_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_owner_admin_id_admins_id_fk" FOREIGN KEY ("owner_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_public_id_resource_type_unique" ON "media_assets" USING btree ("cloudinary_public_id","resource_type");--> statement-breakpoint
CREATE INDEX "media_assets_target_idx" ON "media_assets" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "media_assets_status_expires_idx" ON "media_assets" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "upload_sessions_owner_status_idx" ON "upload_sessions" USING btree ("owner_admin_id","status");--> statement-breakpoint
CREATE INDEX "upload_sessions_status_expires_idx" ON "upload_sessions" USING btree ("status","expires_at");