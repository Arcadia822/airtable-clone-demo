CREATE TABLE "ai_write_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"operation" text NOT NULL,
	"input_hash" text NOT NULL,
	"input" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ai_write_proposals_user_expiry_idx" ON "ai_write_proposals" USING btree ("org_id","user_id","expires_at");