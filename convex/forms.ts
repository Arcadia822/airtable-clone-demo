import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import {
  attachmentBytes,
  formCount,
  recordCount,
  submissionCount,
  tableRecordCount,
} from "./lib/aggregates";
import {
  requireFeature,
  requireOrgAdmin,
  requireOrgIdentity,
} from "./lib/auth";
import { userActor, writeAudit } from "./lib/audit";
import { validateRecordValues } from "./lib/cells";
import {
  compareRanks,
  createRank,
  hasActiveFormParents,
  requireBase,
  requireForm,
  requireTable,
} from "./lib/data";
import { incrementFormStat } from "./lib/formStats";
import { recordTableViewChange } from "./lib/viewChanges";
import {
  analyticsDayAt,
  normalizeAnalyticsTimeZone,
} from "./lib/analyticsTimeZone";
import { validateCellValue } from "./lib/cells";
import {
  assertBelowQuota,
  FEATURE_SLUGS,
  PLAN_LIMITS,
  PUBLIC_SUBMISSION_SESSION_TTL_MS,
  type PlanTier,
  monthKey,
} from "./lib/quotas";
import { rateLimiter } from "./lib/rateLimits";
import {
  formAnswerValidator,
  formAppearanceInputValidator,
  formDraftVisibilityRuleValidator,
  formQuestionModeValidator,
  nullableCellValueValidator,
  planTierValidator,
  thankYouValidator,
} from "./lib/validators";
import {
  visibleFormQuestions,
  type ConditionalFormQuestion,
  type FormAnswerValue,
  type FormConditionOperator,
  type FormConditionValue,
} from "../src/lib/form-conditional-logic";
import {
  createFriendlyFormSlug,
  resolveFormBySlug,
} from "./lib/formSlugs";

const DEFAULT_APPEARANCE = {
  primaryColor: "#2563eb",
  backgroundColor: "#ffffff",
  submitLabel: "Submit",
  showPoweredBy: true,
  layout: "card" as const,
} as const;

const DEFAULT_THANK_YOU = {
  title: "Thank you for your submission",
  message: "Your response has been recorded.",
} as const;

const MAX_ARCHIVED_FORMS = PLAN_LIMITS.pro.formsPerBase * 5;
const MAX_SUBMISSION_EXPORT_ROWS = 250;
const MAX_FORM_APPEARANCE_IMAGE_BYTES = 8 * 1024 * 1024;
const FORM_APPEARANCE_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const FORM_PREFILL_PARAMETER_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const RESERVED_PREFILL_PARAMETERS = new Set([
  "embed",
  "form",
  "preview",
  "slug",
  "submission",
  "token",
  "turnstile",
  "version",
]);

const formDraftFieldInputValidator = v.object({
  targetFieldId: v.id("fields"),
  label: v.string(),
  description: v.optional(v.string()),
  placeholder: v.optional(v.string()),
  required: v.boolean(),
  rank: v.string(),
  mode: v.optional(formQuestionModeValidator),
  fixedValue: v.optional(nullableCellValueValidator),
  prefillParameter: v.optional(v.string()),
  visibility: v.optional(formDraftVisibilityRuleValidator),
});

const submissionListItemValidator = v.object({
  submissionId: v.id("formSubmissions"),
  recordId: v.id("records"),
  submittedAt: v.number(),
  version: v.number(),
  responseLabel: v.string(),
  recordStatus: v.union(v.literal("active"), v.literal("deleted")),
});

