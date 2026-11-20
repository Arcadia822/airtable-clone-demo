DROP INDEX "form_versions_form_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "form_metric_buckets_identity_idx" ON "form_metric_buckets" USING btree ("form_id","day","metric","breakdown_kind","breakdown_key");--> statement-breakpoint
CREATE UNIQUE INDEX "form_versions_form_version_idx" ON "form_versions" USING btree ("form_id","version_number");