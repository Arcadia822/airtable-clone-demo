import { z } from "zod";

export const entityIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .describe("An application entity ID from the current page context or a prior tool result.");

export const shortTextSchema = z.string().trim().min(1).max(240);
export const optionalShortTextSchema = z.string().trim().max(240).optional();
export const jsonValueSchema = z.json();

export const fieldTypeSchema = z.enum([
  "singleLineText",
  "longText",
  "number",
  "currency",
  "percent",
  "rating",
  "checkbox",
  "date",
  "email",
  "phone",
  "url",
  "singleSelect",
  "multiSelect",
  "attachment",
  "image",
  "autoNumber",
  "createdTime",
  "createdBy",
]);

export const selectOptionSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    label: shortTextSchema,
    color: z.string().trim().min(1).max(32).optional(),
  })
  .strict();

export const fieldDefinitionSchema = z
  .object({
    id: entityIdSchema,
    name: shortTextSchema,
    type: fieldTypeSchema,
    revision: z.number().int().nonnegative(),
    config: z.record(z.string().max(120), jsonValueSchema).optional(),
    options: z.array(selectOptionSchema).max(200).optional(),
  })
  .strict();

export const assistantSourceKindSchema = z.enum([
  "table",
  "view",
  "form",
  "formAnalytics",
]);

export const assistantSourceEntitySchema = z
  .object({
    id: entityIdSchema,
    name: shortTextSchema,
  })
  .strict();

export const assistantSourceQuerySchema = z
  .object({
    kind: z.enum(["recordList", "tableSummary", "formAnalytics"]),
    description: z.string().trim().min(1).max(500),
    rowLimit: z.number().int().min(1).max(6_000),
  })
  .strict();

export const assistantSourceSchema = z
  .object({
    kind: assistantSourceKindSchema,
    base: assistantSourceEntitySchema,
    table: assistantSourceEntitySchema.optional(),
    view: assistantSourceEntitySchema.optional(),
    form: assistantSourceEntitySchema.optional(),
    fields: z.array(assistantSourceEntitySchema).max(100),
    records: z.array(assistantSourceEntitySchema).max(50).optional(),
    query: assistantSourceQuerySchema.optional(),
  })
  .strict();

export const describeTableInputSchema = z
  .object({
    baseId: entityIdSchema,
    tableId: entityIdSchema,
  })
  .strict();

export const describeTableOutputSchema = z
  .object({
    base: z.object({ id: entityIdSchema, name: shortTextSchema }).strict(),
    table: z
      .object({
        id: entityIdSchema,
        name: shortTextSchema,
        description: z.string().max(2_000).optional(),
        recordCount: z.number().int().nonnegative(),
        fields: z.array(fieldDefinitionSchema).max(100),
      })
      .strict(),
    views: z
      .array(
        z
          .object({
            id: entityIdSchema,
            name: shortTextSchema,
            type: z.enum(["grid", "kanban", "timeline", "calendar", "gallery", "dashboard"]),
          })
          .strict(),
      )
      .max(30),
    source: assistantSourceSchema,
    truncated: z.boolean(),
  })
  .strict();

export const listRecordsInputSchema = z
  .object({
    baseId: entityIdSchema,
    tableId: entityIdSchema,
    viewId: entityIdSchema.optional(),
    cursor: z.string().trim().min(1).max(1_024).optional(),
    limit: z.number().int().min(1).max(50).default(25),
    fieldIds: z.array(entityIdSchema).max(20).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    sort: z
      .object({
        fieldId: entityIdSchema,
        direction: z.enum(["asc", "desc"]),
      })
      .strict()
      .optional(),
  })
  .strict();

export const recordSnapshotSchema = z
  .object({
    id: entityIdSchema,
    version: z.number().int().nonnegative(),
    // Convex system creation times are millisecond timestamps, but can include a
    // fractional component. Preserve that source value instead of rounding it.
    createdAt: z.number().nonnegative().optional(),
    updatedAt: z.number().nonnegative().optional(),
    values: z.record(entityIdSchema, jsonValueSchema),
    attachmentCounts: z
      .record(entityIdSchema, z.number().int().nonnegative().max(10))
      .optional()
      .describe(
        "Attachment counts keyed by field ID. Attachment IDs, storage IDs, URLs, names, and contents are not exposed.",
      ),
  })
  .strict();

