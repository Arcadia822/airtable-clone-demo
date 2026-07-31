import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import {
  baseCount,
  fieldCount,
  formCount,
  recordCount,
  submissionCount,
  tableCount,
  tableRecordCount,
} from "./lib/aggregates";
import { requireOrgAdmin, requireOrgIdentity } from "./lib/auth";
import { userActor, writeAudit } from "./lib/audit";
import {
  validateFieldConfiguration,
  validateRecordValues,
} from "./lib/cells";
import {
  DEMO_FEEDBACK_FORM,
  DEMO_SEED_BASE_DESCRIPTION,
  DEMO_SEED_BASE_NAME,
  DEMO_SEED_COUNTS,
  DEMO_SEED_TABLES,
  DEMO_SEED_TEMPLATE_KEY,
  DEMO_SEED_TEMPLATE_VERSION,
  demoAnalyticsDays,
  demoSubmissionTimestamp,
  resolveDemoSeedValue,
} from "./lib/demoSeedData";
import {
  createFriendlyFormSlug,
  migrateOpaqueFormSlug,
} from "./lib/formSlugs";
import { monthKey, PLAN_LIMITS } from "./lib/quotas";
import { createDefaultViewForTable } from "./lib/viewData";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_DEMO_STAT_BUCKETS = 200;

const countsValidator = v.object({
  tables: v.number(),
  fields: v.number(),
  records: v.number(),
  forms: v.number(),
});

const installResultValidator = v.object({
  state: v.union(
    v.literal("created"),
    v.literal("existing"),
    v.literal("deleted"),
    v.literal("missing"),
  ),
  baseId: v.id("bases"),
  formId: v.id("forms"),
  publicFormSlug: v.string(),
  counts: countsValidator,
});

const statusResultValidator = v.object({
  state: v.union(
    v.literal("not_installed"),
    v.literal("existing"),
    v.literal("deleted"),
    v.literal("missing"),
  ),
  baseId: v.union(v.id("bases"), v.null()),
  formId: v.union(v.id("forms"), v.null()),
  publicFormSlug: v.union(v.string(), v.null()),
  counts: countsValidator,
});

type InstallState = "created" | "existing" | "deleted" | "missing";

type InstallMarker = {
  baseId: Id<"bases">;
  formId: Id<"forms">;
  publicFormSlug: string;
  counts: {
    tables: number;
    fields: number;
    records: number;
    forms: number;
  };
};

function installResult(
  marker: InstallMarker,
  state: InstallState,
): {
  state: InstallState;
  baseId: Id<"bases">;
  formId: Id<"forms">;
  publicFormSlug: string;
  counts: {
    tables: number;
    fields: number;
    records: number;
    forms: number;
  };
} {
  return {
    state,
    baseId: marker.baseId,
    formId: marker.formId,
    publicFormSlug: marker.publicFormSlug,
    counts: marker.counts,
  };
}

function requireInserted<T>(doc: T | null, resource: string): T {
  if (doc === null) {
    throw new ConvexError({
      code: "DEMO_SEED_INSERT_FAILED",
      resource,
    });
  }
  return doc;
}

async function refreshDemoFormStats(
  ctx: Pick<MutationCtx, "db">,
  orgId: string,
  formId: Id<"forms">,
): Promise<void> {
  const buckets = await ctx.db
    .query("formMetricBuckets")
    .withIndex("by_form_and_day", (q) => q.eq("formId", formId))
    .take(MAX_DEMO_STAT_BUCKETS + 1);
  if (buckets.length > MAX_DEMO_STAT_BUCKETS) {
    throw new ConvexError({
      code: "DEMO_SEED_FIXTURE_INVALID",
      resource: "form_stat_buckets",
    });
  }
  const totals = buckets.reduce(
    (sum, bucket) => {
      if (bucket.metric === "view") sum.views += bucket.count;
      if (bucket.metric === "submission") {
        sum.submissions += bucket.count;
      }
      return sum;
    },
    { views: 0, submissions: 0 },
  );
  const existing = await ctx.db
    .query("formStats")
    .withIndex("by_form", (q) => q.eq("formId", formId))
    .unique();
  const values = {
    orgId,
    formId,
    ...totals,
    updatedAt: Date.now(),
  };
  if (existing) {
    await ctx.db.patch(existing._id, values);
  } else {
    await ctx.db.insert("formStats", values);
  }
}