const submissionPageValidator = v.object({
  page: v.array(submissionListItemValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

const submissionWorkspaceValidator = v.object({
  formName: v.string(),
  formStatus: v.union(
    v.literal("draft"),
    v.literal("published"),
    v.literal("closed"),
    v.literal("deleted"),
  ),
  baseId: v.id("bases"),
  baseName: v.string(),
  tableId: v.id("tables"),
  tableName: v.string(),
});

const submissionDetailValidator = v.union(
  v.null(),
  v.object({
    submittedAt: v.number(),
    version: v.number(),
    responseLabel: v.string(),
    recordId: v.id("records"),
    recordStatus: v.union(v.literal("active"), v.literal("deleted")),
    baseId: v.id("bases"),
    tableId: v.id("tables"),
    tableName: v.string(),
    answers: v.array(
      v.object({
        question: v.string(),
        displayValue: v.string(),
        hasAnswer: v.boolean(),
        automatic: v.boolean(),
      }),
    ),
  }),
);

const submissionExportValidator = v.object({
  formName: v.string(),
  columns: v.array(v.string()),
  rows: v.array(
    v.object({
      submittedAt: v.number(),
      version: v.number(),
      responseLabel: v.string(),
      answers: v.array(v.string()),
    }),
  ),
  truncated: v.boolean(),
});

type DraftFieldInput = {
  targetFieldId: Id<"fields">;
  label: string;
  description?: string;
  placeholder?: string;
  required: boolean;
  rank: string;
  mode?: "visible" | "hidden";
  fixedValue?: string | number | boolean | string[] | null;
  prefillParameter?: string;
  visibility?: {
    conjunction: "and" | "or";
    conditions: {
      id: string;
      sourceFieldId: Id<"fields">;
      operator: FormConditionOperator;
      value?: FormConditionValue;
    }[];
  };
};

function validateDraftVisibility(
  fields: readonly DraftFieldInput[],
): void {
  const questionIndexByFieldId = new Map(
    fields.map((field, index) => [field.targetFieldId, index]),
  );

  for (const [questionIndex, field] of fields.entries()) {
    const conditions = field.visibility?.conditions ?? [];
    if (conditions.length > 20) {
      throw new ConvexError({ code: "INVALID_FORM_VISIBILITY_RULE" });
    }
    const conditionIds = new Set<string>();
    for (const condition of conditions) {
      const sourceIndex = questionIndexByFieldId.get(
        condition.sourceFieldId,
      );
      if (
        !condition.id.trim() ||
        condition.id.length > 200 ||
        conditionIds.has(condition.id) ||
        sourceIndex === undefined ||
        sourceIndex >= questionIndex
      ) {
        throw new ConvexError({ code: "INVALID_FORM_VISIBILITY_RULE" });
      }
      conditionIds.add(condition.id);
    }
  }
}

function hasFixedValue(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  return !(
    value === undefined ||
    value === null ||
    (Array.isArray(value) && value.length === 0)
  );
}

async function validateDraftFieldsAndDestinations(
  ctx: MutationCtx,
  orgId: string,
  form: Pick<Doc<"forms">, "tableId">,
  inputs: readonly DraftFieldInput[],
): Promise<Map<Id<"fields">, Doc<"fields">>> {
  const targetIds = new Set<string>();
  const prefillParameters = new Set<string>();
  const targetFields = new Map<Id<"fields">, Doc<"fields">>();

  for (const input of inputs) {
    if (targetIds.has(input.targetFieldId)) {
      throw new ConvexError({ code: "DUPLICATE_FORM_TARGET_FIELD" });
    }
    targetIds.add(input.targetFieldId);
    const field = await ctx.db.get(input.targetFieldId);
    if (
      !field ||
      field.orgId !== orgId ||
      field.tableId !== form.tableId ||
      field.status !== "active" ||
      field.type === "createdTime" ||
      field.type === "createdBy"
    ) {
      throw new ConvexError({ code: "FORM_TARGET_FIELD_NOT_FOUND" });
    }
    if (!input.label.trim() || input.label.length > 160) {
      throw new ConvexError({ code: "INVALID_FORM_FIELD_LABEL" });
    }
    if (
      (input.description?.length ?? 0) > 2_000 ||
      (input.placeholder?.length ?? 0) > 500
    ) {
      throw new ConvexError({ code: "INVALID_FORM_FIELD_COPY" });
    }

    const mode = input.mode ?? "visible";
    if (mode === "hidden") {
      if (
        field.type === "attachment" ||
        !hasFixedValue(input.fixedValue) ||
        input.prefillParameter !== undefined ||
        Boolean(input.visibility?.conditions.length)
      ) {
        throw new ConvexError({ code: "INVALID_HIDDEN_FORM_VALUE" });
      }
      await validateCellValue(ctx, field, input.fixedValue);
    } else {
      if (input.fixedValue !== undefined) {
        throw new ConvexError({ code: "INVALID_VISIBLE_FORM_VALUE" });
      }
      if (input.prefillParameter !== undefined) {
        const parameter = input.prefillParameter.trim();
        if (
          !FORM_PREFILL_PARAMETER_PATTERN.test(parameter) ||
          RESERVED_PREFILL_PARAMETERS.has(parameter) ||
          prefillParameters.has(parameter)
        ) {
          throw new ConvexError({
            code: "INVALID_FORM_PREFILL_PARAMETER",
          });
        }
        prefillParameters.add(parameter);
      }
    }
    targetFields.set(field._id, field);
  }

  validateDraftVisibility(inputs);
  return targetFields;
}

function storedDraftField(input: DraftFieldInput) {
  const mode = input.mode ?? "visible";
  return {
    targetFieldId: input.targetFieldId,
    label: input.label.trim(),
    description: input.description?.trim() || undefined,
    placeholder:
      mode === "visible"
        ? input.placeholder?.trim() || undefined
        : undefined,
    required: mode === "hidden" ? true : input.required,
    rank: input.rank,
    mode,
    fixedValue: mode === "hidden" ? input.fixedValue : undefined,
    prefillParameter:
      mode === "visible"
        ? input.prefillParameter?.trim() || undefined
        : undefined,
    visibility:
      mode === "visible" && input.visibility?.conditions.length
        ? input.visibility
        : undefined,
  };
}

type SubmissionDisplayField = Pick<
  Doc<"formVersionFields">,
  "targetFieldType" | "targetFieldConfig"
>;

function submissionAnswerMap(
  submission: Doc<"formSubmissions">,
  record: Doc<"records"> | null,
  questions: readonly Doc<"formVersionFields">[],
): Map<Id<"formVersionFields">, FormAnswerValue> {
  if (submission.answersSnapshot) {
    return new Map(
      submission.answersSnapshot.map((answer) => [
        answer.formVersionFieldId,
        answer.value as FormAnswerValue,
      ]),
    );
  }
  return new Map(
    questions.map((question) => [
      question._id,
      record?.values[question.targetFieldId] as FormAnswerValue,
    ]),
  );
}

async function submissionDisplayValue(
  ctx: Pick<QueryCtx, "db">,
  field: SubmissionDisplayField,
  value: FormAnswerValue,
  resolveAttachmentNames: boolean,
): Promise<string> {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return "";
  }
  if (field.targetFieldType === "checkbox") {
    return value === true ? "Yes" : "No";
  }
  if (
    field.targetFieldType === "singleSelect" &&
    typeof value === "string"
  ) {
    return (
      field.targetFieldConfig.options?.find(
        (option) => option.id === value,
      )?.label ?? "Unavailable choice"
    );
  }
  if (
    field.targetFieldType === "multiSelect" &&
    Array.isArray(value)
  ) {
    return value
      .map(
        (optionId) =>
          field.targetFieldConfig.options?.find(
            (option) => option.id === optionId,
          )?.label ?? "Unavailable choice",
      )
      .join(", ");
  }
  if (
    field.targetFieldType === "attachment" &&
    Array.isArray(value)
  ) {
    if (!resolveAttachmentNames) {
      return `${value.length} ${value.length === 1 ? "file" : "files"}`;
    }
    const names: string[] = [];
    for (const attachmentId of value) {
      const attachment = await ctx.db.get(
        attachmentId as Id<"attachments">,
      );
      names.push(attachment?.fileName ?? "Unavailable file");
    }
    return names.join(", ");
  }
  if (field.targetFieldType === "percent" && typeof value === "number") {
    return `${new Intl.NumberFormat("en", {
      maximumFractionDigits: 4,
    }).format(value * 100)}%`;
  }
  if (field.targetFieldType === "currency" && typeof value === "number") {
    try {
      return new Intl.NumberFormat("en", {
        style: "currency",
        currency: field.targetFieldConfig.currency ?? "USD",
      }).format(value);
    } catch {
      return new Intl.NumberFormat("en").format(value);
    }
  }
  if (
    (field.targetFieldType === "number" ||
      field.targetFieldType === "rating") &&
    typeof value === "number"
  ) {
    return new Intl.NumberFormat("en", {
      maximumFractionDigits: 12,
    }).format(value);
  }
  if (field.targetFieldType === "date") {
    const parsed =
      typeof value === "number"
        ? new Date(value)
        : typeof value === "string"
          ? new Date(
              /^\d{4}-\d{2}-\d{2}$/.test(value)
                ? `${value}T00:00:00.000Z`
                : value,
            )
          : null;
    if (parsed && !Number.isNaN(parsed.getTime())) {
      return field.targetFieldConfig.dateStyle === "dateTime"
        ? parsed.toISOString()
        : parsed.toISOString().slice(0, 10);
    }
  }
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

async function responseLabel(
  ctx: Pick<QueryCtx, "db">,
  table: Doc<"tables">,
  record: Doc<"records"> | null,
  questions: readonly Doc<"formVersionFields">[],
  answers: ReadonlyMap<Id<"formVersionFields">, FormAnswerValue>,
): Promise<string> {
  if (!table.primaryFieldId) return "Untitled response";
  const primaryQuestion = questions.find(
    (question) => question.targetFieldId === table.primaryFieldId,
  );
  if (primaryQuestion) {
    const label = await submissionDisplayValue(
      ctx,
      primaryQuestion,
      answers.get(primaryQuestion._id),
      false,
    );
    return label.trim() || "Untitled response";
  }
  const primaryField = await ctx.db.get(table.primaryFieldId);
  if (!primaryField || primaryField.orgId !== table.orgId) {
    return "Untitled response";
  }
  const label = await submissionDisplayValue(
    ctx,
    {
      targetFieldType: primaryField.type,
      targetFieldConfig: primaryField.config,
    },
    record?.values[primaryField._id] as FormAnswerValue,
    false,
  );
  return label.trim() || "Untitled response";
}

function validateAppearance(
  appearance: Doc<"forms">["appearance"],
): void {
  if (
    !/^#[0-9a-f]{6}$/i.test(appearance.primaryColor) ||
    !/^#[0-9a-f]{6}$/i.test(appearance.backgroundColor) ||
    !appearance.submitLabel.trim() ||
    appearance.submitLabel.length > 80
  ) {
    throw new ConvexError({ code: "INVALID_FORM_APPEARANCE" });
  }
}

function usesCustomBranding(
  appearance: Doc<"forms">["appearance"],
): boolean {
  return (
    appearance.primaryColor.toLowerCase() !==
      DEFAULT_APPEARANCE.primaryColor ||
    appearance.backgroundColor.toLowerCase() !==
      DEFAULT_APPEARANCE.backgroundColor ||
    appearance.submitLabel !== DEFAULT_APPEARANCE.submitLabel ||
    appearance.showPoweredBy !== DEFAULT_APPEARANCE.showPoweredBy ||
    (appearance.layout ?? "card") !== DEFAULT_APPEARANCE.layout ||
    Boolean(appearance.logoStorageId) ||
    Boolean(appearance.coverStorageId)
  );
}

function validateThankYou(thankYou: Doc<"forms">["thankYou"]): void {
  if (
    !thankYou.title.trim() ||
    thankYou.title.length > 160 ||
    thankYou.message.length > 2_000
  ) {
    throw new ConvexError({ code: "INVALID_THANK_YOU" });
  }
  if (thankYou.redirectUrl) {
    const parsed = new URL(thankYou.redirectUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new ConvexError({ code: "INVALID_REDIRECT_URL" });
    }
  }
}

function duplicateFormName(name: string): string {
  const suffix = " copy";
  return `${name.slice(0, 120 - suffix.length).trimEnd()}${suffix}`;
}

async function deletePublishedFieldReferences(
  ctx: MutationCtx,
  formId: Id<"forms">,
): Promise<void> {
  const refs = await ctx.db
    .query("formPublishedFieldRefs")
    .withIndex("by_form", (q) => q.eq("formId", formId))
    .take(PLAN_LIMITS.pro.fieldsPerTable + 1);
  for (const ref of refs) await ctx.db.delete(ref._id);
}

function metricShard(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 16;
}

async function incrementSubmissionMetric(
  ctx: Parameters<typeof writeAudit>[0],
  form: Doc<"forms">,
  versionId: Id<"formVersions">,
  seed: string,
): Promise<void> {
  const day = analyticsDayAt(
    Date.now(),
    form.analyticsTimeZone ?? "UTC",
  );
  const shard = metricShard(seed);
  const existing = await ctx.db
    .query("formMetricBuckets")
    .withIndex("by_form_and_day_and_metric_and_shard", (q) =>
      q
        .eq("formId", form._id)
        .eq("day", day)
        .eq("metric", "submission")
        .eq("shard", shard),
    )
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      count: existing.count + 1,
      updatedAt: Date.now(),
    });
  } else {
    await ctx.db.insert("formMetricBuckets", {
      orgId: form.orgId,
      formId: form._id,
      formVersionId: versionId,
      day,
      metric: "submission",
      shard,
      count: 1,
      updatedAt: Date.now(),
    });
  }
  await incrementFormStat(ctx, {
    orgId: form.orgId,
    formId: form._id,
    metric: "submission",
  });
}

