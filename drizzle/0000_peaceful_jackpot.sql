CREATE TABLE "ai_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"base_id" text NOT NULL,
	"table_id" text,
	"name" text NOT NULL,
	"format" text DEFAULT 'markdown' NOT NULL,
	"scope_label" text DEFAULT '' NOT NULL,
	"content" text NOT NULL,
	"chart" jsonb,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"table_id" text NOT NULL,
	"record_id" text,
	"field_id" text,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bases" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '#2563eb' NOT NULL,
	"rank" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_sequences" (
	"field_id" text PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fields" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"table_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rank" text NOT NULL,
	"width" integer DEFAULT 180 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"frozen" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_draft_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"form_id" text NOT NULL,
	"target_field_id" text NOT NULL,
	"label" text NOT NULL,
	"help_text" text DEFAULT '' NOT NULL,
	"placeholder" text DEFAULT '' NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"rank" text NOT NULL,
	"mode" text DEFAULT 'visible' NOT NULL,
	"visibility_rule" jsonb
);
--> statement-breakpoint
CREATE TABLE "form_metric_buckets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"form_id" text NOT NULL,
	"day" text NOT NULL,
	"metric" text NOT NULL,
	"breakdown_kind" text DEFAULT 'total' NOT NULL,
	"breakdown_key" text DEFAULT 'all' NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"form_id" text NOT NULL,
	"form_version_id" text NOT NULL,
	"record_id" text,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_version_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"form_version_id" text NOT NULL,
	"target_field_id" text NOT NULL,
	"target_field_type" text NOT NULL,
	"label" text NOT NULL,
	"help_text" text DEFAULT '' NOT NULL,
	"placeholder" text DEFAULT '' NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"rank" text NOT NULL,
	"mode" text DEFAULT 'visible' NOT NULL,
	"field_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visibility_rule" jsonb
);
--> statement-breakpoint
CREATE TABLE "form_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"form_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"thank_you" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_by" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"base_id" text NOT NULL,
	"table_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"thank_you" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"analytics_time_zone" text DEFAULT 'UTC' NOT NULL,
	"published_version_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forms_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"table_id" text NOT NULL,
	"rank" text NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"favorited" boolean DEFAULT false NOT NULL,
	"last_opened_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tables" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"base_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"rank" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"table_id" text NOT NULL,
	"record_id" text,
	"field_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "view_field_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"view_id" text NOT NULL,
	"field_id" text NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"frozen" boolean DEFAULT false NOT NULL,
	"width" integer,
	"rank" text NOT NULL,
	"formatting" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "views" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"table_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'grid' NOT NULL,
	"visibility" text DEFAULT 'shared' NOT NULL,
	"owner_user_id" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"rank" text NOT NULL,
	"filter_conjunction" text DEFAULT 'and' NOT NULL,
	"filters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sorts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_reports" ADD CONSTRAINT "ai_reports_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_sequences" ADD CONSTRAINT "field_sequences_field_id_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_sequences" ADD CONSTRAINT "field_sequences_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_draft_fields" ADD CONSTRAINT "form_draft_fields_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_draft_fields" ADD CONSTRAINT "form_draft_fields_target_field_id_fields_id_fk" FOREIGN KEY ("target_field_id") REFERENCES "public"."fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_metric_buckets" ADD CONSTRAINT "form_metric_buckets_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."form_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_version_fields" ADD CONSTRAINT "form_version_fields_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."form_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_field_configs" ADD CONSTRAINT "view_field_configs_view_id_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_field_configs" ADD CONSTRAINT "view_field_configs_field_id_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_reports_base_status_idx" ON "ai_reports" USING btree ("base_id","status");--> statement-breakpoint
CREATE INDEX "attachments_table_status_idx" ON "attachments" USING btree ("table_id","status");--> statement-breakpoint
CREATE INDEX "attachments_org_status_idx" ON "attachments" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "bases_org_status_rank_idx" ON "bases" USING btree ("org_id","status","rank");--> statement-breakpoint
CREATE INDEX "fields_table_status_rank_idx" ON "fields" USING btree ("table_id","status","rank");--> statement-breakpoint
CREATE INDEX "fields_org_status_idx" ON "fields" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "form_draft_fields_form_rank_idx" ON "form_draft_fields" USING btree ("form_id","rank");--> statement-breakpoint
CREATE INDEX "form_metric_buckets_form_day_idx" ON "form_metric_buckets" USING btree ("form_id","day");--> statement-breakpoint
CREATE INDEX "form_submissions_form_submitted_idx" ON "form_submissions" USING btree ("form_id","submitted_at");--> statement-breakpoint
CREATE INDEX "form_version_fields_version_rank_idx" ON "form_version_fields" USING btree ("form_version_id","rank");--> statement-breakpoint
CREATE INDEX "form_versions_form_idx" ON "form_versions" USING btree ("form_id","version_number");--> statement-breakpoint
CREATE INDEX "forms_base_status_idx" ON "forms" USING btree ("base_id","status");--> statement-breakpoint
CREATE INDEX "forms_org_status_idx" ON "forms" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "records_table_status_rank_idx" ON "records" USING btree ("table_id","status","rank");--> statement-breakpoint
CREATE INDEX "records_org_status_idx" ON "records" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_preferences_user_resource_idx" ON "resource_preferences" USING btree ("org_id","user_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "tables_base_status_rank_idx" ON "tables" USING btree ("base_id","status","rank");--> statement-breakpoint
CREATE INDEX "tables_org_status_idx" ON "tables" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "view_field_configs_view_field_idx" ON "view_field_configs" USING btree ("view_id","field_id");--> statement-breakpoint
CREATE INDEX "views_table_status_rank_idx" ON "views" USING btree ("table_id","status","rank");--> statement-breakpoint
CREATE INDEX "views_org_status_idx" ON "views" USING btree ("org_id","status");