function assertCapacity(
  current: number,
  requested: number,
  limit: number,
  resource: string,
): void {
  if (current + requested > limit) {
    throw new ConvexError({
      code: "QUOTA_EXCEEDED",
      resource,
      current,
      requested,
      limit,
    });
  }
}

function requiredId<
  T extends "tables" | "fields" | "formVersionFields",
>(
  ids: ReadonlyMap<string, Id<T>>,
  key: string,
  resource: string,
): Id<T> {
  const id = ids.get(key);
  if (!id) {
    throw new ConvexError({
      code: "DEMO_SEED_FIXTURE_INVALID",
      resource,
      key,
    });
  }
  return id;
}

export const status = query({
  args: {},
  returns: statusResultValidator,
  handler: async (ctx) => {
    const identity = await requireOrgIdentity(ctx);
    const marker = await ctx.db
      .query("demoSeedInstalls")
      .withIndex("by_org_id_and_template_key", (q) =>
        q
          .eq("orgId", identity.orgId)
          .eq("templateKey", DEMO_SEED_TEMPLATE_KEY),
      )
      .unique();

    if (!marker) {
      return {
        state: "not_installed" as const,
        baseId: null,
        formId: null,
        publicFormSlug: null,
        counts: DEMO_SEED_COUNTS,
      };
    }

    const base = await ctx.db.get(marker.baseId);
    if (base === null) {
      return {
        state: "missing" as const,
        baseId: marker.baseId,
        formId: marker.formId,
        publicFormSlug: marker.publicFormSlug,
        counts: marker.counts,
      };
    }
    return {
      state:
        base.status === "active"
          ? ("existing" as const)
          : ("deleted" as const),
      baseId: marker.baseId,
      formId: marker.formId,
      publicFormSlug: marker.publicFormSlug,
      counts: marker.counts,
    };
  },
});