export const list = query({
  args: { baseId: v.id("bases") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    await requireBase(ctx, identity.orgId, args.baseId);
    const active = await ctx.db
      .query("forms")
      .withIndex("by_base_and_status_and_rank", (q) =>
        q.eq("baseId", args.baseId).eq("status", "published"),
      )
      .take(PLAN_LIMITS.pro.formsPerBase);
    const drafts = await ctx.db
      .query("forms")
      .withIndex("by_base_and_status_and_rank", (q) =>
        q.eq("baseId", args.baseId).eq("status", "draft"),
      )
      .take(PLAN_LIMITS.pro.formsPerBase);
    const closed = await ctx.db
      .query("forms")
      .withIndex("by_base_and_status_and_rank", (q) =>
        q.eq("baseId", args.baseId).eq("status", "closed"),
      )
      .take(PLAN_LIMITS.pro.formsPerBase);
    const forms = [...active, ...drafts, ...closed].sort(compareRanks);
    return await Promise.all(
      forms.map(async (form) => {
        const stats = await ctx.db
          .query("formStats")
          .withIndex("by_form", (q) => q.eq("formId", form._id))
          .unique();
        const views = stats?.views ?? 0;
        const submissions = stats?.submissions ?? 0;
        return {
          ...form,
          stats: {
            views,
            submissions,
            conversionRate: views > 0 ? submissions / views : 0,
          },
        };
      }),
    );
  },
});

export const listArchived = query({
  args: { baseId: v.id("bases") },
  returns: v.array(
    v.object({
      formId: v.id("forms"),
      name: v.string(),
      title: v.string(),
      tableName: v.string(),
      archivedAt: v.number(),
      willRestoreAs: v.union(v.literal("Draft"), v.literal("Closed")),
    }),
  ),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    await requireBase(ctx, identity.orgId, args.baseId);
    const forms = await ctx.db
      .query("forms")
      .withIndex("by_base_and_status_and_rank", (q) =>
        q.eq("baseId", args.baseId).eq("status", "deleted"),
      )
      .take(MAX_ARCHIVED_FORMS);
    const scopedForms = forms.filter(
      (form) => form.orgId === identity.orgId,
    );
    const tables = await Promise.all(
      scopedForms.map((form) => ctx.db.get(form.tableId)),
    );
    return scopedForms.map((form, index) => {
      const table = tables[index];
      return {
        formId: form._id,
        name: form.name,
        title: form.title,
        tableName:
          table &&
          table.orgId === identity.orgId &&
          table.baseId === args.baseId
            ? table.name
            : "Unavailable table",
        archivedAt: form.deletedAt ?? form.updatedAt,
        willRestoreAs: form.currentPublishedVersionId
          ? ("Closed" as const)
          : ("Draft" as const),
      };
    });
  },
});

export const getDraft = query({
  args: { formId: v.id("forms") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const form = await requireForm(ctx, identity.orgId, args.formId);
    const fields = await ctx.db
      .query("formDraftFields")
      .withIndex("by_form_and_rank", (q) => q.eq("formId", args.formId))
      .take(PLAN_LIMITS.pro.fieldsPerTable);
    const publishedVersion = form.currentPublishedVersionId
      ? await ctx.db.get(form.currentPublishedVersionId)
      : null;
    const publishedFields = publishedVersion
      ? await ctx.db
          .query("formVersionFields")
          .withIndex("by_version_and_rank", (q) =>
            q.eq("formVersionId", publishedVersion._id),
          )
          .take(PLAN_LIMITS.pro.fieldsPerTable)
      : [];
    const [
      draftLogoUrl,
      draftCoverUrl,
      liveLogoUrl,
      liveCoverUrl,
      draftLogoMetadata,
      draftCoverMetadata,
      liveLogoMetadata,
      liveCoverMetadata,
    ] = await Promise.all([
      form.appearance.logoStorageId
        ? ctx.storage.getUrl(form.appearance.logoStorageId)
        : null,
      form.appearance.coverStorageId
        ? ctx.storage.getUrl(form.appearance.coverStorageId)
        : null,
      publishedVersion?.appearance.logoStorageId
        ? ctx.storage.getUrl(
            publishedVersion.appearance.logoStorageId,
          )
        : null,
      publishedVersion?.appearance.coverStorageId
        ? ctx.storage.getUrl(
            publishedVersion.appearance.coverStorageId,
          )
        : null,
      form.appearance.logoStorageId
        ? ctx.db.system.get(
            "_storage",
            form.appearance.logoStorageId,
          )
        : null,
      form.appearance.coverStorageId
        ? ctx.db.system.get(
            "_storage",
            form.appearance.coverStorageId,
          )
        : null,
      publishedVersion?.appearance.logoStorageId
        ? ctx.db.system.get(
            "_storage",
            publishedVersion.appearance.logoStorageId,
          )
        : null,
      publishedVersion?.appearance.coverStorageId
        ? ctx.db.system.get(
            "_storage",
            publishedVersion.appearance.coverStorageId,
          )
        : null,
    ]);
    return {
      form: {
        _id: form._id,
        baseId: form.baseId,
        tableId: form.tableId,
        name: form.name,
        slug: form.slug,
        title: form.title,
        description: form.description,
        status: form.status,
        appearance: {
          primaryColor: form.appearance.primaryColor,
          backgroundColor: form.appearance.backgroundColor,
          submitLabel: form.appearance.submitLabel,
          showPoweredBy: form.appearance.showPoweredBy,
          layout: form.appearance.layout ?? "card",
          logoUrl: draftLogoUrl,
          coverUrl: draftCoverUrl,
          logoFingerprint: draftLogoMetadata?.sha256 ?? null,
          coverFingerprint: draftCoverMetadata?.sha256 ?? null,
        },
        thankYou: form.thankYou,
        draftRevision: form.draftRevision,
        currentPublishedVersionId: form.currentPublishedVersionId,
      },
      fields,
      liveVersion: publishedVersion
        ? {
            version: publishedVersion.version,
            publishedAt: publishedVersion.publishedAt,
            title: publishedVersion.title,
            description: publishedVersion.description,
            appearance: {
              primaryColor: publishedVersion.appearance.primaryColor,
              backgroundColor:
                publishedVersion.appearance.backgroundColor,
              submitLabel: publishedVersion.appearance.submitLabel,
              showPoweredBy:
                publishedVersion.appearance.showPoweredBy,
              layout: publishedVersion.appearance.layout ?? "card",
              logoUrl: liveLogoUrl,
              coverUrl: liveCoverUrl,
              logoFingerprint: liveLogoMetadata?.sha256 ?? null,
              coverFingerprint:
                liveCoverMetadata?.sha256 ?? null,
            },
            thankYou: publishedVersion.thankYou,
            fields: publishedFields.map((field) => ({
              targetFieldId: field.targetFieldId,
              label: field.label,
              description: field.description,
              placeholder: field.placeholder,
              required: field.required,
              mode: field.mode ?? "visible",
              fixedValue: field.fixedValue,
              prefillParameter: field.prefillParameter,
              visibility: field.visibility,
            })),
          }
        : null,
    };
  },
});

export const getAnalyticsContext = query({
  args: { formId: v.id("forms") },
  returns: v.object({ timeZone: v.string() }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const form = await requireForm(
      ctx,
      identity.orgId,
      args.formId,
      true,
    );
    return {
      timeZone: normalizeAnalyticsTimeZone(
        form.analyticsTimeZone ?? "UTC",
      ),
    };
  },
});

export const getSubmissionWorkspace = query({
  args: { formId: v.id("forms") },
  returns: submissionWorkspaceValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const form = await requireForm(ctx, identity.orgId, args.formId, true);
    const [base, table] = await Promise.all([
      requireBase(ctx, identity.orgId, form.baseId, true),
      requireTable(ctx, identity.orgId, form.tableId, true),
    ]);
    return {
      formName: form.name,
      formStatus: form.status,
      baseId: base._id,
      baseName: base.name,
      tableId: table._id,
      tableName: table.name,
    };
  },
});

