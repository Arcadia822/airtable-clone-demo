import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

export const bases = pgTable(
  "bases",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    color: text("color").notNull().default("#2563eb"),
    rank: text("rank").notNull(),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bases_org_status_rank_idx").on(table.orgId, table.status, table.rank),
  ],
)

export const tables = pgTable(
  "tables",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    baseId: text("base_id")
      .notNull()
      .references(() => bases.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    rank: text("rank").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tables_base_status_rank_idx").on(table.baseId, table.status, table.rank),
    index("tables_org_status_idx").on(table.orgId, table.status),
  ],
)

export const fields = pgTable(
  "fields",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    tableId: text("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    rank: text("rank").notNull(),
    width: integer("width").notNull().default(180),
    isPrimary: boolean("is_primary").notNull().default(false),
    frozen: boolean("frozen").notNull().default(false),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fields_table_status_rank_idx").on(table.tableId, table.status, table.rank),
    index("fields_org_status_idx").on(table.orgId, table.status),
  ],
)

export const fieldSequences = pgTable("field_sequences", {
  fieldId: text("field_id")
    .primaryKey()
    .references(() => fields.id, { onDelete: "cascade" }),
  tableId: text("table_id")
    .notNull()
    .references(() => tables.id, { onDelete: "cascade" }),
  nextValue: integer("next_value").notNull().default(1),
})

export const views = pgTable(
  "views",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    tableId: text("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull().default("grid"),
    visibility: text("visibility").notNull().default("shared"),
    ownerUserId: text("owner_user_id"),
    isDefault: boolean("is_default").notNull().default(false),
    rank: text("rank").notNull(),
    filterConjunction: text("filter_conjunction").notNull().default("and"),
    filters: jsonb("filters").$type<unknown[]>().notNull().default([]),
    sorts: jsonb("sorts").$type<unknown[]>().notNull().default([]),
    groups: jsonb("groups").$type<unknown[]>().notNull().default([]),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("views_table_status_rank_idx").on(table.tableId, table.status, table.rank),
    index("views_org_status_idx").on(table.orgId, table.status),
  ],
)

export const viewFieldConfigs = pgTable(
  "view_field_configs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    viewId: text("view_id")
      .notNull()
      .references(() => views.id, { onDelete: "cascade" }),
    fieldId: text("field_id")
      .notNull()
      .references(() => fields.id, { onDelete: "cascade" }),
    hidden: boolean("hidden").notNull().default(false),
    frozen: boolean("frozen").notNull().default(false),
    width: integer("width"),
    rank: text("rank").notNull(),
    formatting: jsonb("formatting").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    uniqueIndex("view_field_configs_view_field_idx").on(table.viewId, table.fieldId),
  ],
)

export const records = pgTable(
  "records",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    tableId: text("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "cascade" }),
    rank: text("rank").notNull(),
    values: jsonb("values").$type<Record<string, unknown>>().notNull().default({}),
    searchText: text("search_text").notNull().default(""),
    revision: integer("revision").notNull().default(1),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("records_table_status_rank_idx").on(table.tableId, table.status, table.rank),
    index("records_org_status_idx").on(table.orgId, table.status),
  ],
)

export const attachments = pgTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    tableId: text("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "cascade" }),
    recordId: text("record_id"),
    fieldId: text("field_id"),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("attachments_table_status_idx").on(table.tableId, table.status),
    index("attachments_org_status_idx").on(table.orgId, table.status),
  ],
)