export const listRecordsOutputSchema = z
  .object({
    records: z.array(recordSnapshotSchema).max(50),
    nextCursor: z.string().max(1_024).nullable(),
    source: assistantSourceSchema,
    truncated: z.boolean(),
  })
  .strict();

export const summarizeTableInputSchema = z
  .object({
    baseId: entityIdSchema,
    tableId: entityIdSchema,
    fieldIds: z.array(entityIdSchema).min(1).max(10),
    groupByFieldId: entityIdSchema.optional(),
    topValues: z.number().int().min(1).max(20).default(10),
  })
  .strict();

export const fieldSummarySchema = z
  .object({
    fieldId: entityIdSchema,
    fieldName: shortTextSchema,
    fieldType: fieldTypeSchema,
    populatedCount: z.number().int().nonnegative(),
    emptyCount: z.number().int().nonnegative(),
    distinctCount: z.number().int().nonnegative().optional(),
    total: z.number().optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    average: z.number().optional(),
    topValues: z
      .array(
        z
          .object({
            value: jsonValueSchema,
            count: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .strict();

export const summarizeTableOutputSchema = z
  .object({
    recordCount: z.number().int().nonnegative(),
    summaries: z.array(fieldSummarySchema).max(10),
    grouped: z
      .array(
        z
          .object({
            group: jsonValueSchema,
            label: shortTextSchema,
            value: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    source: assistantSourceSchema,
    truncated: z.boolean(),
  })
  .strict();

export const inspectFormInputSchema = z
  .object({
    baseId: entityIdSchema,
    formId: entityIdSchema,
  })
  .strict();

export const formFieldSchema = z
  .object({
    formFieldId: entityIdSchema,
    fieldId: entityIdSchema,
    fieldName: shortTextSchema,
    label: shortTextSchema,
    description: z.string().max(1_000).optional(),
    required: z.boolean(),
    position: z.number().int().nonnegative(),
  })
  .strict();

export const inspectFormOutputSchema = z
  .object({
    form: z
      .object({
        id: entityIdSchema,
        baseId: entityIdSchema,
        tableId: entityIdSchema,
        title: shortTextSchema,
        description: z.string().max(2_000).optional(),
        isOpen: z.boolean(),
        submitButtonLabel: shortTextSchema,
        successMessage: z.string().max(2_000),
        accentColor: z.string().trim().min(1).max(64),
        version: z.number().int().nonnegative(),
        fields: z.array(formFieldSchema).max(100),
      })
      .strict(),
    source: assistantSourceSchema,
  })
  .strict();

export const formAnalyticsInputSchema = z
  .object({
    baseId: entityIdSchema,
    formId: entityIdSchema,
    days: z.number().int().min(1).max(90).default(30),
  })
  .strict();

export const formAnalyticsOutputSchema = z
  .object({
    range: z
      .object({
        from: z.string().date(),
        to: z.string().date(),
        timezone: z.string().trim().min(1).max(80),
      })
      .strict(),
    totals: z
      .object({
        views: z.number().int().nonnegative(),
        starts: z.number().int().nonnegative(),
        submissions: z.number().int().nonnegative(),
        completionRate: z.number().min(0).max(1),
      })
      .strict(),
    series: z
      .array(
        z
          .object({
            date: z.string().date(),
            views: z.number().int().nonnegative(),
            starts: z.number().int().nonnegative(),
            submissions: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(90),
    topReferrers: z
      .array(
        z
          .object({
            referrer: z.string().trim().min(1).max(500),
            submissions: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(20),
    source: assistantSourceSchema,
    truncated: z.boolean(),
  })
  .strict();

export const proposedCellValueSchema = z
  .object({
    fieldId: entityIdSchema,
    fieldName: shortTextSchema,
    value: jsonValueSchema,
  })
  .strict();

export const createRecordInputSchema = z
  .object({
    baseId: entityIdSchema,
    tableId: entityIdSchema,
    values: z.array(proposedCellValueSchema).min(1).max(50),
  })
  .strict();

export const updateRecordInputSchema = z
  .object({
    baseId: entityIdSchema,
    tableId: entityIdSchema,
    recordId: entityIdSchema,
    expectedVersion: z.number().int().nonnegative(),
    changes: z
      .array(
        z
          .object({
            fieldId: entityIdSchema,
            fieldName: shortTextSchema,
            before: jsonValueSchema,
            after: jsonValueSchema,
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

export const deleteRecordInputSchema = z
  .object({
    baseId: entityIdSchema,
    tableId: entityIdSchema,
    recordId: entityIdSchema,
    expectedVersion: z.number().int().nonnegative(),
    expectedPrimaryValue: jsonValueSchema,
    deletionSummary: z.array(z.string().trim().min(1).max(240)).min(1).max(20),
  })
  .strict();

export const createFieldInputSchema = z
  .object({
    baseId: entityIdSchema,
    tableId: entityIdSchema,
    field: z
      .object({
        name: shortTextSchema,
        type: fieldTypeSchema,
        config: z.record(z.string().max(120), jsonValueSchema).default({}),
      })
      .strict(),
    insertAfterFieldId: entityIdSchema.optional(),
  })
  .strict();

export const deleteFieldInputSchema = z
  .object({
    baseId: entityIdSchema,
    tableId: entityIdSchema,
    fieldId: entityIdSchema,
    expectedVersion: z.number().int().nonnegative(),
    expectedName: shortTextSchema,
    expectedType: fieldTypeSchema,
    dataLossSummary: z.string().trim().min(1).max(500),
  })
  .strict();

export const createTableFieldSchema = z
  .object({
    name: shortTextSchema,
    type: fieldTypeSchema,
    config: z.record(z.string().max(120), jsonValueSchema).default({}),
    primary: z.boolean().optional(),
  })
  .strict();

export const createTableInputSchema = z
  .object({
    baseId: entityIdSchema,
    name: shortTextSchema,
    description: z.string().trim().max(2_000).default(""),
    fields: z.array(createTableFieldSchema).min(1).max(40),
    sampleRows: z.array(z.record(z.string().max(240), jsonValueSchema)).max(50).optional(),
  })
  .strict();

export const createTableOutputSchema = z
  .object({
    tableId: entityIdSchema,
    name: shortTextSchema,
    fieldCount: z.number().int().nonnegative(),
    recordCount: z.number().int().nonnegative(),
    viewIds: z.array(entityIdSchema).max(6),
    href: z.string().trim().min(1).max(1_024),
  })
  .strict();

export const createViewInputSchema = z
  .object({
    baseId: entityIdSchema,
    tableId: entityIdSchema,
    name: shortTextSchema,
    type: z.enum(["grid", "kanban", "timeline", "calendar", "gallery", "dashboard"]),
    configuration: z.record(z.string().max(120), jsonValueSchema).default({}),
  })
  .strict();

export const createFormInputSchema = z
  .object({
    baseId: entityIdSchema,
    tableId: entityIdSchema,
    title: shortTextSchema,
    description: z.string().trim().max(2_000).default(""),
    fields: z
      .array(
        z
          .object({
            fieldId: entityIdSchema,
            fieldName: shortTextSchema,
            label: shortTextSchema,
            description: z.string().trim().max(1_000).default(""),
            required: z.boolean(),
            position: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    appearance: z
      .object({
        accentColor: z.string().trim().min(1).max(64),
        submitButtonLabel: shortTextSchema,
        successMessage: z.string().trim().min(1).max(2_000),
      })
      .strict(),
  })
  .strict();

export const updateFormSettingsInputSchema = z
  .object({
    baseId: entityIdSchema,
    formId: entityIdSchema,
    expectedVersion: z.number().int().nonnegative(),
    changes: z
      .array(
        z
          .object({
            property: z.enum([
              "title",
              "description",
              "submitButtonLabel",
              "successMessage",
              "accentColor",
              "isOpen",
              "allowMultipleSubmissions",
            ]),
            before: jsonValueSchema,
            after: jsonValueSchema,
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

export const mutationResultSchema = z
  .object({
    status: z.enum(["applied", "replayed"]),
    operationId: z.string().trim().min(1).max(256),
    summary: z.string().trim().min(1).max(1_000),
    entityIds: z.record(z.string().max(80), entityIdSchema).default({}),
  })
  .strict();

export const readOperationSchema = z.enum([
  "describe_table",
  "list_records",
  "summarize_table",
  "inspect_form",
  "form_analytics",
]);

export const writeOperationSchema = z.enum([
  "create_table",
  "create_record",
  "update_record",
  "delete_record",
  "create_field",
  "delete_field",
  "create_form",
  "create_view",
  "update_form_settings",
]);

export const assistantChartSchema = z
  .object({
    type: z.enum(["bar", "line"]),
    title: shortTextSchema,
    xLabel: shortTextSchema,
    yLabel: shortTextSchema,
    data: z
      .array(
        z
          .object({
            label: shortTextSchema,
            value: z.number().nonnegative(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

export const assistantCitationSchema = z
  .object({
    href: z.string().trim().min(1).max(2_048),
    kind: assistantSourceKindSchema,
    label: shortTextSchema,
  })
  .strict();

export const assistantDiffRowSchema = z
  .object({
    label: shortTextSchema,
    after: z.string().max(1_000),
    before: z.string().max(1_000).optional(),
  })
  .strict();

export const assistantProposalSchema = z
  .object({
    operation: writeOperationSchema,
    title: shortTextSchema,
    summary: z.string().trim().min(1).max(1_000),
    requiresApproval: z.literal(true),
    diff: z.array(assistantDiffRowSchema).max(20),
    input: z.record(z.string().max(240), jsonValueSchema),
    warnings: z.array(z.string().trim().min(1).max(500)).max(10),
    /** Server-issued, single-use approval ticket for the write route. */
    token: z.string().trim().min(8).max(120),
  })
  .strict();

export const assistantStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string().max(8_000) }).strict(),
  z
    .object({
      type: z.literal("tool_result"),
      tool: z.string().trim().min(1).max(80),
      data: jsonValueSchema,
    })
    .strict(),
  z.object({ type: z.literal("proposal"), proposal: assistantProposalSchema }).strict(),
  z.object({ type: z.literal("chart"), chart: assistantChartSchema }).strict(),
  z
    .object({
      type: z.literal("done"),
      requestId: entityIdSchema,
      citations: z.array(assistantCitationSchema).max(50),
      usage: z.record(z.string().max(40), z.number()).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      code: z.string().trim().min(1).max(60),
      message: z.string().trim().min(1).max(500),
      retryable: z.boolean(),
      requestId: entityIdSchema,
    })
    .strict(),
]);

export type AssistantChart = z.infer<typeof assistantChartSchema>;
export type AssistantCitation = z.infer<typeof assistantCitationSchema>;
export type AssistantProposal = z.infer<typeof assistantProposalSchema>;
export type AssistantStreamEvent = z.infer<typeof assistantStreamEventSchema>;

export const ownershipRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("register"),
      sessionId: entityIdSchema,
      continuationTokenHash: z.string().regex(/^[a-f0-9]{64}$/),
      organizationId: entityIdSchema,
      userId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("assert"),
      sessionId: entityIdSchema,
      organizationId: entityIdSchema,
      userId: entityIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("assert-continuation"),
      continuationTokenHash: z.string().regex(/^[a-f0-9]{64}$/),
      organizationId: entityIdSchema,
      userId: entityIdSchema,
    })
    .strict(),
]);

export const ownershipResultSchema = z
  .object({
    allowed: z.literal(true),
  })
  .strict();

export type EveTenantCaller = {
  organizationId: string;
  userId: string;
  sessionId: string;
  turnId: string;
  role?: string;
};

export type ReadOperation = z.infer<typeof readOperationSchema>;
export type WriteOperation = z.infer<typeof writeOperationSchema>;
export type MutationResult = z.infer<typeof mutationResultSchema>;