export const listSubmissions = query({
  args: {
    formId: v.id("forms"),
    paginationOpts: paginationOptsValidator,
  },
  returns: submissionPageValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const form = await requireForm(ctx, identity.orgId, args.formId, true);
    const table = await requireTable(
      ctx,
      identity.orgId,
      form.tableId,
      true,
    );
    const result = await ctx.db
      .query("formSubmissions")
      .withIndex("by_form_and_submitted_at", (q) =>
        q.eq("formId", args.formId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    const versionCache = new Map<
      Id<"formVersions">,
      {
        version: number;
        questions: Array<Doc<"formVersionFields">>;
      }
    >();
    const page = [];
    for (const submission of result.page) {
      if (submission.orgId !== identity.orgId) continue;
      let versionState = versionCache.get(submission.formVersionId);
      if (!versionState) {
        const version = await ctx.db.get(submission.formVersionId);
        const questions = await ctx.db
          .query("formVersionFields")
          .withIndex("by_version_and_rank", (q) =>
            q.eq("formVersionId", submission.formVersionId),
          )
          .take(PLAN_LIMITS.pro.fieldsPerTable);
        versionState = {
          version: version?.version ?? 0,
          questions,
        };
        versionCache.set(submission.formVersionId, versionState);
      }
      const record = await ctx.db.get(submission.recordId);
      const answers = submissionAnswerMap(
        submission,
        record,
        versionState.questions,
      );
      page.push({
        submissionId: submission._id,
        recordId: submission.recordId,
        submittedAt: submission.submittedAt,
        version: versionState.version,
        responseLabel: await responseLabel(
          ctx,
          table,
          record,
          versionState.questions,
          answers,
        ),
        recordStatus: record?.status ?? ("deleted" as const),
      });
    }
    return {
      page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const getSubmission = query({
  args: {
    formId: v.id("forms"),
    submissionId: v.id("formSubmissions"),
  },
  returns: submissionDetailValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const form = await requireForm(ctx, identity.orgId, args.formId, true);
    const submission = await ctx.db.get(args.submissionId);
    if (
      !submission ||
      submission.orgId !== identity.orgId ||
      submission.formId !== form._id
    ) {
      return null;
    }
    const [base, table, version, record] = await Promise.all([
      requireBase(ctx, identity.orgId, form.baseId, true),
      requireTable(ctx, identity.orgId, form.tableId, true),
      ctx.db.get(submission.formVersionId),
      ctx.db.get(submission.recordId),
    ]);
    const questions = await ctx.db
      .query("formVersionFields")
      .withIndex("by_version_and_rank", (q) =>
        q.eq("formVersionId", submission.formVersionId),
      )
      .take(PLAN_LIMITS.pro.fieldsPerTable);
    const answers = submissionAnswerMap(submission, record, questions);
    const detailAnswers = [];
    for (const question of questions) {
      const value = answers.get(question._id);
      const displayValue = await submissionDisplayValue(
        ctx,
        question,
        value,
        true,
      );
      detailAnswers.push({
        question: question.label.trim() || "Untitled question",
        displayValue: displayValue || "No answer",
        hasAnswer: Boolean(displayValue),
        automatic: (question.mode ?? "visible") === "hidden",
      });
    }
    return {
      submittedAt: submission.submittedAt,
      version: version?.version ?? 0,
      responseLabel: await responseLabel(
        ctx,
        table,
        record,
        questions,
        answers,
      ),
      recordId: submission.recordId,
      recordStatus: record?.status ?? ("deleted" as const),
      baseId: base._id,
      tableId: table._id,
      tableName: table.name,
      answers: detailAnswers,
    };
  },
});

export const exportSubmissions = query({
  args: { formId: v.id("forms") },
  returns: submissionExportValidator,
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    const form = await requireForm(ctx, identity.orgId, args.formId, true);
    const table = await requireTable(
      ctx,
      identity.orgId,
      form.tableId,
      true,
    );
    const sample = await ctx.db
      .query("formSubmissions")
      .withIndex("by_form_and_submitted_at", (q) =>
        q.eq("formId", args.formId),
      )
      .order("desc")
      .take(MAX_SUBMISSION_EXPORT_ROWS + 1);
    const submissions = sample
      .filter((submission) => submission.orgId === identity.orgId)
      .slice(0, MAX_SUBMISSION_EXPORT_ROWS);
    const questionsByVersion = new Map<
      Id<"formVersions">,
      Array<Doc<"formVersionFields">>
    >();
    const versionNumbers = new Map<Id<"formVersions">, number>();
    for (const versionId of [
      ...new Set(
        submissions.map((submission) => submission.formVersionId),
      ),
    ]) {
      const [version, questions] = await Promise.all([
        ctx.db.get(versionId),
        ctx.db
          .query("formVersionFields")
          .withIndex("by_version_and_rank", (q) =>
            q.eq("formVersionId", versionId),
          )
          .take(PLAN_LIMITS.pro.fieldsPerTable),
      ]);
      versionNumbers.set(versionId, version?.version ?? 0);
      questionsByVersion.set(versionId, questions);
    }
    const columnsByField = new Map<
      Id<"fields">,
      { label: string; order: number }
    >();
    for (const submission of submissions) {
      for (const question of
        questionsByVersion.get(submission.formVersionId) ?? []) {
        if (!columnsByField.has(question.targetFieldId)) {
          columnsByField.set(question.targetFieldId, {
            label: question.label.trim() || "Untitled question",
            order: columnsByField.size,
          });
        }
      }
    }
    const columnEntries = [...columnsByField.entries()].sort(
      ([, left], [, right]) => left.order - right.order,
    );
    const rows = [];
    for (const submission of submissions) {
      const record = await ctx.db.get(submission.recordId);
      const questions =
        questionsByVersion.get(submission.formVersionId) ?? [];
      const questionByField = new Map(
        questions.map((question) => [
          question.targetFieldId,
          question,
        ]),
      );
      const answers = submissionAnswerMap(submission, record, questions);
      const exportedAnswers = [];
      for (const [fieldId] of columnEntries) {
        const question = questionByField.get(fieldId);
        exportedAnswers.push(
          question
            ? await submissionDisplayValue(
                ctx,
                question,
                answers.get(question._id),
                false,
              )
            : "",
        );
      }
      rows.push({
        submittedAt: submission.submittedAt,
        version: versionNumbers.get(submission.formVersionId) ?? 0,
        responseLabel: await responseLabel(
          ctx,
          table,
          record,
          questions,
          answers,
        ),
        answers: exportedAnswers,
      });
    }
    return {
      formName: form.name,
      columns: columnEntries.map(([, column]) => column.label),
      rows,
      truncated: sample.length > MAX_SUBMISSION_EXPORT_ROWS,
    };
  },
});

export const create = mutation({
  args: {
    tableId: v.id("tables"),
    name: v.string(),
    afterRank: v.optional(v.string()),
  },
  returns: v.id("forms"),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const table = await requireTable(ctx, identity.orgId, args.tableId);
    const name = args.name.trim();
    if (!name || name.length > 120) {
      throw new ConvexError({ code: "INVALID_FORM_NAME" });
    }
    const count = await formCount.count(ctx, { namespace: table.baseId });
    assertBelowQuota(
      count,
      PLAN_LIMITS[identity.plan].formsPerBase,
      "forms_per_base",
    );

    const now = Date.now();
    const slug = await createFriendlyFormSlug(ctx, name);
    const formId = await ctx.db.insert("forms", {
      orgId: identity.orgId,
      baseId: table.baseId,
      tableId: table._id,
      name,
      slug,
      title: name,
      description: "",
      rank: createRank(args.afterRank),
      status: "draft",
      appearance: DEFAULT_APPEARANCE,
      thankYou: DEFAULT_THANK_YOU,
      allowMultipleSubmissions: true,
      draftRevision: 1,
      createdByUserId: identity.userId,
      updatedAt: now,
    });

    const fields = await ctx.db
      .query("fields")
      .withIndex("by_table_and_status_and_rank", (q) =>
        q.eq("tableId", table._id).eq("status", "active"),
      )
      .take(PLAN_LIMITS.pro.fieldsPerTable);
    for (const field of fields) {
      if (field.type === "createdTime" || field.type === "createdBy") continue;
      await ctx.db.insert("formDraftFields", {
        orgId: identity.orgId,
        formId,
        targetFieldId: field._id,
        label: field.name,
        required: false,
        rank: field.rank,
      });
    }
    const form = await ctx.db.get(formId);
    await formCount.insert(ctx, form!);
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "form.created",
      resourceType: "form",
      resourceId: formId,
      baseId: table.baseId,
      tableId: table._id,
      revisionAfter: 1,
    });
    return formId;
  },
});

