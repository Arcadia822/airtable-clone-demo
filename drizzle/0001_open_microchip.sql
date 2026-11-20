CREATE TABLE "attachment_blobs" (
	"attachment_id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"byte_size" integer NOT NULL,
	"chunk_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachment_chunks" (
	"attachment_id" text NOT NULL,
	"seq" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	CONSTRAINT "attachment_chunks_attachment_id_seq_pk" PRIMARY KEY("attachment_id","seq")
);
--> statement-breakpoint
ALTER TABLE "attachment_blobs" ADD CONSTRAINT "attachment_blobs_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_chunks_attachment_idx" ON "attachment_chunks" USING btree ("attachment_id");