export const uploadSessions = pgTable("upload_sessions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  tableId: text("table_id")
    .notNull()
    .references(() => tables.id, { onDelete: "cascade" }),
  recordId: text("record_id"),
  fieldId: text("field_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const forms = pgTable(
  "forms",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    baseId: text("base_id")
      .notNull()
      .references(() => bases.id, { onDelete: "cascade" }),
    tableId: text("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    slug: text("slug").notNull().unique(),
    status: text("status").notNull().default("draft"),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    theme: jsonb("theme").$type<Record<string, unknown>>().notNull().default({}),
    thankYou: jsonb("thank_you").$type<Record<string, unknown>>().notNull().default({}),
    analyticsTimeZone: text("analytics_time_zone").notNull().default("UTC"),
    publishedVersionId: text("published_version_id"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("forms_base_status_idx").on(table.baseId, table.status),
    index("forms_org_status_idx").on(table.orgId, table.status),
  ],
)

export const formDraftFields = pgTable(
  "form_draft_fields",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    targetFieldId: text("target_field_id")
      .notNull()
      .references(() => fields.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    helpText: text("help_text").notNull().default(""),
    placeholder: text("placeholder").notNull().default(""),
    required: boolean("required").notNull().default(false),
    hidden: boolean("hidden").notNull().default(false),
    rank: text("rank").notNull(),
    mode: text("mode").notNull().default("visible"),
    visibilityRule: jsonb("visibility_rule").$type<Record<string, unknown> | null>(),
  },
  (table) => [
    index("form_draft_fields_form_rank_idx").on(table.formId, table.rank),
  ],
)

export const formVersions = pgTable(
  "form_versions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    theme: jsonb("theme").$type<Record<string, unknown>>().notNull().default({}),
    thankYou: jsonb("thank_you").$type<Record<string, unknown>>().notNull().default({}),
    publishedBy: text("published_by").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("form_versions_form_idx").on(table.formId, table.versionNumber),
  ],
)

export const formVersionFields = pgTable(
  "form_version_fields",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    formVersionId: text("form_version_id")
      .notNull()
      .references(() => formVersions.id, { onDelete: "cascade" }),
    targetFieldId: text("target_field_id").notNull(),
    targetFieldType: text("target_field_type").notNull(),
    label: text("label").notNull(),
    helpText: text("help_text").notNull().default(""),
    placeholder: text("placeholder").notNull().default(""),
    required: boolean("required").notNull().default(false),
    hidden: boolean("hidden").notNull().default(false),
    rank: text("rank").notNull(),
    mode: text("mode").notNull().default("visible"),
    fieldConfig: jsonb("field_config").$type<Record<string, unknown>>().notNull().default({}),
    visibilityRule: jsonb("visibility_rule").$type<Record<string, unknown> | null>(),
  },
  (table) => [
    index("form_version_fields_version_rank_idx").on(table.formVersionId, table.rank),
  ],
)

export const formSubmissions = pgTable(
  "form_submissions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    formVersionId: text("form_version_id")
      .notNull()
      .references(() => formVersions.id, { onDelete: "cascade" }),
    recordId: text("record_id"),
    answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default({}),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("form_submissions_form_submitted_idx").on(table.formId, table.submittedAt),
  ],
)

export const formMetricBuckets = pgTable(
  "form_metric_buckets",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    metric: text("metric").notNull(),
    breakdownKind: text("breakdown_kind").notNull().default("total"),
    breakdownKey: text("breakdown_key").notNull().default("all"),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    index("form_metric_buckets_form_day_idx").on(table.formId, table.day),
  ],
)

export const aiReports = pgTable(
  "ai_reports",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    baseId: text("base_id")
      .notNull()
      .references(() => bases.id, { onDelete: "cascade" }),
    tableId: text("table_id"),
    name: text("name").notNull(),
    format: text("format").notNull().default("markdown"),
    scopeLabel: text("scope_label").notNull().default(""),
    content: text("content").notNull(),
    chart: jsonb("chart").$type<Record<string, unknown> | null>(),
    citations: jsonb("citations").$type<unknown[]>().notNull().default([]),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ai_reports_base_status_idx").on(table.baseId, table.status),
  ],
)

export const resourcePreferences = pgTable(
  "resource_preferences",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    favorited: boolean("favorited").notNull().default(false),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("resource_preferences_user_resource_idx").on(
      table.orgId,
      table.userId,
      table.resourceType,
      table.resourceId,
    ),
  ],
)