export const duplicate = mutation({
  args: {
    formId: v.id("forms"),
    name: v.optional(v.string()),
    afterRank: v.optional(v.string()),
  },
  returns: v.object({
    formId: v.id("forms"),
    name: v.string(),
  }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const source = await requireForm(ctx, identity.orgId, args.formId);
    await requireTable(ctx, identity.orgId, source.tableId);
    const name = (args.name ?? duplicateFormName(source.name)).trim();
    if (!name || name.length > 120) {
      throw new ConvexError({ code: "INVALID_FORM_NAME" });
    }
    const count = await formCount.count(ctx, {
      namespace: source.baseId,
    });
    assertBelowQuota(
      count,
      PLAN_LIMITS[identity.plan].formsPerBase,
      "forms_per_base",
    );
    const fields = await ctx.db
      .query("formDraftFields")
      .withIndex("by_form_and_rank", (q) =>
        q.eq("formId", source._id),
      )
      .take(PLAN_LIMITS.pro.fieldsPerTable + 1);
    if (fields.length > PLAN_LIMITS[identity.plan].fieldsPerTable) {
      throw new ConvexError({ code: "INVALID_FORM_FIELD_COUNT" });
    }
    validateDraftVisibility(fields);

    const now = Date.now();
    const slug = await createFriendlyFormSlug(ctx, name);
    const formId = await ctx.db.insert("forms", {
      orgId: identity.orgId,
      baseId: source.baseId,
      tableId: source.tableId,
      name,
      slug,
      title: source.title,
      description: source.description,
      rank: createRank(args.afterRank ?? source.rank),
      status: "draft",
      appearance: source.appearance,
      thankYou: source.thankYou,
      allowMultipleSubmissions: source.allowMultipleSubmissions,
      draftRevision: 1,
      createdByUserId: identity.userId,
      updatedAt: now,
    });
    for (const field of fields) {
      await ctx.db.insert("formDraftFields", {
        orgId: identity.orgId,
        formId,
        targetFieldId: field.targetFieldId,
        label: field.label,
        description: field.description,
        placeholder: field.placeholder,
        required: field.required,
        rank: field.rank,
        mode: field.mode,
        fixedValue: field.fixedValue,
        prefillParameter: field.prefillParameter,
        visibility: field.visibility,
      });
    }
    const duplicated = await ctx.db.get(formId);
    await formCount.insert(ctx, duplicated!);
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "form.duplicated",
      resourceType: "form",
      resourceId: formId,
      baseId: source.baseId,
      tableId: source.tableId,
      changedFieldIds: fields.map((field) => field.targetFieldId),
      revisionAfter: 1,
    });
    return { formId, name };
  },
});

export const updateDraft = mutation({
  args: {
    formId: v.id("forms"),
    name: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    appearance: v.optional(formAppearanceInputValidator),
    thankYou: v.optional(thankYouValidator),
    rank: v.optional(v.string()),
  },
  returns: v.object({ draftRevision: v.number() }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const form = await requireForm(ctx, identity.orgId, args.formId);
    const patch: Partial<Doc<"forms">> & {
      draftRevision: number;
      updatedAt: number;
    } = {
      draftRevision: form.draftRevision + 1,
      updatedAt: Date.now(),
    };
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name || name.length > 120) {
        throw new ConvexError({ code: "INVALID_FORM_NAME" });
      }
      patch.name = name;
    }
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title || title.length > 160) {
        throw new ConvexError({ code: "INVALID_FORM_TITLE" });
      }
      patch.title = title;
    }
    if (args.description !== undefined) {
      if (args.description.length > 5_000) {
        throw new ConvexError({ code: "INVALID_FORM_DESCRIPTION" });
      }
      patch.description = args.description;
    }
    if (args.appearance !== undefined) {
      const appearance = {
        ...args.appearance,
        logoStorageId: form.appearance.logoStorageId,
        coverStorageId: form.appearance.coverStorageId,
      };
      validateAppearance(appearance);
      if (usesCustomBranding(appearance)) {
        requireFeature(identity, FEATURE_SLUGS.customFormBranding);
      }
      patch.appearance = appearance;
    }
    if (args.thankYou !== undefined) {
      validateThankYou(args.thankYou);
      if (args.thankYou.redirectUrl) {
        requireFeature(identity, FEATURE_SLUGS.customFormBranding);
      }
      patch.thankYou = args.thankYou;
    }
    if (args.rank !== undefined) patch.rank = args.rank;
    await ctx.db.patch(args.formId, patch);
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "form.draft_updated",
      resourceType: "form",
      resourceId: args.formId,
      baseId: form.baseId,
      tableId: form.tableId,
      revisionBefore: form.draftRevision,
      revisionAfter: form.draftRevision + 1,
    });
    return { draftRevision: form.draftRevision + 1 };
  },
});