export const install = mutation({
  args: {},
  returns: installResultValidator,
  handler: async (ctx) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);

    const existingMarker = await ctx.db
      .query("demoSeedInstalls")
      .withIndex("by_org_id_and_template_key", (q) =>
        q
          .eq("orgId", identity.orgId)
          .eq("templateKey", DEMO_SEED_TEMPLATE_KEY),
      )
      .unique();
    if (existingMarker) {
      const existingBase = await ctx.db.get(existingMarker.baseId);
      const existingForm = await ctx.db.get(existingMarker.formId);
      let publicFormSlug = existingMarker.publicFormSlug;
      if (existingForm) {
        const migration = await migrateOpaqueFormSlug(
          ctx,
          existingForm,
          DEMO_FEEDBACK_FORM.name,
        );
        publicFormSlug = migration.slug;
        if (
          migration.changed ||
          existingMarker.publicFormSlug !== publicFormSlug
        ) {
          await ctx.db.patch(existingMarker._id, {
            publicFormSlug,
            updatedAt: Date.now(),
          });
        }
        await refreshDemoFormStats(
          ctx,
          identity.orgId,
          existingMarker.formId,
        );
      }
      return installResult(
        { ...existingMarker, publicFormSlug },
        existingBase === null
          ? "missing"
          : existingBase.status === "active"
            ? "existing"
            : "deleted",
      );
    }

    const limits = PLAN_LIMITS[identity.plan];
    const basesUsed = await baseCount.count(ctx, {
      namespace: identity.orgId,
    });
    const recordsUsed = await recordCount.count(ctx, {
      namespace: identity.orgId,
    });
    assertCapacity(basesUsed, 1, limits.bases, "bases");
    assertCapacity(
      0,
      DEMO_SEED_COUNTS.tables,
      limits.tablesPerBase,
      "tables_per_base",
    );
    assertCapacity(
      recordsUsed,
      DEMO_SEED_COUNTS.records,
      limits.recordsPerOrg,
      "records_per_org",
    );
    assertCapacity(
      0,
      DEMO_SEED_COUNTS.forms,
      limits.formsPerBase,
      "forms_per_base",
    );
    for (const table of DEMO_SEED_TABLES) {
      assertCapacity(
        0,
        table.fields.length,
        limits.fieldsPerTable,
        "fields_per_table",
      );
      if (table.fields.filter((field) => field.isPrimary).length !== 1) {
        throw new ConvexError({
          code: "DEMO_SEED_FIXTURE_INVALID",
          resource: "primary_field_count",
          table: table.key,
        });
      }
      for (const field of table.fields) {
        validateFieldConfiguration(field.type, field.config);
      }
    }

    const now = Date.now();
    const todayUtc = Date.parse(
      `${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`,
    );
    const publishedAt = todayUtc - 14 * DAY_MS;
    const feedbackSeed = DEMO_SEED_TABLES.find(
      (table) => table.key === "feedback",
    );
    if (!feedbackSeed) {
      throw new ConvexError({
        code: "DEMO_SEED_FIXTURE_INVALID",
        resource: "feedback_table",
      });
    }
    const feedbackSubmissionTimes = feedbackSeed.records.map((record) => {
      if (record.submittedDaysAgo === undefined) {
        throw new ConvexError({
          code: "DEMO_SEED_FIXTURE_INVALID",
          resource: "feedback_submission_date",
        });
      }
      return demoSubmissionTimestamp(now, record.submittedDaysAgo);
    });
    const submissionsByMonth = new Map<string, number>();
    for (const submittedAt of feedbackSubmissionTimes) {
      const month = monthKey(submittedAt);
      submissionsByMonth.set(month, (submissionsByMonth.get(month) ?? 0) + 1);
    }
    for (const [month, requested] of submissionsByMonth) {
      const submissionsUsed = await submissionCount.count(ctx, {
        namespace: `${identity.orgId}:${month}`,
      });
      assertCapacity(
        submissionsUsed,
        requested,
        limits.submissionsPerMonth,
        "submissions_per_month",
      );
    }

    const baseId = await ctx.db.insert("bases", {
      orgId: identity.orgId,
      name: DEMO_SEED_BASE_NAME,
      description: DEMO_SEED_BASE_DESCRIPTION,
      color: "#6d5dfc",
      rank: "a0",
      status: "active",
      createdByUserId: identity.userId,
      updatedAt: now,
    });
    const base = requireInserted(await ctx.db.get(baseId), "base");
    await baseCount.insert(ctx, base);

    const tableIds = new Map<string, Id<"tables">>();
    const fieldIdsByTable = new Map<
      string,
      ReadonlyMap<string, Id<"fields">>
    >();

    for (const tableSeed of DEMO_SEED_TABLES) {
      const tableId = await ctx.db.insert("tables", {
        orgId: identity.orgId,
        baseId,
        name: tableSeed.name,
        rank: tableSeed.rank,
        status: "active",
        createdByUserId: identity.userId,
        updatedAt: now,
      });
      tableIds.set(tableSeed.key, tableId);

      const fieldIds = new Map<string, Id<"fields">>();
      let primaryFieldId: Id<"fields"> | null = null;
      for (const fieldSeed of tableSeed.fields) {
        const fieldId = await ctx.db.insert("fields", {
          orgId: identity.orgId,
          baseId,
          tableId,
          name: fieldSeed.name,
          type: fieldSeed.type,
          config: fieldSeed.config,
          rank: fieldSeed.rank,
          width: fieldSeed.width,
          isPrimary: fieldSeed.isPrimary,
          status: "active",
          revision: 1,
          createdByUserId: identity.userId,
          updatedAt: now,
        });
        fieldIds.set(fieldSeed.key, fieldId);
        if (fieldSeed.isPrimary) {
          if (primaryFieldId !== null) {
            throw new ConvexError({
              code: "DEMO_SEED_FIXTURE_INVALID",
              resource: "multiple_primary_fields",
              table: tableSeed.key,
            });
          }
          primaryFieldId = fieldId;
        }
        const field = requireInserted(await ctx.db.get(fieldId), "field");
        await fieldCount.insert(ctx, field);
      }
      if (primaryFieldId === null) {
        throw new ConvexError({
          code: "DEMO_SEED_FIXTURE_INVALID",
          resource: "missing_primary_field",
          table: tableSeed.key,
        });
      }
      await ctx.db.patch(tableId, { primaryFieldId });
      const table = requireInserted(await ctx.db.get(tableId), "table");
      await tableCount.insert(ctx, table);
      await createDefaultViewForTable(ctx, {
        table,
        createdByUserId: identity.userId,
      });
      fieldIdsByTable.set(tableSeed.key, fieldIds);
    }

    const feedbackTableId = requiredId(
      tableIds,
      "feedback",
      "feedback_table",
    );
    const feedbackFieldIds = fieldIdsByTable.get("feedback");
    if (!feedbackFieldIds) {
      throw new ConvexError({
        code: "DEMO_SEED_FIXTURE_INVALID",
        resource: "feedback_fields",
      });
    }

    const publicFormSlug = await createFriendlyFormSlug(
      ctx,
      DEMO_FEEDBACK_FORM.name,
    );
    const formId = await ctx.db.insert("forms", {
      orgId: identity.orgId,
      baseId,
      tableId: feedbackTableId,
      name: DEMO_FEEDBACK_FORM.name,
      slug: publicFormSlug,
      title: DEMO_FEEDBACK_FORM.title,
      description: DEMO_FEEDBACK_FORM.description,
      rank: "a0",
      status: "published",
      appearance: DEMO_FEEDBACK_FORM.appearance,
      thankYou: DEMO_FEEDBACK_FORM.thankYou,
      allowMultipleSubmissions: true,
      draftRevision: 1,
      createdByUserId: identity.userId,
      updatedAt: now,
      publishedAt,
    });
    const formVersionId = await ctx.db.insert("formVersions", {
      orgId: identity.orgId,
      formId,
      baseId,
      tableId: feedbackTableId,
      version: 1,
      title: DEMO_FEEDBACK_FORM.title,
      description: DEMO_FEEDBACK_FORM.description,
      appearance: DEMO_FEEDBACK_FORM.appearance,
      thankYou: DEMO_FEEDBACK_FORM.thankYou,
      publishedByUserId: identity.userId,
      publishedAt,
    });

    const publishedQuestionIds = new Map<
      string,
      Id<"formVersionFields">
    >();
    for (const mapping of DEMO_FEEDBACK_FORM.mappedFieldKeys) {
      const targetFieldId = requiredId(
        feedbackFieldIds,
        mapping.key,
        "feedback_form_field",
      );
      const targetField = requireInserted(
        await ctx.db.get(targetFieldId),
        "feedback_form_field",
      );
      await ctx.db.insert("formDraftFields", {
        orgId: identity.orgId,
        formId,
        targetFieldId,
        label: mapping.label,
        description: mapping.description?.trim() || undefined,
        placeholder: mapping.placeholder?.trim() || undefined,
        required: mapping.required,
        rank: mapping.rank,
      });
      const publishedQuestionId = await ctx.db.insert("formVersionFields", {
        orgId: identity.orgId,
        formId,
        formVersionId,
        targetFieldId,
        targetFieldType: targetField.type,
        targetFieldConfig: targetField.config,
        label: mapping.label,
        description: mapping.description?.trim() || undefined,
        placeholder: mapping.placeholder?.trim() || undefined,
        required: mapping.required,
        rank: mapping.rank,
      });
      publishedQuestionIds.set(mapping.key, publishedQuestionId);
      await ctx.db.insert("formPublishedFieldRefs", {
        orgId: identity.orgId,
        formId,
        formVersionId,
        targetFieldId,
      });
    }
    await ctx.db.patch(formId, {
      currentPublishedVersionId: formVersionId,
    });
    const form = requireInserted(await ctx.db.get(formId), "form");
    await formCount.insert(ctx, form);

    const feedbackSubmissions: Array<{
      recordId: Id<"records">;
      submittedAt: number;
    }> = [];
    for (const tableSeed of DEMO_SEED_TABLES) {
      const tableId = requiredId(tableIds, tableSeed.key, "table");
      const fieldIds = fieldIdsByTable.get(tableSeed.key);
      if (!fieldIds) {
        throw new ConvexError({
          code: "DEMO_SEED_FIXTURE_INVALID",
          resource: "table_fields",
          table: tableSeed.key,
        });
      }
      for (const recordSeed of tableSeed.records) {
        const values: Doc<"records">["values"] = {};
        for (const [fieldKey, seedValue] of Object.entries(recordSeed.values)) {
          const fieldId = requiredId(fieldIds, fieldKey, "record_field");
          values[fieldId] = resolveDemoSeedValue(seedValue, todayUtc);
        }
        await validateRecordValues(
          ctx,
          identity.orgId,
          tableId,
          values,
        );
        const isPublicSubmission = tableSeed.key === "feedback";
        const actorType = isPublicSubmission ? "public_form" : "user";
        const actorId = isPublicSubmission ? formId : identity.userId;
        const recordId = await ctx.db.insert("records", {
          orgId: identity.orgId,
          baseId,
          tableId,
          rank: recordSeed.rank,
          values,
          status: "active",
          revision: 1,
          createdByType: actorType,
          createdById: actorId,
          updatedByType: actorType,
          updatedById: actorId,
          updatedAt: now - recordSeed.updatedDaysAgo * DAY_MS,
        });
        const record = requireInserted(await ctx.db.get(recordId), "record");
        await recordCount.insert(ctx, record);
        await tableRecordCount.insert(ctx, record);

        if (isPublicSubmission) {
          if (recordSeed.submittedDaysAgo === undefined) {
            throw new ConvexError({
              code: "DEMO_SEED_FIXTURE_INVALID",
              resource: "feedback_submission_date",
            });
          }
          feedbackSubmissions.push({
            recordId,
            submittedAt: demoSubmissionTimestamp(
              now,
              recordSeed.submittedDaysAgo,
            ),
          });
        }
      }
    }

    for (const [index, submission] of feedbackSubmissions.entries()) {
      const submittedMonth = monthKey(submission.submittedAt);
      const submissionId = await ctx.db.insert("formSubmissions", {
        orgId: identity.orgId,
        formId,
        formVersionId,
        recordId: submission.recordId,
        idempotencyKey: `demo-seed-v${DEMO_SEED_TEMPLATE_VERSION}-${index + 1}`,
        submittedMonth,
        submittedAt: submission.submittedAt,
      });
      const submitted = requireInserted(
        await ctx.db.get(submissionId),
        "form_submission",
      );
      await submissionCount.insert(ctx, submitted);
    }

    for (const day of demoAnalyticsDays(now)) {
      const metrics = [
        ["view", day.views],
        ["start", day.starts],
        ["submission", day.submissions],
        ["validation_error", day.validationErrors],
        ["abandonment", day.abandonments],
      ] as const;
      for (const [metric, count] of metrics) {
        await ctx.db.insert("formMetricBuckets", {
          orgId: identity.orgId,
          formId,
          formVersionId,
          day: day.day,
          metric,
          shard: 0,
          count,
          updatedAt: now,
        });
      }

      const desktop = Math.round(day.views * 0.54);
      const mobile = Math.round(day.views * 0.31);
      const tablet = day.views - desktop - mobile;
      const search = Math.round(day.views * 0.38);
      const campaign = Math.round(day.views * 0.27);
      const direct = Math.round(day.views * 0.21);
      const referral = day.views - search - campaign - direct;
      const summaryQuestionId = requiredId(
        publishedQuestionIds,
        "summary",
        "published_feedback_question",
      );
      const detailsQuestionId = requiredId(
        publishedQuestionIds,
        "details",
        "published_feedback_question",
      );
      const summaryExits = Math.round(day.abandonments * 0.58);
      const detailsExits = day.abandonments - summaryExits;
      for (const [kind, dimension, count] of [
        ["device", "desktop", desktop],
        ["device", "mobile", mobile],
        ["device", "tablet", tablet],
        ["traffic_source", "search", search],
        ["traffic_source", "campaign", campaign],
        ["traffic_source", "direct", direct],
        ["traffic_source", "referral", referral],
        ["question_exit", summaryQuestionId, summaryExits],
        ["question_exit", detailsQuestionId, detailsExits],
      ] as const) {
        if (count === 0) continue;
        await ctx.db.insert("formAnalyticsBreakdownBuckets", {
          orgId: identity.orgId,
          formId,
          formVersionId,
          day: day.day,
          kind,
          dimension,
          shard: 0,
          count,
          updatedAt: now,
        });
      }
    }

    await refreshDemoFormStats(ctx, identity.orgId, formId);

    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "demo_seed.installed",
      resourceType: "base",
      resourceId: baseId,
      baseId,
    });

    const markerId = await ctx.db.insert("demoSeedInstalls", {
      orgId: identity.orgId,
      templateKey: DEMO_SEED_TEMPLATE_KEY,
      templateVersion: DEMO_SEED_TEMPLATE_VERSION,
      baseId,
      formId,
      publicFormSlug,
      counts: DEMO_SEED_COUNTS,
      installedByUserId: identity.userId,
      installedAt: now,
      updatedAt: now,
    });
    const marker = requireInserted(
      await ctx.db.get(markerId),
      "demo_seed_marker",
    );
    return installResult(marker, "created");
  },
});
