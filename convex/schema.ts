import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  activeStatusValidator,
  actorTypeValidator,
  analyticsBreakdownKindValidator,
  analyticsMetricValidator,
  fieldConfigValidator,
  fieldTypeValidator,
  formAnswerValidator,
  formAppearanceValidator,
  formDraftVisibilityRuleValidator,
  formQuestionModeValidator,
  formStatusValidator,
  formVersionVisibilityRuleValidator,
  nullableCellValueValidator,
  planTierValidator,
  recordValuesValidator,
  resourceTypeValidator,
  thankYouValidator,
  viewConfigurationValidator,
  viewFieldFormattingValidator,
  viewFilterValidator,
  viewGroupValidator,
  viewSortValidator,
  viewStatusValidator,
  viewTypeValidator,
  viewVisibilityValidator,
} from "./lib/validators";

const aiReportFormatValidator = v.union(
  v.literal("report"),
  v.literal("chart"),
);

const aiReportCitationKindValidator = v.union(
  v.literal("table"),
  v.literal("view"),
  v.literal("form"),
  v.literal("formAnalytics"),
);

const aiReportCitationValidator = v.object({
  kind: aiReportCitationKindValidator,
  label: v.string(),
  href: v.string(),
});

const aiReportChartValidator = v.object({
  type: v.union(v.literal("bar"), v.literal("line")),
  title: v.string(),
  xLabel: v.string(),
  yLabel: v.string(),
  data: v.array(
    v.object({
      label: v.string(),
      value: v.number(),
    }),
  ),
});

const resourcePreferenceTypeValidator = v.union(
  v.literal("base"),
  v.literal("table"),
  v.literal("form"),
);

const fieldConversionJobStatusValidator = v.union(
  v.literal("staging"),
  v.literal("ready"),
  v.literal("applying"),
  v.literal("failed"),
  v.literal("cancelling"),
  v.literal("cancelled"),
  v.literal("completed"),
);

const fieldConversionJobPhaseValidator = v.union(
  v.literal("staging"),
  v.literal("applying"),
);

const fieldConversionScanStatusValidator = v.union(
  v.literal("active"),
  v.literal("deleted"),
);

const fieldConversionCountsValidator = v.object({
  reviewedRows: v.number(),
  filledCells: v.number(),
  keptAsIs: v.number(),
  changed: v.number(),
  cleared: v.number(),
  losingSomeInformation: v.number(),
  appliedRows: v.number(),
  rowsUpdated: v.number(),
});

const viewMaterializationStatusValidator = v.union(
  v.literal("building"),
  v.literal("active"),
  v.literal("failed"),
  v.literal("retired"),
);

const viewMaterializationPhaseValidator = v.union(
  v.literal("scan"),
  v.literal("catchup"),
);

