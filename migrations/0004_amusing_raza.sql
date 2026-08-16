CREATE TABLE "check_in_change_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_in_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb,
	"reason" text,
	"admin_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"check_in_date" date NOT NULL,
	"check_in_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"idempotency_key" text NOT NULL,
	"exception_reason" text,
	"is_exception" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_checkin_phones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"phone_normalized" text NOT NULL,
	"phone_last4" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "check_in_change_logs" ADD CONSTRAINT "check_in_change_logs_check_in_id_check_ins_id_fk" FOREIGN KEY ("check_in_id") REFERENCES "public"."check_ins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_change_logs" ADD CONSTRAINT "check_in_change_logs_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_checkin_phones" ADD CONSTRAINT "student_checkin_phones_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "check_ins_idempotency_key_unique" ON "check_ins" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "check_ins_student_date_active_unique" ON "check_ins" USING btree ("student_id","check_in_date") WHERE "check_ins"."status" = 'active' AND "check_ins"."is_exception" = false;--> statement-breakpoint
CREATE INDEX "check_ins_date_at_idx" ON "check_ins" USING btree ("check_in_date","check_in_at");--> statement-breakpoint
CREATE INDEX "check_ins_student_date_idx" ON "check_ins" USING btree ("student_id","check_in_date");--> statement-breakpoint
CREATE INDEX "student_checkin_phones_last4_active_idx" ON "student_checkin_phones" USING btree ("phone_last4","is_active");--> statement-breakpoint
CREATE INDEX "student_checkin_phones_student_active_idx" ON "student_checkin_phones" USING btree ("student_id","is_active");