export const createAppearanceUploadUrl = mutation({
  args: { formId: v.id("forms") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    requireFeature(identity, FEATURE_SLUGS.customFormBranding);
    await requireForm(ctx, identity.orgId, args.formId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const setAppearanceAsset = mutation({
  args: {
    formId: v.id("forms"),
    expectedRevision: v.number(),
    kind: v.union(v.literal("logo"), v.literal("cover")),
    storageId: v.union(v.id("_storage"), v.null()),
  },
  returns: v.object({
    draftRevision: v.number(),
    url: v.union(v.string(), v.null()),
    fingerprint: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const form = await requireForm(ctx, identity.orgId, args.formId);
    if (form.draftRevision !== args.expectedRevision) {
      throw new ConvexError({
        code: "REVISION_CONFLICT",
        expectedRevision: args.expectedRevision,
        actualRevision: form.draftRevision,
      });
    }
    if (args.storageId) {
      requireFeature(identity, FEATURE_SLUGS.customFormBranding);
      const metadata = await ctx.db.system.get(
        "_storage",
        args.storageId,
      );
      if (
        !metadata ||
        !metadata.contentType ||
        !FORM_APPEARANCE_IMAGE_TYPES.has(metadata.contentType) ||
        metadata.size > MAX_FORM_APPEARANCE_IMAGE_BYTES
      ) {
        throw new ConvexError({
          code: "INVALID_FORM_APPEARANCE_IMAGE",
        });
      }
    }
    const appearance =
      args.kind === "logo"
        ? {
            ...form.appearance,
            logoStorageId: args.storageId ?? undefined,
          }
        : {
            ...form.appearance,
            coverStorageId: args.storageId ?? undefined,
          };
    const draftRevision = form.draftRevision + 1;
    await ctx.db.patch(args.formId, {
      appearance,
      draftRevision,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "form.draft_updated",
      resourceType: "form",
      resourceId: args.formId,
      baseId: form.baseId,
      tableId: form.tableId,
      revisionBefore: form.draftRevision,
      revisionAfter: draftRevision,
    });
    return {
      draftRevision,
      url: args.storageId
        ? await ctx.storage.getUrl(args.storageId)
        : null,
      fingerprint: args.storageId
        ? (
            await ctx.db.system.get("_storage", args.storageId)
          )?.sha256 ?? null
        : null,
    };
  },
});

export const replaceDraftFields = mutation({
  args: {
    formId: v.id("forms"),
    fields: v.array(formDraftFieldInputValidator),
  },
  returns: v.object({ draftRevision: v.number() }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const form = await requireForm(ctx, identity.orgId, args.formId);
    if (
      args.fields.length < 1 ||
      args.fields.length > PLAN_LIMITS[identity.plan].fieldsPerTable
    ) {
      throw new ConvexError({ code: "INVALID_FORM_FIELD_COUNT" });
    }
    await validateDraftFieldsAndDestinations(
      ctx,
      identity.orgId,
      form,
      args.fields,
    );
    const existing = await ctx.db
      .query("formDraftFields")
      .withIndex("by_form_and_rank", (q) => q.eq("formId", args.formId))
      .take(PLAN_LIMITS.pro.fieldsPerTable + 1);
    for (const field of existing) await ctx.db.delete(field._id);
    for (const input of args.fields) {
      await ctx.db.insert("formDraftFields", {
        orgId: identity.orgId,
        formId: args.formId,
        ...storedDraftField(input),
      });
    }
    await ctx.db.patch(args.formId, {
      draftRevision: form.draftRevision + 1,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "form.fields_replaced",
      resourceType: "form",
      resourceId: args.formId,
      baseId: form.baseId,
      tableId: form.tableId,
      changedFieldIds: args.fields.map((field) => field.targetFieldId),
      revisionBefore: form.draftRevision,
      revisionAfter: form.draftRevision + 1,
    });
    return { draftRevision: form.draftRevision + 1 };
  },
});

export const saveDraft = mutation({
  args: {
    formId: v.id("forms"),
    expectedRevision: v.number(),
    name: v.string(),
    title: v.string(),
    description: v.string(),
    appearance: formAppearanceInputValidator,
    thankYou: thankYouValidator,
    fields: v.array(formDraftFieldInputValidator),
  },
  returns: v.object({ draftRevision: v.number() }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const form = await requireForm(ctx, identity.orgId, args.formId);
    if (
      !Number.isInteger(args.expectedRevision) ||
      args.expectedRevision < 1 ||
      form.draftRevision !== args.expectedRevision
    ) {
      throw new ConvexError({
        code: "REVISION_CONFLICT",
        expectedRevision: args.expectedRevision,
        actualRevision: form.draftRevision,
      });
    }

    const name = args.name.trim();
    const title = args.title.trim();
    if (!name || name.length > 120) {
      throw new ConvexError({ code: "INVALID_FORM_NAME" });
    }
    if (!title || title.length > 160) {
      throw new ConvexError({ code: "INVALID_FORM_TITLE" });
    }
    if (args.description.length > 5_000) {
      throw new ConvexError({ code: "INVALID_FORM_DESCRIPTION" });
    }
    const appearance = {
      ...args.appearance,
      logoStorageId: form.appearance.logoStorageId,
      coverStorageId: form.appearance.coverStorageId,
    };
    validateAppearance(appearance);
    if (usesCustomBranding(appearance)) {
      requireFeature(identity, FEATURE_SLUGS.customFormBranding);
    }
    validateThankYou(args.thankYou);
    if (args.thankYou.redirectUrl) {
      requireFeature(identity, FEATURE_SLUGS.customFormBranding);
    }

    if (
      args.fields.length < 1 ||
      args.fields.length > PLAN_LIMITS[identity.plan].fieldsPerTable
    ) {
      throw new ConvexError({ code: "INVALID_FORM_FIELD_COUNT" });
    }
    await validateDraftFieldsAndDestinations(
      ctx,
      identity.orgId,
      form,
      args.fields,
    );

    const existing = await ctx.db
      .query("formDraftFields")
      .withIndex("by_form_and_rank", (q) => q.eq("formId", args.formId))
      .take(PLAN_LIMITS.pro.fieldsPerTable + 1);
    for (const field of existing) await ctx.db.delete(field._id);
    for (const input of args.fields) {
      await ctx.db.insert("formDraftFields", {
        orgId: identity.orgId,
        formId: args.formId,
        ...storedDraftField(input),
      });
    }

    const nextRevision = form.draftRevision + 1;
    await ctx.db.patch(args.formId, {
      name,
      title,
      description: args.description,
      appearance,
      thankYou: args.thankYou,
      draftRevision: nextRevision,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "form.draft_saved",
      resourceType: "form",
      resourceId: args.formId,
      baseId: form.baseId,
      tableId: form.tableId,
      changedFieldIds: args.fields.map((field) => field.targetFieldId),
      revisionBefore: form.draftRevision,
      revisionAfter: nextRevision,
    });
    return { draftRevision: nextRevision };
  },
});

export const publish = mutation({
  args: {
    formId: v.id("forms"),
    timeZone: v.optional(v.string()),
  },
  returns: v.object({
    formVersionId: v.id("formVersions"),
    version: v.number(),
    slug: v.string(),
  }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const form = await requireForm(ctx, identity.orgId, args.formId);
    const analyticsTimeZone =
      form.analyticsTimeZone ??
      (form.currentPublishedVersionId || form.publishedAt
        ? "UTC"
        : normalizeAnalyticsTimeZone(args.timeZone ?? "UTC"));
    await requireTable(ctx, identity.orgId, form.tableId);
    validateAppearance(form.appearance);
    validateThankYou(form.thankYou);
    if (usesCustomBranding(form.appearance)) {
      requireFeature(identity, FEATURE_SLUGS.customFormBranding);
    }
    if (form.thankYou.redirectUrl) {
      requireFeature(identity, FEATURE_SLUGS.customFormBranding);
    }

    const drafts = await ctx.db
      .query("formDraftFields")
      .withIndex("by_form_and_rank", (q) => q.eq("formId", args.formId))
      .take(PLAN_LIMITS.pro.fieldsPerTable + 1);
    if (
      drafts.length < 1 ||
      drafts.length > PLAN_LIMITS[identity.plan].fieldsPerTable
    ) {
      throw new ConvexError({ code: "INVALID_FORM_FIELD_COUNT" });
    }
    const targetFields = await validateDraftFieldsAndDestinations(
      ctx,
      identity.orgId,
      form,
      drafts,
    );

    const latest = await ctx.db
      .query("formVersions")
      .withIndex("by_form_and_version", (q) => q.eq("formId", args.formId))
      .order("desc")
      .first();
    const version = (latest?.version ?? 0) + 1;
    const now = Date.now();
    const formVersionId = await ctx.db.insert("formVersions", {
      orgId: identity.orgId,
      formId: args.formId,
      baseId: form.baseId,
      tableId: form.tableId,
      version,
      title: form.title,
      description: form.description,
      appearance: form.appearance,
      thankYou: form.thankYou,
      publishedByUserId: identity.userId,
      publishedAt: now,
    });

    const oldRefs = await ctx.db
      .query("formPublishedFieldRefs")
      .withIndex("by_form", (q) => q.eq("formId", args.formId))
      .take(PLAN_LIMITS.pro.fieldsPerTable + 1);
    for (const ref of oldRefs) await ctx.db.delete(ref._id);

    const versionFieldIdsByTarget = new Map<
      Id<"fields">,
      Id<"formVersionFields">
    >();
    for (const draft of drafts) {
      const field = targetFields.get(draft.targetFieldId)!;
      const versionFieldId = await ctx.db.insert("formVersionFields", {
        orgId: identity.orgId,
        formId: args.formId,
        formVersionId,
        targetFieldId: field._id,
        targetFieldType: field.type,
        targetFieldConfig: field.config,
        label: draft.label,
        description: draft.description,
        placeholder: draft.placeholder,
        required: draft.required,
        rank: draft.rank,
        mode: draft.mode ?? "visible",
        fixedValue: draft.fixedValue,
        prefillParameter: draft.prefillParameter,
      });
      versionFieldIdsByTarget.set(field._id, versionFieldId);
      await ctx.db.insert("formPublishedFieldRefs", {
        orgId: identity.orgId,
        formId: args.formId,
        formVersionId,
        targetFieldId: field._id,
      });
    }
    for (const draft of drafts) {
      if (!draft.visibility?.conditions.length) continue;
      const versionFieldId = versionFieldIdsByTarget.get(
        draft.targetFieldId,
      )!;
      await ctx.db.patch(versionFieldId, {
        visibility: {
          conjunction: draft.visibility.conjunction,
          conditions: draft.visibility.conditions.map((condition) => ({
            id: condition.id,
            sourceQuestionId: versionFieldIdsByTarget.get(
              condition.sourceFieldId,
            )!,
            sourceFieldId: condition.sourceFieldId,
            operator: condition.operator,
            value: condition.value,
          })),
        },
      });
    }
    await ctx.db.patch(args.formId, {
      analyticsTimeZone,
      currentPublishedVersionId: formVersionId,
      status: "published",
      publishedAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "form.published",
      resourceType: "form_version",
      resourceId: formVersionId,
      baseId: form.baseId,
      tableId: form.tableId,
      changedFieldIds: drafts.map((draft) => draft.targetFieldId),
      revisionAfter: version,
    });
    return { formVersionId, version, slug: form.slug };
  },
});

export const close = mutation({
  args: { formId: v.id("forms") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const form = await requireForm(ctx, identity.orgId, args.formId);
    await deletePublishedFieldReferences(ctx, args.formId);
    await ctx.db.patch(args.formId, {
      status: "closed",
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "form.closed",
      resourceType: "form",
      resourceId: args.formId,
      baseId: form.baseId,
      tableId: form.tableId,
    });
    return null;
  },
});

async function archiveForm(
  ctx: MutationCtx,
  formId: Id<"forms">,
  auditAction: "form.archived" | "form.deleted",
): Promise<null> {
  const identity = await requireOrgIdentity(ctx);
  requireOrgAdmin(identity);
  const form = await requireForm(ctx, identity.orgId, formId);
  await deletePublishedFieldReferences(ctx, formId);
  const now = Date.now();
  await ctx.db.patch(formId, {
    status: "deleted",
    deletedAt: now,
    updatedAt: now,
  });
  await formCount.delete(ctx, form);
  await writeAudit(ctx, {
    orgId: identity.orgId,
    actor: userActor(identity),
    action: auditAction,
    resourceType: "form",
    resourceId: formId,
    baseId: form.baseId,
    tableId: form.tableId,
  });
  return null;
}

export const archive = mutation({
  args: { formId: v.id("forms") },
  returns: v.null(),
  handler: async (ctx, args) =>
    await archiveForm(ctx, args.formId, "form.archived"),
});

export const remove = mutation({
  args: { formId: v.id("forms") },
  returns: v.null(),
  handler: async (ctx, args) =>
    await archiveForm(ctx, args.formId, "form.deleted"),
});

export const restore = mutation({
  args: { formId: v.id("forms") },
  returns: v.object({
    formId: v.id("forms"),
    name: v.string(),
    status: v.union(v.literal("draft"), v.literal("closed")),
  }),
  handler: async (ctx, args) => {
    const identity = await requireOrgIdentity(ctx);
    requireOrgAdmin(identity);
    const form = await requireForm(
      ctx,
      identity.orgId,
      args.formId,
      true,
    );
    if (form.status !== "deleted") {
      throw new ConvexError({ code: "FORM_NOT_ARCHIVED" });
    }
    await requireBase(ctx, identity.orgId, form.baseId);
    await requireTable(ctx, identity.orgId, form.tableId);
    const count = await formCount.count(ctx, {
      namespace: form.baseId,
    });
    assertBelowQuota(
      count,
      PLAN_LIMITS[identity.plan].formsPerBase,
      "forms_per_base",
    );
    const status: "closed" | "draft" = form.currentPublishedVersionId
      ? "closed"
      : "draft";
    await ctx.db.patch(args.formId, {
      status,
      deletedAt: undefined,
      updatedAt: Date.now(),
    });
    const restored = await ctx.db.get(args.formId);
    await formCount.insert(ctx, restored!);
    await writeAudit(ctx, {
      orgId: identity.orgId,
      actor: userActor(identity),
      action: "form.restored",
      resourceType: "form",
      resourceId: args.formId,
      baseId: form.baseId,
      tableId: form.tableId,
    });
    return { formId: args.formId, name: form.name, status };
  },
});

export const getPublic = internalQuery({
  args: { slug: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const form = await resolveFormBySlug(ctx, args.slug);
    if (
      !form ||
      form.status !== "published" ||
      !form.currentPublishedVersionId ||
      !(await hasActiveFormParents(ctx, form))
    ) {
      return null;
    }
    const version = await ctx.db.get(form.currentPublishedVersionId);
    if (!version) return null;
    const fields = await ctx.db
      .query("formVersionFields")
      .withIndex("by_version_and_rank", (q) =>
        q.eq("formVersionId", version._id),
      )
      .take(PLAN_LIMITS.pro.fieldsPerTable + 1);
    const logoUrl = version.appearance.logoStorageId
      ? await ctx.storage.getUrl(version.appearance.logoStorageId)
      : null;
    const coverUrl = version.appearance.coverStorageId
      ? await ctx.storage.getUrl(version.appearance.coverStorageId)
      : null;
    return {
      slug: form.slug,
      formVersionId: version._id,
      version: version.version,
      title: version.title,
      description: version.description,
      appearance: {
        primaryColor: version.appearance.primaryColor,
        backgroundColor: version.appearance.backgroundColor,
        submitLabel: version.appearance.submitLabel,
        showPoweredBy: version.appearance.showPoweredBy,
        layout: version.appearance.layout ?? "card",
        logoUrl,
        coverUrl,
      },
      analyticsTimeZone: form.analyticsTimeZone ?? "UTC",
      orgId: form.orgId,
      fields: fields.map((field) => ({
        id: field._id,
        type: field.targetFieldType,
        config: field.targetFieldConfig,
        label: field.label,
        description: field.description,
        placeholder: field.placeholder,
        required: field.required,
        mode: field.mode ?? "visible",
        fixedValue: field.fixedValue,
        prefillParameter: field.prefillParameter,
        visibility: field.visibility,
      })),
    };
  },
});

export const getSubmissionContext = internalQuery({
  args: {
    slug: v.string(),
    formVersionId: v.id("formVersions"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const form = await resolveFormBySlug(ctx, args.slug);
    if (
      !form ||
      form.status !== "published" ||
      form.currentPublishedVersionId !== args.formVersionId ||
      !(await hasActiveFormParents(ctx, form))
    ) {
      throw new ConvexError({ code: "FORM_UPDATED_OR_CLOSED" });
    }
    return {
      orgId: form.orgId,
      formId: form._id,
      formVersionId: args.formVersionId,
      analyticsTimeZone: form.analyticsTimeZone ?? "UTC",
    };
  },
});

export const beginSubmissionSession = internalMutation({
  args: {
    slug: v.string(),
    formVersionId: v.id("formVersions"),
    plan: planTierValidator,
    proofHash: v.string(),
  },
  returns: v.object({
    submissionSessionId: v.id("publicSubmissionSessions"),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const form = await resolveFormBySlug(ctx, args.slug);
    if (
      !form ||
      form.status !== "published" ||
      form.currentPublishedVersionId !== args.formVersionId ||
      !(await hasActiveFormParents(ctx, form)) ||
      !/^[a-f0-9]{64}$/.test(args.proofHash)
    ) {
      throw new ConvexError({ code: "FORM_UPDATED_OR_CLOSED" });
    }
    await rateLimiter.limit(ctx, "publicFormSubmission", {
      key: form._id,
      throws: true,
    });
    const expiresAt = Date.now() + PUBLIC_SUBMISSION_SESSION_TTL_MS;
    const submissionSessionId = await ctx.db.insert(
      "publicSubmissionSessions",
      {
        orgId: form.orgId,
        formId: form._id,
        formVersionId: args.formVersionId,
        planAtStart: args.plan,
        proofHash: args.proofHash,
        status: "active",
        expiresAt,
        createdAt: Date.now(),
      },
    );
    return { submissionSessionId, expiresAt };
  },
});

export const getSubmissionSessionContext = internalQuery({
  args: {
    submissionSessionId: v.id("publicSubmissionSessions"),
    proofHash: v.string(),
    allowConsumed: v.boolean(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.submissionSessionId);
    if (
      !session ||
      session.proofHash !== args.proofHash ||
      (session.status !== "active" &&
        !(args.allowConsumed && session.status === "consumed")) ||
      (session.status === "active" && session.expiresAt < Date.now())
    ) {
      throw new ConvexError({ code: "PUBLIC_SUBMISSION_SESSION_INVALID" });
    }
    const form = await ctx.db.get(session.formId);
    if (
      !form ||
      form.status !== "published" ||
      form.currentPublishedVersionId !== session.formVersionId ||
      !(await hasActiveFormParents(ctx, form))
    ) {
      throw new ConvexError({ code: "FORM_UPDATED_OR_CLOSED" });
    }
    return {
      orgId: session.orgId,
      formId: session.formId,
      formVersionId: session.formVersionId,
      analyticsTimeZone: form.analyticsTimeZone ?? "UTC",
      planAtStart: session.planAtStart,
    };
  },
});

export const commitSubmission = internalMutation({
  args: {
    slug: v.string(),
    formVersionId: v.id("formVersions"),
    submissionSessionId: v.id("publicSubmissionSessions"),
    proofHash: v.string(),
    idempotencyKey: v.string(),
    answers: v.array(formAnswerValidator),
    plan: planTierValidator,
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const submissionSession = await ctx.db.get(args.submissionSessionId);
    if (
      !submissionSession ||
      submissionSession.proofHash !== args.proofHash ||
      submissionSession.formVersionId !== args.formVersionId
    ) {
      throw new ConvexError({ code: "PUBLIC_SUBMISSION_SESSION_INVALID" });
    }
    const form = await resolveFormBySlug(ctx, args.slug);
    if (
      !form ||
      form.status !== "published" ||
      form.currentPublishedVersionId !== args.formVersionId ||
      !(await hasActiveFormParents(ctx, form))
    ) {
      throw new ConvexError({ code: "FORM_UPDATED_OR_CLOSED" });
    }
    const existing = await ctx.db
      .query("formSubmissions")
      .withIndex("by_form_and_idempotency_key", (q) =>
        q
          .eq("formId", form._id)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (existing) {
      if (
        existing.publicSubmissionSessionId !== args.submissionSessionId
      ) {
        throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
      }
      const version = await ctx.db.get(existing.formVersionId);
      return {
        submissionId: existing._id,
        recordId: existing.recordId,
        thankYou: version?.thankYou ?? form.thankYou,
        duplicate: true,
      };
    }
    if (
      submissionSession.status !== "active" ||
      submissionSession.expiresAt < Date.now() ||
      submissionSession.formId !== form._id
    ) {
      throw new ConvexError({ code: "PUBLIC_SUBMISSION_SESSION_INVALID" });
    }
    if (
      !args.idempotencyKey ||
      args.idempotencyKey.length > 200 ||
      args.answers.length > PLAN_LIMITS[args.plan].fieldsPerTable
    ) {
      throw new ConvexError({ code: "INVALID_SUBMISSION" });
    }

    const version = await ctx.db.get(args.formVersionId);
    if (!version || version.formId !== form._id) {
      throw new ConvexError({ code: "FORM_VERSION_NOT_FOUND" });
    }
    const versionFields = await ctx.db
      .query("formVersionFields")
      .withIndex("by_version_and_rank", (q) =>
        q.eq("formVersionId", args.formVersionId),
      )
      .take(PLAN_LIMITS.pro.fieldsPerTable + 1);
    const mappings = new Map(versionFields.map((field) => [field._id, field]));
    const answers = new Map<Id<"formVersionFields">, unknown>();
    const answerLookup = new Map<string, FormAnswerValue>();
    for (const answer of args.answers) {
      if (!mappings.has(answer.formVersionFieldId)) {
        throw new ConvexError({ code: "UNKNOWN_FORM_QUESTION" });
      }
      if (answers.has(answer.formVersionFieldId)) {
        throw new ConvexError({ code: "DUPLICATE_FORM_ANSWER" });
      }
      answers.set(answer.formVersionFieldId, answer.value);
      answerLookup.set(
        answer.formVersionFieldId,
        answer.value as FormAnswerValue,
      );
    }
    for (const field of versionFields) {
      if ((field.mode ?? "visible") !== "hidden") continue;
      answerLookup.set(
        field._id,
        field.fixedValue as FormAnswerValue,
      );
    }
    const conditionalQuestions: ConditionalFormQuestion[] =
      versionFields.map((field) => ({
        id: field._id,
        fieldId: field.targetFieldId,
        label: field.label,
        helpText: field.description ?? "",
        placeholder: field.placeholder,
        required: field.required,
        rank: field.rank,
        visibility: field.visibility,
      }));
    const visibleQuestionIds = new Set(
      visibleFormQuestions(conditionalQuestions, answerLookup).map(
        (question) => question.id,
      ),
    );
    for (const field of versionFields) {
      if (!visibleQuestionIds.has(field._id)) continue;
      const answer =
        (field.mode ?? "visible") === "hidden"
          ? field.fixedValue
          : answers.get(field._id);
      if (
        field.required &&
        (answer === undefined ||
          answer === null ||
          answer === "" ||
          (Array.isArray(answer) && answer.length === 0))
      ) {
        throw new ConvexError({
          code: "REQUIRED_FORM_ANSWER_MISSING",
          formVersionFieldId: field._id,
        });
      }
    }

    const values: Record<
      string,
      Doc<"records">["values"][Id<"fields">]
    > = {};
    for (const mapping of versionFields) {
      if (!visibleQuestionIds.has(mapping._id)) continue;
      const value =
        (mapping.mode ?? "visible") === "hidden"
          ? mapping.fixedValue
          : answers.get(mapping._id);
      if (value === undefined) continue;
      if (value === null) continue;
      values[mapping.targetFieldId] =
        value as Doc<"records">["values"][Id<"fields">];
    }
    await validateRecordValues(ctx, form.orgId, form.tableId, values, {
      allowStagedAttachments: true,
    });

    const attachmentIds: Id<"attachments">[] = [];
    for (const mapping of versionFields) {
      if (mapping.targetFieldType !== "attachment") continue;
      const value = values[mapping.targetFieldId];
      if (!Array.isArray(value)) continue;
      for (const attachmentId of value as Id<"attachments">[]) {
        const attachment = await ctx.db.get(attachmentId);
        const upload = attachment
          ? await ctx.db.get(attachment.uploadSessionId)
          : null;
        if (
          !attachment ||
          attachment.status !== "staged" ||
          attachment.formId !== form._id ||
          !upload ||
          upload.publicSubmissionSessionId !== args.submissionSessionId ||
          upload.formVersionId !== version._id ||
          upload.status !== "uploaded"
        ) {
          throw new ConvexError({ code: "INVALID_FORM_ATTACHMENT" });
        }
        attachmentIds.push(attachmentId);
      }
    }

    const recordsUsed = await recordCount.count(ctx, {
      namespace: form.orgId,
    });
    assertBelowQuota(
      recordsUsed,
      PLAN_LIMITS[args.plan as PlanTier].recordsPerOrg,
      "records_per_org",
    );
    const month = monthKey();
    const submissionsUsed = await submissionCount.count(ctx, {
      namespace: `${form.orgId}:${month}`,
    });
    assertBelowQuota(
      submissionsUsed,
      PLAN_LIMITS[args.plan as PlanTier].submissionsPerMonth,
      "submissions_per_month",
    );
    if (attachmentIds.length > 0) {
      const storageUsed = await attachmentBytes.sum(ctx, {
        namespace: form.orgId,
      });
      if (storageUsed > PLAN_LIMITS[args.plan as PlanTier].storageBytes) {
        throw new ConvexError({
          code: "QUOTA_EXCEEDED",
          resource: "storage_bytes",
          current: storageUsed,
          limit: PLAN_LIMITS[args.plan as PlanTier].storageBytes,
        });
      }
    }

    const recordId = await ctx.db.insert("records", {
      orgId: form.orgId,
      baseId: form.baseId,
      tableId: form.tableId,
      rank: createRank(),
      values,
      status: "active",
      revision: 1,
      createdByType: "public_form",
      createdById: form._id,
      updatedByType: "public_form",
      updatedById: form._id,
      updatedAt: Date.now(),
    });
    const record = await ctx.db.get(recordId);
    await recordCount.insert(ctx, record!);
    await tableRecordCount.insert(ctx, record!);
    await recordTableViewChange(ctx, {
      orgId: form.orgId,
      baseId: form.baseId,
      tableId: form.tableId,
      recordIds: [recordId],
    });

    for (const attachmentId of attachmentIds) {
      const attachment = await ctx.db.get(attachmentId);
      if (!attachment) continue;
      await ctx.db.patch(attachmentId, {
        recordId,
        status: "attached",
      });
      await ctx.db.patch(attachment.uploadSessionId, { status: "claimed" });
    }

    const submittedAt = Date.now();
    const submissionId = await ctx.db.insert("formSubmissions", {
      orgId: form.orgId,
      formId: form._id,
      formVersionId: version._id,
      recordId,
      publicSubmissionSessionId: args.submissionSessionId,
      idempotencyKey: args.idempotencyKey,
      submittedMonth: month,
      submittedAt,
      answersSnapshot: versionFields.flatMap((field) => {
        const value = values[field.targetFieldId];
        return value === undefined
          ? []
          : [
              {
                formVersionFieldId: field._id,
                value,
              },
            ];
      }),
    });
    const submission = await ctx.db.get(submissionId);
    await submissionCount.insert(ctx, submission!);
    await ctx.db.patch(args.submissionSessionId, {
      status: "consumed",
      consumedAt: submittedAt,
    });
    await incrementSubmissionMetric(
      ctx,
      form,
      version._id,
      args.idempotencyKey,
    );
    await writeAudit(ctx, {
      orgId: form.orgId,
      actor: { type: "public_form", id: form._id },
      action: "record.created_from_form",
      resourceType: "record",
      resourceId: recordId,
      baseId: form.baseId,
      tableId: form.tableId,
      changedFieldIds: Object.keys(values) as Id<"fields">[],
      revisionAfter: 1,
    });
    await writeAudit(ctx, {
      orgId: form.orgId,
      actor: { type: "public_form", id: form._id },
      action: "form.submitted",
      resourceType: "submission",
      resourceId: submissionId,
      baseId: form.baseId,
      tableId: form.tableId,
    });
    return {
      submissionId,
      recordId,
      thankYou: version.thankYou,
      duplicate: false,
    };
  },
});

export const cleanupExpiredSubmissionSessions = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const sessions = await ctx.db
      .query("publicSubmissionSessions")
      .withIndex("by_status_and_expires_at", (q) =>
        q.eq("status", "active").lt("expiresAt", Date.now()),
      )
      .take(250);
    for (const session of sessions) {
      await ctx.db.patch(session._id, { status: "expired" });
    }
    return sessions.length;
  },
});