export default defineSchema({
  bases: defineTable({
    orgId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    rank: v.string(),
    status: activeStatusValidator,
    createdByUserId: v.string(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_org_and_status_and_rank", ["orgId", "status", "rank"])
    .searchIndex("search_name_by_org_id_and_status", {
      searchField: "name",
      filterFields: ["orgId", "status"],
    }),

  demoSeedInstalls: defineTable({
    orgId: v.string(),
    templateKey: v.string(),
    templateVersion: v.number(),
    baseId: v.id("bases"),
    formId: v.id("forms"),
    publicFormSlug: v.string(),
    counts: v.object({
      tables: v.number(),
      fields: v.number(),
      records: v.number(),
      forms: v.number(),
    }),
    installedByUserId: v.string(),
    installedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_org_id_and_template_key", ["orgId", "templateKey"]),

  tables: defineTable({
    orgId: v.string(),
    baseId: v.id("bases"),
    name: v.string(),
    rank: v.string(),
    status: activeStatusValidator,
    primaryFieldId: v.optional(v.id("fields")),
    defaultViewId: v.optional(v.id("views")),
    createdByUserId: v.string(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_base_and_status_and_rank", ["baseId", "status", "rank"])
    .index("by_org_and_status", ["orgId", "status"])
    .searchIndex("search_name_by_org_id_and_status", {
      searchField: "name",
      filterFields: ["orgId", "status"],
    }),

  fields: defineTable({
    orgId: v.string(),
    baseId: v.id("bases"),
    tableId: v.id("tables"),
    name: v.string(),
    type: fieldTypeValidator,
    config: fieldConfigValidator,
    rank: v.string(),
    width: v.number(),
    isPrimary: v.boolean(),
    status: activeStatusValidator,
    revision: v.number(),
    createdByUserId: v.string(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_table_and_status_and_rank", ["tableId", "status", "rank"])
    .index("by_table_and_name", ["tableId", "name"])
    .index("by_org_and_status", ["orgId", "status"]),

  fieldConversionJobs: defineTable({
    orgId: v.string(),
    actorUserId: v.string(),
    baseId: v.id("bases"),
    tableId: v.id("tables"),
    fieldId: v.id("fields"),
    columnName: v.string(),
    sourceType: fieldTypeValidator,
    targetType: fieldTypeValidator,
    targetConfig: fieldConfigValidator,
    expectedFieldRevision: v.number(),
    previewVersion: v.string(),
    status: fieldConversionJobStatusValidator,
    phase: fieldConversionJobPhaseValidator,
    scanStatus: fieldConversionScanStatusValidator,
    scanCursor: v.union(v.string(), v.null()),
    applyCursor: v.union(v.string(), v.null()),
    acknowledgeDataLoss: v.boolean(),
    lockActive: v.boolean(),
    counts: fieldConversionCountsValidator,
    failureMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_field_and_lock_active", ["fieldId", "lockActive"])
    .index("by_table_and_lock_active", ["tableId", "lockActive"])
    .index("by_org_and_actor_and_updated_at", [
      "orgId",
      "actorUserId",
      "updatedAt",
    ]),

  fieldConversionShadowValues: defineTable({
    orgId: v.string(),
    jobId: v.id("fieldConversionJobs"),
    fieldId: v.id("fields"),
    recordId: v.id("records"),
    sourceRevision: v.number(),
    sourceHadValue: v.boolean(),
    sourceValue: nullableCellValueValidator,
    convertedValue: nullableCellValueValidator,
    outcome: v.union(
      v.literal("Kept as-is"),
      v.literal("Will change"),
      v.literal("Will be cleared"),
    ),
    lossy: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_job_and_record", ["jobId", "recordId"])
    .index("by_record", ["recordId"]),

  views: defineTable({
    orgId: v.string(),
    baseId: v.id("bases"),
    tableId: v.id("tables"),
    name: v.string(),
    type: viewTypeValidator,
    rank: v.string(),
    status: viewStatusValidator,
    visibility: viewVisibilityValidator,
    ownerUserId: v.optional(v.string()),
    isDefault: v.boolean(),
    filterConjunction: v.union(v.literal("and"), v.literal("or")),
    filters: v.array(viewFilterValidator),
    sorts: v.array(viewSortValidator),
    groups: v.array(viewGroupValidator),
    configuration: viewConfigurationValidator,
    revision: v.number(),
    createdByUserId: v.string(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_table_and_status_and_rank", ["tableId", "status", "rank"])
    .index("by_table_and_name", ["tableId", "name"])
    .index("by_org_and_status", ["orgId", "status"])
    .index("by_owner_and_status", ["orgId", "ownerUserId", "status"])
    .searchIndex("search_name_by_org_id_and_status", {
      searchField: "name",
      filterFields: ["orgId", "status"],
    }),

  viewMaterializations: defineTable({
    orgId: v.string(),
    baseId: v.id("bases"),
    tableId: v.id("tables"),
    viewId: v.id("views"),
    viewRevision: v.number(),
    generation: v.string(),
    status: viewMaterializationStatusValidator,
    phase: viewMaterializationPhaseValidator,
    scanCursor: v.union(v.string(), v.null()),
    indexedDataRevision: v.number(),
    matchedCount: v.number(),
    groupCountsReady: v.optional(v.boolean()),
    failureMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_view_and_status", ["viewId", "status"])
    .index("by_table_and_status", ["tableId", "status"])
    .index("by_view_and_revision", ["viewId", "viewRevision"]),

  viewRecordEntries: defineTable({
    orgId: v.string(),
    baseId: v.id("bases"),
    tableId: v.id("tables"),
    viewId: v.id("views"),
    materializationId: v.id("viewMaterializations"),
    recordId: v.id("records"),
    orderKey: v.string(),
    groupLabel: v.optional(v.string()),
    recordRevision: v.number(),
    updatedAt: v.number(),
  })
    .index("by_materialization_and_order", [
      "materializationId",
      "orderKey",
    ])
    .index("by_materialization_and_record", [
      "materializationId",
      "recordId",
    ])
    .index("by_record", ["recordId"]),

  viewGroupCounts: defineTable({
    orgId: v.string(),
    baseId: v.id("bases"),
    tableId: v.id("tables"),
    viewId: v.id("views"),
    materializationId: v.id("viewMaterializations"),
    groupLabel: v.string(),
    count: v.number(),
    updatedAt: v.number(),
  })
    .index("by_materialization_and_label", [
      "materializationId",
      "groupLabel",
    ])
    .index("by_materialization", ["materializationId"]),

  tableViewDataStates: defineTable({
    orgId: v.string(),
    baseId: v.id("bases"),
    tableId: v.id("tables"),
    revision: v.number(),
    updatedAt: v.number(),
  }).index("by_table", ["tableId"]),

  tableViewChanges: defineTable({
    orgId: v.string(),
    baseId: v.id("bases"),
    tableId: v.id("tables"),
    revision: v.number(),
    recordIds: v.array(v.id("records")),
    updatedAt: v.number(),
  }).index("by_table_and_revision", ["tableId", "revision"]),

  viewFieldConfigs: defineTable({
    orgId: v.string(),
    baseId: v.id("bases"),
    tableId: v.id("tables"),
    viewId: v.id("views"),
    fieldId: v.id("fields"),
    rank: v.string(),
    width: v.number(),
    hidden: v.boolean(),
    frozen: v.boolean(),
    formatting: viewFieldFormattingValidator,
    updatedAt: v.number(),
  })
    .index("by_view_and_rank", ["viewId", "rank"])
    .index("by_view_and_field", ["viewId", "fieldId"])
    .index("by_field", ["fieldId"])
    .index("by_org_and_table", ["orgId", "tableId"]),

  viewPreferences: defineTable({
    orgId: v.string(),
    userIdentityKey: v.string(),
    baseId: v.id("bases"),
    tableId: v.id("tables"),
    viewId: v.id("views"),
    isFavorite: v.boolean(),
    lastOpenedAt: v.union(v.number(), v.null()),
    updatedAt: v.number(),
  })
    .index("by_org_id_and_user_identity_key_and_view_id", [
      "orgId",
      "userIdentityKey",
      "viewId",
    ])
    .index("by_org_id_and_user_identity_key_and_table_id", [
      "orgId",
      "userIdentityKey",
      "tableId",
    ])
    .index("by_org_id_and_user_identity_key_and_last_opened_at", [
      "orgId",
      "userIdentityKey",
      "lastOpenedAt",
    ])
    .index("by_view_id", ["viewId"]),

  resourcePreferences: defineTable({
    orgId: v.string(),
    userIdentityKey: v.string(),
    resourceType: resourcePreferenceTypeValidator,
    resourceId: v.string(),
    isFavorite: v.boolean(),
    lastOpenedAt: v.union(v.number(), v.null()),
    updatedAt: v.number(),
  })
    .index("by_org_user_resource", [
      "orgId",
      "userIdentityKey",
      "resourceType",
      "resourceId",
    ])
    .index("by_org_user_favorite_updated", [
      "orgId",
      "userIdentityKey",
      "isFavorite",
      "updatedAt",
    ])
    .index("by_org_user_last_opened", [
      "orgId",
      "userIdentityKey",
      "lastOpenedAt",
    ]),

  records: defineTable({
    orgId: v.string(),
    baseId: v.id("bases"),
    tableId: v.id("tables"),
    rank: v.string(),
    values: recordValuesValidator,
    status: activeStatusValidator,
    revision: v.number(),
    createdByType: actorTypeValidator,
    createdById: v.string(),
    updatedByType: actorTypeValidator,
    updatedById: v.string(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_table_and_status_and_rank", ["tableId", "status", "rank"])
    .index("by_org_and_status", ["orgId", "status"]),

  recordMutationReceipts: defineTable({
    orgId: v.string(),
    idempotencyKey: v.string(),
    operation: v.union(
      v.literal("batch_update_cells"),
      v.literal("bulk_remove"),
    ),
    requestHash: v.string(),
    tableId: v.id("tables"),
    affectedCount: v.number(),
    revisions: v.array(
      v.object({
        recordId: v.id("records"),
        revision: v.number(),
      }),
    ),
    createdAt: v.number(),
  }).index("by_org_and_idempotency_key", ["orgId", "idempotencyKey"]),

  forms: defineTable({
    orgId: v.string(),
    baseId: v.id("bases"),
    tableId: v.id("tables"),
    name: v.string(),
    slug: v.string(),
    title: v.string(),
    description: v.string(),
    rank: v.string(),
    status: formStatusValidator,
    appearance: formAppearanceValidator,
    thankYou: thankYouValidator,
    allowMultipleSubmissions: v.optional(v.boolean()),
    analyticsTimeZone: v.optional(v.string()),
    currentPublishedVersionId: v.optional(v.id("formVersions")),
    draftRevision: v.number(),
    createdByUserId: v.string(),
    updatedAt: v.number(),
    publishedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_base_and_status_and_rank", ["baseId", "status", "rank"])
    .index("by_slug", ["slug"])
    .index("by_table_and_status", ["tableId", "status"])
    .index("by_logo_storage_id", ["appearance.logoStorageId"])
    .index("by_cover_storage_id", ["appearance.coverStorageId"])
    .searchIndex("search_name_by_org_id_and_status", {
      searchField: "name",
      filterFields: ["orgId", "status"],
    }),

  formSlugAliases: defineTable({
    slug: v.string(),
    formId: v.id("forms"),
    orgId: v.string(),
    createdAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_form_id", ["formId"]),

  formDraftFields: defineTable({
    orgId: v.string(),
    formId: v.id("forms"),
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
  })
    .index("by_form_and_rank", ["formId", "rank"])
    .index("by_form_and_target_field", ["formId", "targetFieldId"])
    .index("by_target_field", ["targetFieldId"]),

  formVersions: defineTable({
    orgId: v.string(),
    formId: v.id("forms"),
    baseId: v.id("bases"),
    tableId: v.id("tables"),
    version: v.number(),
    title: v.string(),
    description: v.string(),
    appearance: formAppearanceValidator,
    thankYou: thankYouValidator,
    publishedByUserId: v.string(),
    publishedAt: v.number(),
  })
    .index("by_form_and_version", ["formId", "version"])
    .index("by_org_and_form", ["orgId", "formId"])
    .index("by_logo_storage_id", ["appearance.logoStorageId"])
    .index("by_cover_storage_id", ["appearance.coverStorageId"]),

  formVersionFields: defineTable({
    orgId: v.string(),
    formId: v.id("forms"),
    formVersionId: v.id("formVersions"),
    targetFieldId: v.id("fields"),
    targetFieldType: fieldTypeValidator,
    targetFieldConfig: fieldConfigValidator,
    label: v.string(),
    description: v.optional(v.string()),
    placeholder: v.optional(v.string()),
    required: v.boolean(),
    rank: v.string(),
    mode: v.optional(formQuestionModeValidator),
    fixedValue: v.optional(nullableCellValueValidator),
    prefillParameter: v.optional(v.string()),
    visibility: v.optional(formVersionVisibilityRuleValidator),
  })
    .index("by_version_and_rank", ["formVersionId", "rank"])
    .index("by_version_and_target_field", [
      "formVersionId",
      "targetFieldId",
    ])
    .index("by_target_field", ["targetFieldId"]),

  formPublishedFieldRefs: defineTable({
    orgId: v.string(),
    formId: v.id("forms"),
    formVersionId: v.id("formVersions"),
    targetFieldId: v.id("fields"),
  })
    .index("by_form", ["formId"])
    .index("by_target_field", ["targetFieldId"]),

  formSubmissions: defineTable({
    orgId: v.string(),
    formId: v.id("forms"),
    formVersionId: v.id("formVersions"),
    recordId: v.id("records"),
    publicSubmissionSessionId: v.optional(
      v.id("publicSubmissionSessions"),
    ),
    idempotencyKey: v.string(),
    submittedMonth: v.string(),
    submittedAt: v.number(),
    answersSnapshot: v.optional(v.array(formAnswerValidator)),
  })
    .index("by_form_and_idempotency_key", ["formId", "idempotencyKey"])
    .index("by_form_and_submitted_at", ["formId", "submittedAt"])
    .index("by_org_and_submitted_month", ["orgId", "submittedMonth"]),

  publicSubmissionSessions: defineTable({
    orgId: v.string(),
    formId: v.id("forms"),
    formVersionId: v.id("formVersions"),
    planAtStart: planTierValidator,
    proofHash: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("consumed"),
      v.literal("expired"),
    ),
    expiresAt: v.number(),
    createdAt: v.number(),
    consumedAt: v.optional(v.number()),
  })
    .index("by_proof_hash", ["proofHash"])
    .index("by_status_and_expires_at", ["status", "expiresAt"]),

  uploadSessions: defineTable({
    orgId: v.string(),
    ownerUserId: v.optional(v.string()),
    formId: v.optional(v.id("forms")),
    formVersionId: v.optional(v.id("formVersions")),
    publicSubmissionSessionId: v.optional(
      v.id("publicSubmissionSessions"),
    ),
    fieldId: v.id("fields"),
    recordId: v.optional(v.id("records")),
    status: v.union(
      v.literal("pending"),
      v.literal("uploaded"),
      v.literal("claimed"),
      v.literal("expired"),
    ),
    expiresAt: v.number(),
    storageId: v.optional(v.id("_storage")),
    attachmentId: v.optional(v.id("attachments")),
    turnstileVerifiedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_status_and_expires_at", ["status", "expiresAt"])
    .index("by_owner_and_status", ["orgId", "ownerUserId", "status"])
    .index("by_form_and_status", ["formId", "status"])
    .index("by_public_submission_session", ["publicSubmissionSessionId"])
    .index("by_public_submission_session_and_field", [
      "publicSubmissionSessionId",
      "fieldId",
    ]),

  attachments: defineTable({
    orgId: v.string(),
    baseId: v.id("bases"),
    tableId: v.id("tables"),
    fieldId: v.id("fields"),
    recordId: v.optional(v.id("records")),
    formId: v.optional(v.id("forms")),
    uploadSessionId: v.id("uploadSessions"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    status: v.union(v.literal("staged"), v.literal("attached")),
    createdByType: actorTypeValidator,
    createdById: v.string(),
    createdAt: v.number(),
  })
    .index("by_record_and_field", ["recordId", "fieldId"])
    .index("by_upload_session", ["uploadSessionId"])
    .index("by_storage_id", ["storageId"])
    .index("by_org_and_status", ["orgId", "status"]),

  storageCleanupState: defineTable({
    job: v.string(),
    cursor: v.union(v.string(), v.null()),
    scannedInCycle: v.number(),
    deletedInCycle: v.number(),
    cycleStartedAt: v.number(),
    updatedAt: v.number(),
    lastCompletedAt: v.optional(v.number()),
  }).index("by_job", ["job"]),

  formMetricBuckets: defineTable({
    orgId: v.string(),
    formId: v.id("forms"),
    formVersionId: v.id("formVersions"),
    day: v.string(),
    metric: analyticsMetricValidator,
    shard: v.number(),
    count: v.number(),
    updatedAt: v.number(),
  })
    .index("by_form_and_day", ["formId", "day"])
    .index("by_form_and_day_and_metric_and_shard", [
      "formId",
      "day",
      "metric",
      "shard",
    ]),

  formStats: defineTable({
    orgId: v.string(),
    formId: v.id("forms"),
    views: v.number(),
    submissions: v.number(),
    updatedAt: v.number(),
  }).index("by_form", ["formId"]),

  formMetricDedupe: defineTable({
    orgId: v.string(),
    formId: v.id("forms"),
    formVersionId: v.id("formVersions"),
    day: v.string(),
    metric: v.union(
      v.literal("view"),
      v.literal("start"),
      v.literal("abandonment"),
    ),
    visitorHash: v.string(),
    createdAt: v.number(),
  })
    .index("by_form_day_metric_visitor", [
      "formId",
      "day",
      "metric",
      "visitorHash",
    ])
    .index("by_day", ["day"]),

  formAnalyticsBreakdownBuckets: defineTable({
    orgId: v.string(),
    formId: v.id("forms"),
    formVersionId: v.id("formVersions"),
    day: v.string(),
    kind: analyticsBreakdownKindValidator,
    dimension: v.string(),
    shard: v.number(),
    count: v.number(),
    updatedAt: v.number(),
  })
    .index("by_form_and_kind_and_day", ["formId", "kind", "day"])
    .index("by_form_and_day_and_kind_and_dimension_and_shard", [
      "formId",
      "day",
      "kind",
      "dimension",
      "shard",
    ]),

  auditEvents: defineTable({
    orgId: v.string(),
    actorType: actorTypeValidator,
    actorId: v.string(),
    action: v.string(),
    resourceType: resourceTypeValidator,
    resourceId: v.string(),
    baseId: v.optional(v.id("bases")),
    tableId: v.optional(v.id("tables")),
    changedFieldIds: v.optional(v.array(v.id("fields"))),
    revisionBefore: v.optional(v.number()),
    revisionAfter: v.optional(v.number()),
    sourceRunId: v.optional(v.string()),
    sourceToolCallId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_resource", ["orgId", "resourceType", "resourceId"]),

  aiSessions: defineTable({
    orgId: v.string(),
    ownerUserId: v.string(),
    externalSessionId: v.string(),
    continuationTokenHash: v.string(),
    title: v.string(),
    status: v.union(v.literal("active"), v.literal("closed")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_external_session", ["externalSessionId"])
    .index("by_continuation_token_hash", ["continuationTokenHash"])
    .index("by_owner_and_external", [
      "orgId",
      "ownerUserId",
      "externalSessionId",
    ])
    .index("by_owner_and_status", ["orgId", "ownerUserId", "status"]),

  aiReports: defineTable({
    orgId: v.string(),
    createdByUserId: v.string(),
    name: v.string(),
    content: v.string(),
    scopeLabel: v.string(),
    format: v.optional(aiReportFormatValidator),
    chart: v.optional(aiReportChartValidator),
    citations: v.optional(v.array(aiReportCitationValidator)),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
  }).index("by_org_and_status", ["orgId", "status"]),

  aiReportFieldRefs: defineTable({
    orgId: v.string(),
    reportId: v.id("aiReports"),
    baseId: v.id("bases"),
    tableId: v.id("tables"),
    fieldId: v.id("fields"),
    createdAt: v.number(),
  })
    .index("by_field", ["fieldId"])
    .index("by_report", ["reportId"]),

  aiUsageEvents: defineTable({
    orgId: v.string(),
    sessionId: v.id("aiSessions"),
    requestId: v.string(),
    month: v.string(),
    createdAt: v.number(),
  })
    .index("by_session_and_request", ["sessionId", "requestId"])
    .index("by_org_and_month", ["orgId", "month"]),

  aiRequestNonces: defineTable({
    nonceHash: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_nonce_hash", ["nonceHash"])
    .index("by_expires_at", ["expiresAt"]),

  aiCommandReceipts: defineTable({
    orgId: v.string(),
    sessionId: v.id("aiSessions"),
    idempotencyKey: v.string(),
    toolCallId: v.string(),
    operation: v.string(),
    payloadHash: v.string(),
    result: v.any(),
    createdAt: v.number(),
  })
    .index("by_org_and_idempotency_key", ["orgId", "idempotencyKey"])
    .index("by_session_and_tool_call", ["sessionId", "toolCallId"]),
});
