DROP INDEX "form_versions_form_idx";--> statement-breakpoint
DELETE FROM "form_metric_buckets" a
	USING "form_metric_buckets" b
	WHERE a.ctid > b.ctid
		AND a."form_id" = b."form_id"
		AND a."day" = b."day"
		AND a."metric" = b."metric"
		AND a."breakdown_kind" IS NOT DISTINCT FROM b."breakdown_kind"
		AND a."breakdown_key" IS NOT DISTINCT FROM b."breakdown_key";--> statement-breakpoint
CREATE UNIQUE INDEX "form_metric_buckets_identity_idx" ON "form_metric_buckets" USING btree ("form_id","day","metric","breakdown_kind","breakdown_key");--> statement-breakpoint
DELETE FROM "form_versions" a
	USING "form_versions" b
	WHERE a.ctid > b.ctid
		AND a."form_id" = b."form_id"
		AND a."version_number" = b."version_number";--> statement-breakpoint
CREATE UNIQUE INDEX "form_versions_form_version_idx" ON "form_versions" USING btree ("form_id","version_number");
