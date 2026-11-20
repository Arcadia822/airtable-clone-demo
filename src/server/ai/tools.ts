import { createHash } from "node:crypto"

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  sql,
} from "drizzle-orm"
import {
  generateKeyBetween,
  generateNKeysBetween,
} from "jittered-fractional-indexing"
import { nanoid } from "nanoid"
import { z } from "zod"

import {
  aiWriteProposals,
  bases,
  fields,
  fieldSequences,
  formDraftFields,
  formMetricBuckets,
  formSubmissions,
  formVersions,
  forms,
  records,
  tables,
  views,
} from "../../../drizzle/schema"
import type { AppDb } from "@/db/client"
import {
  MAX_RECORD_VALUE_BYTES,
  validateCellValue,
  validateFieldConfiguration,
  validateRecordValues,
} from "@/lib/cell-validation"
import {
  AppError,
  FIELD_TYPES,
  type CellValue,
  type FieldConfig,
  type FieldDefinition,
  type FieldType,
  type SelectOption,
  type ViewType,
} from "@/lib/domain"
import { getFieldTypeLabel } from "@/lib/field-type-meta"
import {
  analyticsDay,
  analyticsRange,
  resolvedAnalyticsTimeZone,
} from "@/lib/form-analytics"
import {
  assistantSourceSchema,
  createFieldInputSchema,
  createFormInputSchema,
  createRecordInputSchema,
  createTableInputSchema,
  createTableOutputSchema,
  createViewInputSchema,
  deleteFieldInputSchema,
  deleteRecordInputSchema,
  describeTableInputSchema,
  describeTableOutputSchema,
  fieldSummarySchema,
  formAnalyticsInputSchema,
  formAnalyticsOutputSchema,
  inspectFormInputSchema,
  inspectFormOutputSchema,
  jsonValueSchema,
  listRecordsInputSchema,
  listRecordsOutputSchema,
  readOperationSchema,
  summarizeTableInputSchema,
  summarizeTableOutputSchema,
  updateFormSettingsInputSchema,
  updateRecordInputSchema,
  writeOperationSchema,
} from "@/lib/eve/contracts"
import type { AuthenticatedSession } from "@/server/auth"
import { HttpStatusError } from "@/server/http"
import { rebuildTableSearchText } from "@/server/services/fields"
import { allocateSequenceValues } from "@/server/services/tables"
import { buildRecordSearchText } from "@/server/search-text"

export type ReadOperation = z.infer<typeof readOperationSchema>
export type WriteOperation = z.infer<typeof writeOperationSchema>

export type JsonValue = z.infer<typeof jsonValueSchema>

export interface AiToolContext {
  db: AppDb
  session: AuthenticatedSession
}

const MAX_SUMMARY_RECORDS = 5_000
const MAX_TOP_VALUES = 20

const NUMERIC_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  "number",
  "currency",
  "percent",
  "rating",
])

const CHOICE_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  "singleSelect",
  "multiSelect",
])

const OPTION_COLORS = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
  "#65a30d",
  "#db2777",
]

const FORM_PROPERTY_LABELS: Record<string, string> = {
  accentColor: "Brand color",
  allowMultipleSubmissions: "Repeat submissions",
  description: "Description",
  isOpen: "Accepting responses",
  submitButtonLabel: "Submit button",
  successMessage: "Thank-you message",
  title: "Form title",
}

/* -------------------------------------------------------------------------- */
/* Read tools                                                                  */
/* -------------------------------------------------------------------------- */

export type DescribeTableOutput = z.infer<typeof describeTableOutputSchema>
export type ListRecordsOutput = z.infer<typeof listRecordsOutputSchema>
export type SummarizeTableOutput = z.infer<typeof summarizeTableOutputSchema>
export type InspectFormOutput = z.infer<typeof inspectFormOutputSchema>
export type FormAnalyticsOutput = z.infer<typeof formAnalyticsOutputSchema>

export async function runReadTool(
  ctx: AiToolContext,
  operation: ReadOperation,
  input: unknown,
): Promise<unknown> {
  switch (operation) {
    case "describe_table":
      return describeTable(ctx, input)
    case "list_records":
      return listRecords(ctx, input)
    case "summarize_table":
      return summarizeTable(ctx, input)
    case "inspect_form":
      return inspectForm(ctx, input)
    case "form_analytics":
      return formAnalytics(ctx, input)
  }
}

export async function describeTable(
  ctx: AiToolContext,
  rawInput: unknown,
): Promise<DescribeTableOutput> {
  const input = describeTableInputSchema.parse(rawInput)
  const base = await requireBase(ctx, input.baseId)
  const table = await requireTable(ctx, base.id, input.tableId)
  const fieldRows = await loadFieldRows(ctx, table.id)
  const viewRows = await loadViewRows(ctx, table.id)
  const recordCount = await countRecords(ctx, table.id)

  const fieldDefinitions = fieldRows.map(toFieldDefinition)

  return {
    base: { id: base.id, name: base.name },
    table: {
      id: table.id,
      name: table.name,
      ...(table.description.trim()
        ? { description: table.description }
        : {}),
      recordCount,
      fields: fieldDefinitions.map((field) =>
        contractField(field, fieldRows.find((row) => row.id === field.id)),
      ),
    },
    views: viewRows.slice(0, 30).map((view) => ({
      id: view.id,
      name: view.name,
      type: view.type as ViewType,
    })),
    source: tableSource(
      { id: base.id, name: base.name },
      { id: table.id, name: table.name },
      fieldDefinitions.map((field) => ({ id: field.id, name: field.name })),
      {
        description: `Table structure for ${table.name}`,
        kind: "tableSummary",
        rowLimit: MAX_SUMMARY_RECORDS,
      },
    ),
    truncated: fieldRows.length > 100 || viewRows.length > 30,
  }
}

export async function listRecords(
  ctx: AiToolContext,
  rawInput: unknown,
): Promise<ListRecordsOutput> {
  const input = listRecordsInputSchema.parse(rawInput)
  const base = await requireBase(ctx, input.baseId)
  const table = await requireTable(ctx, base.id, input.tableId)
  const fieldRows = await loadFieldRows(ctx, table.id)
  const fieldDefinitions = fieldRows.map(toFieldDefinition)
  const primary = primaryField(fieldDefinitions)
  const offset = parseCursor(input.cursor)

  const where = [
    eq(records.orgId, ctx.session.orgId),
    eq(records.tableId, table.id),
    eq(records.status, "active"),
  ]
  // Same term-AND semantics as `queryRecords`: every word must appear.
  const searchTerms = (input.search ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  for (const term of searchTerms) {
    where.push(sql`${records.searchText} ilike ${likePattern(term)} escape '\\'`)
  }

  const sortField = input.sort
    ? fieldDefinitions.find((field) => field.id === input.sort?.fieldId)
    : undefined
  if (input.sort && !sortField) {
    throw new AppError("NOT_FOUND", "That column is no longer available.")
  }

  // Ordering happens in SQL over the whole table: sorting a capped in-memory
  // window paginated rows inconsistently and dropped matches beyond the cap.
  const orderBy = sortField
    ? [
        input.sort?.direction === "desc"
          ? sql`${sortExpression(sortField)} desc nulls last`
          : sql`${sortExpression(sortField)} asc nulls last`,
        asc(records.rank),
      ]
    : [asc(records.rank)]

  const rows = await ctx.db
    .select()
    .from(records)
    .where(and(...where))
    .orderBy(...orderBy)
    .limit(input.limit + 1)
    .offset(offset)
  const scanned = rows.slice(0, input.limit)
  const hasMore = rows.length > input.limit

  const projectedFields = input.fieldIds
    ? fieldDefinitions.filter((field) => input.fieldIds?.includes(field.id))
    : fieldDefinitions

  const snapshots = scanned.map((row) => {
    const values: Record<string, unknown> = {}
    for (const field of projectedFields) {
      const value = row.values[field.id]
      if (value !== undefined) values[field.id] = value
    }
    const attachmentCounts: Record<string, number> = {}
    for (const field of projectedFields.slice(0, 10)) {
      if (field.type !== "attachment" && field.type !== "image") continue
      const value = row.values[field.id]
      if (Array.isArray(value) && value.length > 0) {
        attachmentCounts[field.id] = Math.min(value.length, 10)
      }
    }
    return {
      id: row.id,
      version: row.revision,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      values: values as unknown as Record<string, JsonValue>,
      ...(Object.keys(attachmentCounts).length > 0
        ? { attachmentCounts }
        : {}),
    }
  })

  const nextCursor = hasMore ? String(offset + scanned.length) : null
  const truncated = Boolean(nextCursor)

  return {
    records: snapshots,
    nextCursor,
    source: tableSource(
      { id: base.id, name: base.name },
      { id: table.id, name: table.name },
      fieldDefinitions.map((field) => ({ id: field.id, name: field.name })),
      {
        description: input.search
          ? `Records matching "${input.search}" in ${table.name}`
          : `Sample records from ${table.name}`,
        kind: "recordList",
        rowLimit: Math.max(1, Math.min(6_000, snapshots.length)),
        records: snapshots.slice(0, 50).map((snapshot) => ({
          id: snapshot.id,
          name: recordLabel(snapshot.values, primary) ?? "Untitled record",
        })),
      },
    ),
    truncated,
  }
}

export async function summarizeTable(
  ctx: AiToolContext,
  rawInput: unknown,
): Promise<SummarizeTableOutput> {
  const input = summarizeTableInputSchema.parse(rawInput)
  const base = await requireBase(ctx, input.baseId)
  const table = await requireTable(ctx, base.id, input.tableId)
  const fieldRows = await loadFieldRows(ctx, table.id)
  const fieldDefinitions = fieldRows.map(toFieldDefinition)
  const totalRecords = await countRecords(ctx, table.id)

  const selectedFields = input.fieldIds.map((fieldId) => {
    const field = fieldDefinitions.find((candidate) => candidate.id === fieldId)
    if (!field) {
      throw new AppError("NOT_FOUND", "That column is no longer available.")
    }
    return field
  })

  const groupField = input.groupByFieldId
    ? fieldDefinitions.find((field) => field.id === input.groupByFieldId)
    : undefined
  if (input.groupByFieldId && !groupField) {
    throw new AppError("NOT_FOUND", "That grouping column is no longer available.")
  }

  const rows = await ctx.db
    .select({ values: records.values })
    .from(records)
    .where(
      and(
        eq(records.orgId, ctx.session.orgId),
        eq(records.tableId, table.id),
        eq(records.status, "active"),
      ),
    )
    .orderBy(asc(records.rank))
    .limit(MAX_SUMMARY_RECORDS)

  const summaries = selectedFields.map((field) =>
    summarizeField(
      field,
      rows.map((row) => row.values[field.id]),
      input.topValues,
    ),
  )

  const grouped = groupField
    ? groupValues(
        groupField,
        rows.map((row) => row.values[groupField.id]),
        MAX_TOP_VALUES,
      )
    : undefined

  return {
    recordCount: totalRecords,
    summaries,
    ...(grouped ? { grouped } : {}),
    source: tableSource(
      { id: base.id, name: base.name },
      { id: table.id, name: table.name },
      selectedFields.map((field) => ({ id: field.id, name: field.name })),
      {
        description: grouped
          ? `Summary of ${table.name} grouped by ${groupField?.name ?? "value"}`
          : `Summary of ${table.name}`,
        kind: "tableSummary",
        rowLimit: Math.max(1, Math.min(6_000, rows.length)),
      },
    ),
    truncated: totalRecords > rows.length,
  }
}

export async function inspectForm(
  ctx: AiToolContext,
  rawInput: unknown,
): Promise<InspectFormOutput> {
  const input = inspectFormInputSchema.parse(rawInput)
  const base = await requireBase(ctx, input.baseId)
  const form = await requireForm(ctx, base.id, input.formId)
  const draftFields = await ctx.db
    .select()
    .from(formDraftFields)
    .where(eq(formDraftFields.formId, form.id))
    .orderBy(asc(formDraftFields.rank))
  const targetIds = draftFields.map((row) => row.targetFieldId)
  const targetRows =
    targetIds.length > 0
      ? await ctx.db
          .select()
          .from(fields)
          .where(
            and(
              eq(fields.orgId, ctx.session.orgId),
              inArray(fields.id, targetIds),
            ),
          )
      : []
  const targetById = new Map(targetRows.map((row) => [row.id, row]))
  const latestVersion = await latestFormVersion(ctx, form.id)

  const settings = form.settings as Record<string, unknown>
  const theme = form.theme as Record<string, unknown>
  const thankYou = form.thankYou as Record<string, unknown>

  return {
    form: {
      id: form.id,
      baseId: form.baseId,
      tableId: form.tableId,
      title: form.name,
      ...(form.description.trim() ? { description: form.description } : {}),
      isOpen: form.status === "published",
      submitButtonLabel: stringSetting(settings.submitButtonLabel) ?? "Submit",
      successMessage:
        stringSetting(thankYou.message) ??
        stringSetting(thankYou.title) ??
        "Thanks for your response.",
      accentColor: stringSetting(theme.accentColor) ?? "#2563eb",
      version: latestVersion?.versionNumber ?? 0,
      fields: draftFields.slice(0, 100).map((row, index) => ({
        formFieldId: row.id,
        fieldId: row.targetFieldId,
        fieldName: targetById.get(row.targetFieldId)?.name ?? row.label,
        label: row.label.trim() || targetById.get(row.targetFieldId)?.name || "Untitled question",
        ...(row.helpText.trim() ? { description: row.helpText } : {}),
        required: row.required,
        position: index,
      })),
    },
    source: {
      kind: "form",
      base: { id: base.id, name: base.name },
      form: { id: form.id, name: form.name },
      fields: [],
      query: {
        kind: "formAnalytics",
        description: `Form setup for ${form.name}`,
        rowLimit: Math.max(1, draftFields.length),
      },
    },
  }
}

export async function formAnalytics(
  ctx: AiToolContext,
  rawInput: unknown,
): Promise<FormAnalyticsOutput> {
  const input = formAnalyticsInputSchema.parse(rawInput)
  const base = await requireBase(ctx, input.baseId)
  const form = await requireForm(ctx, base.id, input.formId)
  const timezone = resolvedAnalyticsTimeZone()
  const range = analyticsRange(input.days)
  const days = enumerateDays(range.fromDay, range.toDay)
  const from = new Date(`${range.fromDay}T00:00:00.000Z`)

  const submissionRows = await ctx.db
    .select({
      submittedAt: formSubmissions.submittedAt,
      metadata: formSubmissions.metadata,
    })
    .from(formSubmissions)
    .where(
      and(
        eq(formSubmissions.orgId, ctx.session.orgId),
        eq(formSubmissions.formId, form.id),
        gte(formSubmissions.submittedAt, from),
      ),
    )

  const bucketRows = await ctx.db
    .select({
      day: formMetricBuckets.day,
      metric: formMetricBuckets.metric,
      breakdownKind: formMetricBuckets.breakdownKind,
      count: formMetricBuckets.count,
    })
    .from(formMetricBuckets)
    .where(
      and(
        eq(formMetricBuckets.orgId, ctx.session.orgId),
        eq(formMetricBuckets.formId, form.id),
        gte(formMetricBuckets.day, range.fromDay),
      ),
    )

  const bucketsByDay = new Map<string, { submissions: number; starts: number; views: number }>()
  for (const day of days) {
    bucketsByDay.set(day, { starts: 0, submissions: 0, views: 0 })
  }

  for (const row of bucketRows) {
    const bucket = bucketsByDay.get(row.day)
    if (!bucket || row.breakdownKind !== "total") continue
    const metric = row.metric.toLowerCase()
    if (metric === "view" || metric === "views") bucket.views += row.count
    else if (metric === "start" || metric === "starts") bucket.starts += row.count
    else if (metric === "submission" || metric === "submissions") {
      bucket.submissions += row.count
    }
  }

  const submissionCountByDay = new Map<string, number>()
  const referrers = new Map<string, number>()
  let submissions = 0
  for (const row of submissionRows) {
    submissions += 1
    const day = analyticsDay(row.submittedAt, timezone)
    if (bucketsByDay.has(day)) {
      submissionCountByDay.set(day, (submissionCountByDay.get(day) ?? 0) + 1)
    }
    const referrer = stringSetting(
      (row.metadata as Record<string, unknown>).referrer,
    )
    if (referrer) {
      referrers.set(referrer.slice(0, 500), (referrers.get(referrer) ?? 0) + 1)
    }
  }

  const series = days.map((day) => {
    const bucket = bucketsByDay.get(day) ?? {
      starts: 0,
      submissions: 0,
      views: 0,
    }
    return {
      date: day,
      views: bucket.views,
      starts: bucket.starts,
      submissions: Math.max(bucket.submissions, submissionCountByDay.get(day) ?? 0),
    }
  })

  const views = series.reduce((total, row) => total + row.views, 0)
  const starts = series.reduce((total, row) => total + row.starts, 0)
  // Same definition as the analytics service: starts first, views as fallback.
  const denominator = starts > 0 ? starts : views

  return {
    range: { from: range.fromDay, to: range.toDay, timezone },
    totals: {
      views,
      starts,
      submissions,
      completionRate:
        denominator > 0
          ? clampRatio(submissions / denominator)
          : submissions > 0
            ? 1
            : 0,
    },
    series,
    topReferrers: [...referrers.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 20)
      .map(([referrer, count]) => ({ referrer, submissions: count })),
    source: {
      kind: "formAnalytics",
      base: { id: base.id, name: base.name },
      form: { id: form.id, name: form.name },
      fields: [],
      query: {
        kind: "formAnalytics",
        description: `Form performance for ${form.name} over ${input.days} days`,
        rowLimit: Math.max(1, Math.min(6_000, submissionRows.length)),
      },
    },
    truncated: submissionRows.length >= 6_000,
  }
}

/* -------------------------------------------------------------------------- */
/* Write proposals                                                             */
/* -------------------------------------------------------------------------- */

export interface WriteDiffRow {
  label: string
  after: string
  before?: string
}

export interface WriteProposal {
  operation: WriteOperation
  title: string
  summary: string
  requiresApproval: true
  diff: WriteDiffRow[]
  input: Record<string, JsonValue>
  warnings: string[]
}

export interface WriteExecution {
  operation: WriteOperation
  summary: string
  entityIds: Record<string, string>
  result: Record<string, JsonValue>
}

type ParsedWrite =
  | { operation: "create_table"; input: z.infer<typeof createTableInputSchema> }
  | { operation: "create_field"; input: z.infer<typeof createFieldInputSchema> }
  | { operation: "create_record"; input: z.infer<typeof createRecordInputSchema> }
  | { operation: "update_record"; input: z.infer<typeof updateRecordInputSchema> }
  | { operation: "delete_record"; input: z.infer<typeof deleteRecordInputSchema> }
  | { operation: "delete_field"; input: z.infer<typeof deleteFieldInputSchema> }
  | { operation: "create_form"; input: z.infer<typeof createFormInputSchema> }
  | { operation: "update_form_settings"; input: z.infer<typeof updateFormSettingsInputSchema> }
  | { operation: "create_view"; input: z.infer<typeof createViewInputSchema> }

function parseWriteInput(
  operation: WriteOperation,
  input: unknown,
): ParsedWrite {
  switch (operation) {
    case "create_table":
      return { operation, input: createTableInputSchema.parse(input) }
    case "create_field":
      return { operation, input: createFieldInputSchema.parse(input) }
    case "create_record":
      return { operation, input: createRecordInputSchema.parse(input) }
    case "update_record":
      return { operation, input: updateRecordInputSchema.parse(input) }
    case "delete_record":
      return { operation, input: deleteRecordInputSchema.parse(input) }
    case "delete_field":
      return { operation, input: deleteFieldInputSchema.parse(input) }
    case "create_form":
      return { operation, input: createFormInputSchema.parse(input) }
    case "update_form_settings":
      return { operation, input: updateFormSettingsInputSchema.parse(input) }
    case "create_view":
      return { operation, input: createViewInputSchema.parse(input) }
  }
}

/**
 * Describes an approved-write proposal without touching the database. The
 * returned `input` is the normalized payload the client sends back for
 * execution, so validation happens again on the write path.
 */
export async function buildWriteProposal(
  ctx: AiToolContext,
  operation: WriteOperation,
  rawInput: unknown,
): Promise<WriteProposal> {
  const parsed = parseWriteInput(operation, rawInput)

  switch (parsed.operation) {
    case "create_table":
      return proposeCreateTable(ctx, parsed.input)
    case "create_field":
      return proposeCreateField(ctx, parsed.input)
    case "create_record":
      return proposeCreateRecord(ctx, parsed.input)
    case "update_record":
      return proposeUpdateRecord(ctx, parsed.input)
    case "delete_record":
      return proposeDeleteRecord(ctx, parsed.input)
    case "delete_field":
      return proposeDeleteField(ctx, parsed.input)
    case "create_form":
      return proposeCreateForm(ctx, parsed.input)
    case "update_form_settings":
      return proposeUpdateFormSettings(ctx, parsed.input)
    case "create_view":
      return proposeCreateView(ctx, parsed.input)
  }
}

/** Executes a write the user has already approved. */
export async function executeApprovedWrite(
  ctx: AiToolContext,
  operation: WriteOperation,
  rawInput: unknown,
): Promise<WriteExecution> {
  const parsed = parseWriteInput(operation, rawInput)

  switch (parsed.operation) {
    case "create_table":
      return executeCreateTable(ctx, parsed.input)
    case "create_field":
      return executeCreateField(ctx, parsed.input)
    case "create_record":
      return executeCreateRecord(ctx, parsed.input)
    case "update_record":
      return executeUpdateRecord(ctx, parsed.input)
    case "delete_record":
      return executeDeleteRecord(ctx, parsed.input)
    case "delete_field":
      return executeDeleteField(ctx, parsed.input)
    case "create_form":
      return executeCreateForm(ctx, parsed.input)
    case "update_form_settings":
      return executeUpdateFormSettings(ctx, parsed.input)
    case "create_view":
      return executeCreateView(ctx, parsed.input)
  }
}

/* ---- approval tokens ----------------------------------------------------- */

/**
 * How long an approval stays valid. Short on purpose: a proposal is meant to be
 * reviewed and applied in one sitting, not replayed hours later.
 */
const WRITE_PROPOSAL_TTL_MS = 15 * 60 * 1000

/** JSON with sorted keys, so an input hash ignores object key order. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null"
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`
}

function writeInputHash(operation: WriteOperation, input: unknown): string {
  return createHash("sha256")
    .update(`${operation}\u0000${canonicalJson(input)}`)
    .digest("hex")
}

/** How many expired proposals one opportunistic prune may remove. */
const EXPIRED_PROPOSAL_PRUNE_BATCH = 50

/**
 * Deletes one bounded batch of expired proposals.
 *
 * Expired rows are dead weight the moment their TTL passes: they can no longer
 * be consumed, and nothing reads them but the failure path. They are pruned
 * here, when a new proposal is issued, so no scheduler is needed. Best effort
 * by design: pruning is housekeeping, so a failure must never stop the
 * assistant from proposing a write, and the batch keeps the statement cheap on
 * the chat path even after a long idle period.
 */
async function pruneExpiredWriteProposals(db: AppDb): Promise<void> {
  try {
    await db.delete(aiWriteProposals).where(
      inArray(
        aiWriteProposals.id,
        db
          .select({ id: aiWriteProposals.id })
          .from(aiWriteProposals)
          .where(lt(aiWriteProposals.expiresAt, new Date()))
          .limit(EXPIRED_PROPOSAL_PRUNE_BATCH),
      ),
    )
  } catch {
    // Unreachable in the normal case; a stale proposal row is not an error.
  }
}

/**
 * Issues the server-side half of an approval. The token is bound to the
 * session that requested it, the operation, and a hash of the exact input the
 * assistant proposed; the client can only echo the opaque id back.
 */
export async function issueWriteProposalToken(
  ctx: AiToolContext,
  proposal: WriteProposal,
): Promise<string> {
  await pruneExpiredWriteProposals(ctx.db)
  const token = `awp_${nanoid(24)}`
  await ctx.db.insert(aiWriteProposals).values({
    id: token,
    orgId: ctx.session.orgId,
    userId: ctx.session.userId,
    operation: proposal.operation,
    inputHash: writeInputHash(proposal.operation, proposal.input),
    input: proposal.input,
    expiresAt: new Date(Date.now() + WRITE_PROPOSAL_TTL_MS),
  })
  return token
}

export interface ApprovedWrite {
  operation: WriteOperation
  input: Record<string, JsonValue>
}

/**
 * Consumes a proposal token exactly once.
 *
 * The `UPDATE … RETURNING` filters on every binding at once, so a token cannot
 * be reused (replay), cannot be swapped to another operation or input, cannot
 * cross organisations or users, and cannot outlive its TTL. The stored input is
 * returned so execution never trusts the client's copy.
 */
export async function consumeWriteProposalToken(
  ctx: AiToolContext,
  token: string,
  operation: WriteOperation,
  input: unknown,
): Promise<ApprovedWrite> {
  const now = new Date()
  const [consumed] = await ctx.db
    .update(aiWriteProposals)
    .set({ consumedAt: now })
    .where(
      and(
        eq(aiWriteProposals.id, token),
        eq(aiWriteProposals.orgId, ctx.session.orgId),
        eq(aiWriteProposals.userId, ctx.session.userId),
        eq(aiWriteProposals.operation, operation),
        eq(aiWriteProposals.inputHash, writeInputHash(operation, input)),
        isNull(aiWriteProposals.consumedAt),
        gt(aiWriteProposals.expiresAt, now),
      ),
    )
    .returning({ input: aiWriteProposals.input })

  if (consumed) {
    // Written from `WriteProposal.input`, which is JSON by construction.
    const stored = consumed.input as Record<string, JsonValue>
    return { operation, input: stored }
  }

  const [existing] = await ctx.db
    .select({
      consumedAt: aiWriteProposals.consumedAt,
      expiresAt: aiWriteProposals.expiresAt,
    })
    .from(aiWriteProposals)
    .where(
      and(
        eq(aiWriteProposals.id, token),
        eq(aiWriteProposals.orgId, ctx.session.orgId),
        eq(aiWriteProposals.userId, ctx.session.userId),
      ),
    )
    .limit(1)

  if (!existing) {
    throw new HttpStatusError(
      "PROPOSAL_INVALID",
      "This change was not approved by the assistant. Ask it to prepare the change again.",
      403,
    )
  }
  if (existing.consumedAt) {
    throw new HttpStatusError(
      "PROPOSAL_ALREADY_USED",
      "This approval has already been applied. Ask the assistant to prepare the change again.",
      409,
    )
  }
  if (existing.expiresAt.getTime() <= now.getTime()) {
    throw new HttpStatusError(
      "PROPOSAL_EXPIRED",
      "This approval expired before it was applied. Ask the assistant to prepare the change again.",
      409,
    )
  }
  throw new HttpStatusError(
    "PROPOSAL_INVALID",
    "This approval does not match the change being applied. Ask the assistant to prepare the change again.",
    403,
  )
}

/* ---- create_table -------------------------------------------------------- */

interface PlannedField {
  config: FieldConfig
  id: string
  isPrimary: boolean
  name: string
  rank: string
  requestedPrimary: boolean
  type: FieldType
  width: number
}

interface PlannedView {
  configuration: Record<string, unknown>
  name: string
  type: ViewType
}

function planTableFields(
  inputFields: Array<z.infer<typeof createTableInputSchema>["fields"][number]>,
): PlannedField[] {
  const seen = new Set<string>()
  const planned = inputFields.map((input) => {
    const name = input.name.trim()
    if (!name) {
      throw new AppError("VALIDATION_ERROR", "Every column needs a name.")
    }
    const key = name.toLowerCase()
    if (seen.has(key)) {
      throw new AppError(
        "VALIDATION_ERROR",
        `The column name "${name}" is used more than once.`,
      )
    }
    seen.add(key)

    const type = input.type as FieldType
    if (!FIELD_TYPES.includes(type)) {
      throw new AppError("VALIDATION_ERROR", `"${name}" has an unsupported column type.`)
    }

    const rawConfig = { ...(input.config ?? {}) } as FieldConfig
    const options = normalizeOptions(type, rawConfig.options, name)
    const config = validateFieldConfiguration(type, {
      ...rawConfig,
      ...(options ? { options } : {}),
    })

    return {
      config,
      id: `fld_${nanoid(10)}`,
      isPrimary: false,
      name,
      rank: "",
      requestedPrimary: input.primary === true,
      type,
      width:
        type === "singleLineText" || type === "longText"
          ? 240
          : type === "currency" || type === "number"
            ? 150
            : 160,
    } satisfies PlannedField
  })

  const requestedPrimary = planned.findIndex((field) => field.requestedPrimary)
  const fallbackPrimary = planned.findIndex(
    (field) => field.type === "singleLineText",
  )
  const primaryIndex =
    requestedPrimary >= 0 ? requestedPrimary : fallbackPrimary >= 0 ? fallbackPrimary : 0

  const ranks = generateNKeysBetween(null, null, planned.length)
  return planned.map((field, index) => ({
    ...field,
    isPrimary: index === primaryIndex,
    rank: ranks[index],
    width: index === primaryIndex ? 240 : field.width,
  }))
}

function planTableViews(
  tableName: string,
  plannedFields: ReadonlyArray<Pick<PlannedField, "config" | "id" | "name" | "type">>,
): PlannedView[] {
  const planned: PlannedView[] = [
    {
      name: `All ${tableName}`.slice(0, 240),
      type: "grid",
      configuration: { rowHeight: "medium" },
    },
  ]

  const selectField = plannedFields.find(
    (field) => field.type === "singleSelect",
  )
  const dateFields = plannedFields.filter((field) => field.type === "date")
  const numericField =
    plannedFields.find((field) => field.type === "currency") ??
    plannedFields.find((field) => field.type === "number")
  const summaryFieldIds = plannedFields
    .filter((field) => field.type === "currency" || field.type === "date")
    .map((field) => field.id)
    .slice(0, 2)

  if (selectField) {
    planned.push({
      name: `${selectField.name} board`.slice(0, 240),
      type: "kanban",
      configuration: {
        kanbanFieldId: selectField.id,
        ...(summaryFieldIds.length > 0
          ? { kanbanSummaryFieldIds: summaryFieldIds }
          : {}),
      },
    })
  }

  if (dateFields.length >= 2) {
    planned.push({
      name: "Timeline",
      type: "timeline",
      configuration: {
        timelineStartFieldId: dateFields[0].id,
        timelineEndFieldId: dateFields[1].id,
        ...(selectField ? { timelineGroupFieldId: selectField.id } : {}),
        timelineScale: "week",
      },
    })
  } else if (dateFields.length === 1) {
    planned.push({
      name: "Calendar",
      type: "calendar",
      configuration: {
        calendarDateFieldId: dateFields[0].id,
        calendarDisplay: "month",
      },
    })
  }

  if (selectField || numericField) {
    const widgets: Array<Record<string, unknown>> = [
      {
        id: "w_total",
        kind: "metric",
        title: "Total records",
        aggregate: "count",
        rank: "a0",
      },
    ]
    if (numericField) {
      widgets.push({
        id: "w_total_value",
        kind: "metric",
        title: `Total ${numericField.name}`.slice(0, 240),
        fieldId: numericField.id,
        aggregate: "sum",
        rank: "a1",
      })
    }
    if (selectField) {
      widgets.push({
        id: "w_by_select",
        kind: "chart",
        title: `${tableName} by ${selectField.name}`.slice(0, 240),
        groupByFieldId: selectField.id,
        aggregate: "count",
        chartType: "bar",
        rank: "a2",
      })
    }
    planned.push({
      name: "Dashboard",
      type: "dashboard",
      configuration: { dashboardWidgets: widgets },
    })
  }

  return planned
}

async function proposeCreateTable(
  ctx: AiToolContext,
  input: z.infer<typeof createTableInputSchema>,
): Promise<WriteProposal> {
  const base = await requireBase(ctx, input.baseId)
  const plannedFields = planTableFields(input.fields)
  const plannedViews = planTableViews(input.name, plannedFields)
  const sampleRows = input.sampleRows ?? []
  const warnings: string[] = []

  const knownNames = new Set(
    plannedFields.map((field) => field.name.toLowerCase()),
  )
  for (const row of sampleRows) {
    for (const key of Object.keys(row)) {
      const normalized = key.toLowerCase()
      if (
        !knownNames.has(normalized) &&
        !plannedFields.some((field) => field.id === key)
      ) {
        warnings.push(`"${key}" is not one of the new columns, so it will be skipped.`)
      }
    }
  }

  const primary = plannedFields.find((field) => field.isPrimary)
  const choiceFields = plannedFields.filter((field) =>
    CHOICE_FIELD_TYPES.has(field.type),
  )

  return {
    operation: "create_table",
    title: `Create table "${input.name}"`,
    summary: `Adds a new table with ${plannedFields.length} ${plannedFields.length === 1 ? "column" : "columns"} and ${sampleRows.length} sample ${sampleRows.length === 1 ? "row" : "rows"} to ${base.name}.`,
    requiresApproval: true,
    diff: [
      { label: "Base", after: base.name },
      { label: "Table", after: input.name },
      {
        label: "Columns",
        after: plannedFields
          .map((field) => `${field.name} (${getFieldTypeLabel(field.type)})`)
          .join(", ")
          .slice(0, 500),
      },
      { label: "First column", after: primary?.name ?? plannedFields[0].name },
      ...(choiceFields.length > 0
        ? [
            {
              label: "Choices",
              after: choiceFields
                .map(
                  (field) =>
                    `${field.name}: ${(field.config.options ?? [])
                      .map((option) => option.label)
                      .join(", ")}`,
                )
                .join(" · ")
                .slice(0, 500),
            },
          ]
        : []),
      { label: "Sample rows", after: `${sampleRows.length}` },
      { label: "Views", after: plannedViews.map((view) => view.name).join(", ") },
    ],
    input: input as unknown as Record<string, JsonValue>,
    warnings: [...new Set(warnings)].slice(0, 6),
  }
}

async function executeCreateTable(
  ctx: AiToolContext,
  input: z.infer<typeof createTableInputSchema>,
): Promise<WriteExecution> {
  const { db, session } = ctx
  const orgId = session.orgId
  const base = await requireBase(ctx, input.baseId)
  const plannedFields = planTableFields(input.fields)

  const tableId = `tbl_${nanoid(10)}`
  const tableRank = await nextTableRank(ctx, base.id)
  const plannedViews = planTableViews(input.name, plannedFields)
  const viewIds = plannedViews.map(() => `viw_${nanoid(10)}`)
  const fieldDefinitions = plannedFields.map(toPlannedFieldDefinition)

  // Validate every sample row before opening the transaction: a bad cell must
  // leave no table, no columns, no sequences, and no views behind.
  const recordsToInsert = buildTableRecords({
    ctx,
    fieldDefinitions,
    rows: input.sampleRows ?? [],
    tableId,
  })

  await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as AppDb
    await tx.insert(tables).values({
      id: tableId,
      orgId,
      baseId: base.id,
      name: input.name,
      description: input.description,
      rank: tableRank,
      status: "active",
    })

    await tx.insert(fields).values(
      plannedFields.map((field) => ({
        id: field.id,
        orgId,
        tableId,
        name: field.name,
        type: field.type,
        config: field.config as unknown as Record<string, unknown>,
        rank: field.rank,
        width: field.width,
        isPrimary: field.isPrimary,
        frozen: field.isPrimary,
        status: "active",
      })),
    )

    const autoNumberFields = plannedFields.filter(
      (field) => field.type === "autoNumber",
    )
    if (autoNumberFields.length > 0) {
      await tx.insert(fieldSequences).values(
        autoNumberFields.map((field) => ({
          fieldId: field.id,
          tableId,
          nextValue: (input.sampleRows?.length ?? 0) + 1,
        })),
      )
    }

    await tx.insert(views).values(
      plannedViews.map((view, index) => ({
        id: viewIds[index],
        orgId,
        tableId,
        name: view.name,
        type: view.type,
        isDefault: view.type === "grid",
        rank: `a${index}`,
        configuration: view.configuration,
        status: "active",
      })),
    )

    if (recordsToInsert.length > 0) {
      await tx.insert(records).values(recordsToInsert)
    }
  })

  const output: z.infer<typeof createTableOutputSchema> = {
    tableId,
    name: input.name,
    fieldCount: plannedFields.length,
    recordCount: recordsToInsert.length,
    viewIds,
    href: `/bases/${base.id}/tables/${tableId}`,
  }

  return {
    operation: "create_table",
    summary: `Created "${input.name}" with ${plannedFields.length} ${plannedFields.length === 1 ? "column" : "columns"} and ${recordsToInsert.length} sample ${recordsToInsert.length === 1 ? "row" : "rows"}.`,
    entityIds: { baseId: base.id, tableId },
    result: output,
  }
}

function toPlannedFieldDefinition(field: PlannedField): FieldDefinition {
  return {
    id: field.id,
    name: field.name,
    type: field.type,
    config: field.config,
    rank: field.rank,
    width: field.width,
    isPrimary: field.isPrimary,
  }
}

function buildTableRecords(params: {
  ctx: AiToolContext
  fieldDefinitions: readonly FieldDefinition[]
  rows: ReadonlyArray<Record<string, JsonValue>>
  tableId: string
}) {
  const { ctx, fieldDefinitions, rows, tableId } = params
  const byId = new Map(fieldDefinitions.map((field) => [field.id, field]))
  const byName = new Map(
    fieldDefinitions.map((field) => [field.name.toLowerCase(), field]),
  )
  const autoNumberFields = fieldDefinitions.filter(
    (field) => field.type === "autoNumber",
  )
  const ranks = generateNKeysBetween(null, null, Math.max(rows.length, 0))

  return rows.map((row, index) => {
    const values: Record<string, CellValue> = {}
    for (const [key, raw] of Object.entries(row)) {
      const field = byId.get(key) ?? byName.get(key.toLowerCase())
      if (!field) continue
      if (field.type === "autoNumber") continue
      if (field.type === "createdTime" || field.type === "createdBy") continue
      const resolved = resolveCellInput(field, raw)
      if (resolved === undefined) continue
      values[field.id] = validateCellValue(field, resolved)
    }

    for (const field of autoNumberFields) {
      values[field.id] = index + 1
    }
    const now = new Date()
    for (const field of fieldDefinitions) {
      if (field.type === "createdTime") values[field.id] = now.getTime()
      if (field.type === "createdBy") values[field.id] = ctx.session.userId
    }

    return {
      id: `rec_${nanoid(10)}`,
      orgId: ctx.session.orgId,
      tableId,
      rank: ranks[index],
      values,
      searchText: buildRecordSearchText(values, fieldDefinitions),
      revision: 1,
      status: "active",
      createdBy: ctx.session.userId,
      updatedBy: ctx.session.userId,
    }
  })
}

/* ---- create_field -------------------------------------------------------- */

function planSingleField(params: {
  fields: readonly FieldDefinition[]
  name: string
  type: FieldType
  config: Record<string, JsonValue>
  insertAfterFieldId?: string
}): FieldDefinition & { config: FieldConfig } {
  const name = params.name.trim()
  if (
    params.fields.some(
      (field) => field.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      `A column named "${name}" already exists.`,
    )
  }
  const type = params.type
  if (!FIELD_TYPES.includes(type)) {
    throw new AppError("VALIDATION_ERROR", "That column type is not supported.")
  }
  const options = normalizeOptions(
    type,
    (params.config as unknown as FieldConfig).options,
    name,
  )
  const config = validateFieldConfiguration(type, {
    ...((params.config as unknown as FieldConfig) ?? {}),
    ...(options ? { options } : {}),
  })

  const anchor = params.insertAfterFieldId
    ? params.fields.find((field) => field.id === params.insertAfterFieldId)
    : undefined
  if (params.insertAfterFieldId && !anchor) {
    throw new AppError("NOT_FOUND", "That column is no longer available.")
  }
  const anchorIndex = anchor
    ? params.fields.findIndex((field) => field.id === anchor.id)
    : params.fields.length - 1
  const next = params.fields[anchorIndex + 1]
  const rank = generateKeyBetween(anchor?.rank ?? null, next?.rank ?? null)

  return {
    id: `fld_${nanoid(10)}`,
    name,
    type,
    config,
    rank,
    width: 160,
    isPrimary: params.fields.length === 0,
  }
}

async function proposeCreateField(
  ctx: AiToolContext,
  input: z.infer<typeof createFieldInputSchema>,
): Promise<WriteProposal> {
  const base = await requireBase(ctx, input.baseId)
  const table = await requireTable(ctx, base.id, input.tableId)
  const definitions = (await loadFieldRows(ctx, table.id)).map(toFieldDefinition)
  const field = planSingleField({
    fields: definitions,
    name: input.field.name,
    type: input.field.type as FieldType,
    config: (input.field.config ?? {}) as Record<string, JsonValue>,
    insertAfterFieldId: input.insertAfterFieldId,
  })

  return {
    operation: "create_field",
    title: `Add column "${field.name}"`,
    summary: `Adds a ${getFieldTypeLabel(field.type)} column to ${table.name}.`,
    requiresApproval: true,
    diff: [
      { label: "Table", after: table.name },
      { label: "Before", after: `${definitions.length} columns` },
      { label: "After", after: `${definitions.length + 1} columns` },
      { label: "New column", after: `${field.name} (${getFieldTypeLabel(field.type)})` },
      ...(field.config.options?.length
        ? [
            {
              label: "Choices",
              after: field.config.options
                .map((option) => option.label)
                .join(", ")
                .slice(0, 500),
            },
          ]
        : []),
    ],
    input: input as unknown as Record<string, JsonValue>,
    warnings: [],
  }
}

async function executeCreateField(
  ctx: AiToolContext,
  input: z.infer<typeof createFieldInputSchema>,
): Promise<WriteExecution> {
  const base = await requireBase(ctx, input.baseId)
  const table = await requireTable(ctx, base.id, input.tableId)
  const definitions = (await loadFieldRows(ctx, table.id)).map(toFieldDefinition)
  const field = planSingleField({
    fields: definitions,
    name: input.field.name,
    type: input.field.type as FieldType,
    config: (input.field.config ?? {}) as Record<string, JsonValue>,
    insertAfterFieldId: input.insertAfterFieldId,
  })

  await ctx.db.insert(fields).values({
    id: field.id,
    orgId: ctx.session.orgId,
    tableId: table.id,
    name: field.name,
    type: field.type,
    config: field.config as unknown as Record<string, unknown>,
    rank: field.rank,
    width: field.width,
    isPrimary: field.isPrimary,
    status: "active",
  })

  if (field.type === "autoNumber") {
    await ctx.db.insert(fieldSequences).values({
      fieldId: field.id,
      tableId: table.id,
      nextValue: 1,
    })
  }

  return {
    operation: "create_field",
    summary: `Added the ${field.name} column to ${table.name}.`,
    entityIds: { baseId: base.id, tableId: table.id, fieldId: field.id },
    result: {
      fieldId: field.id,
      name: field.name,
      type: field.type,
    },
  }
}

/* ---- create_record ------------------------------------------------------- */

function resolveRecordValues(params: {
  fields: readonly FieldDefinition[]
  values: ReadonlyArray<{ fieldId: string; fieldName: string; value: JsonValue }>
}): Record<string, CellValue> {
  const byId = new Map(params.fields.map((field) => [field.id, field]))
  const values: Record<string, CellValue> = {}

  for (const entry of params.values) {
    const field = byId.get(entry.fieldId)
    if (!field) {
      throw new AppError("NOT_FOUND", `"${entry.fieldName}" is no longer a column in this table.`)
    }
    if (field.type === "autoNumber") {
      throw new AppError("VALIDATION_ERROR", `${field.name} is assigned automatically.`)
    }
    if (field.type === "createdTime" || field.type === "createdBy") {
      throw new AppError("VALIDATION_ERROR", `${field.name} is filled in automatically.`)
    }
    const resolved = resolveCellInput(field, entry.value)
    if (resolved === undefined) {
      throw new AppError("VALIDATION_ERROR", `${field.name} is not one of the available choices.`)
    }
    values[field.id] = validateCellValue(field, resolved)
  }

  return validateRecordValues(values, params.fields)
}

async function proposeCreateRecord(
  ctx: AiToolContext,
  input: z.infer<typeof createRecordInputSchema>,
): Promise<WriteProposal> {
  const base = await requireBase(ctx, input.baseId)
  const table = await requireTable(ctx, base.id, input.tableId)
  const definitions = (await loadFieldRows(ctx, table.id)).map(toFieldDefinition)
  const values = resolveRecordValues({ fields: definitions, values: input.values })

  return {
    operation: "create_record",
    title: "Add a record",
    summary: `Adds one record to ${table.name}.`,
    requiresApproval: true,
    diff: [
      { label: "Table", after: table.name },
      { label: "Before", after: "No new record" },
      { label: "After", after: "1 new record" },
      ...describeRecordValues(definitions, values),
    ],
    input: input as unknown as Record<string, JsonValue>,
    warnings: [],
  }
}

async function executeCreateRecord(
  ctx: AiToolContext,
  input: z.infer<typeof createRecordInputSchema>,
): Promise<WriteExecution> {
  const base = await requireBase(ctx, input.baseId)
  const table = await requireTable(ctx, base.id, input.tableId)
  const definitions = (await loadFieldRows(ctx, table.id)).map(toFieldDefinition)
  const values = resolveRecordValues({ fields: definitions, values: input.values })
  const autoNumberFields = definitions.filter((field) => field.type === "autoNumber")

  const recordId = await ctx.db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as AppDb

    if (autoNumberFields.length > 0) {
      // One atomic `next_value + 1` per field; a read-then-write lost numbers
      // when two records were created at the same time.
      const allocated = await allocateSequenceValues(
        tx,
        table.id,
        autoNumberFields.map((field) => field.id),
        1,
      )
      for (const field of autoNumberFields) {
        values[field.id] = allocated[field.id]
      }
    }

    const now = new Date()
    for (const field of definitions) {
      if (field.type === "createdTime") values[field.id] = now.getTime()
      if (field.type === "createdBy") values[field.id] = ctx.session.userId
    }

    const id = `rec_${nanoid(10)}`
    await tx.insert(records).values({
      id,
      orgId: ctx.session.orgId,
      tableId: table.id,
      rank: await nextRecordRank(ctx, table.id, tx),
      values,
      searchText: buildRecordSearchText(values, definitions),
      revision: 1,
      status: "active",
      createdBy: ctx.session.userId,
      updatedBy: ctx.session.userId,
    })
    return id
  })

  return {
    operation: "create_record",
    summary: `Added a record to ${table.name}.`,
    entityIds: { baseId: base.id, tableId: table.id, recordId },
    result: { recordId },
  }
}

/* ---- update_record ------------------------------------------------------- */

async function requireRecord(
  ctx: AiToolContext,
  tableId: string,
  recordId: string,
) {
  const [row] = await ctx.db
    .select()
    .from(records)
    .where(
      and(
        eq(records.orgId, ctx.session.orgId),
        eq(records.tableId, tableId),
        eq(records.id, recordId),
        eq(records.status, "active"),
      ),
    )
    .limit(1)
  if (!row) {
    throw new AppError("NOT_FOUND", "That record is no longer available.")
  }
  return row
}

async function proposeUpdateRecord(
  ctx: AiToolContext,
  input: z.infer<typeof updateRecordInputSchema>,
): Promise<WriteProposal> {
  const base = await requireBase(ctx, input.baseId)
  const table = await requireTable(ctx, base.id, input.tableId)
  const row = await requireRecord(ctx, table.id, input.recordId)
  const definitions = (await loadFieldRows(ctx, table.id)).map(toFieldDefinition)
  const diff = buildChangeDiff(definitions, input.changes)

  return {
    operation: "update_record",
    title: "Update a record",
    summary: `Updates ${diff.length} ${diff.length === 1 ? "value" : "values"} in ${table.name}.`,
    requiresApproval: true,
    diff: [{ label: "Table", after: table.name }, ...diff],
    input: input as unknown as Record<string, JsonValue>,
    warnings:
      row.revision === input.expectedVersion
        ? []
        : ["This record changed since it was read. The update may need to be retried."],
  }
}

async function executeUpdateRecord(
  ctx: AiToolContext,
  input: z.infer<typeof updateRecordInputSchema>,
): Promise<WriteExecution> {
  const base = await requireBase(ctx, input.baseId)
  const table = await requireTable(ctx, base.id, input.tableId)
  const row = await requireRecord(ctx, table.id, input.recordId)
  const definitions = (await loadFieldRows(ctx, table.id)).map(toFieldDefinition)

  if (row.revision !== input.expectedVersion) {
    throw new AppError(
      "REVISION_CONFLICT",
      "This record changed while you were reviewing it. Refresh and try again.",
    )
  }

  const byId = new Map(definitions.map((field) => [field.id, field]))
  const values: Record<string, unknown> = { ...(row.values as Record<string, unknown>) }
  for (const change of input.changes) {
    const field = byId.get(change.fieldId)
    if (!field) {
      throw new AppError("NOT_FOUND", `"${change.fieldName}" is no longer a column in this table.`)
    }
    if (field.type === "autoNumber" || field.type === "createdTime" || field.type === "createdBy") {
      throw new AppError("VALIDATION_ERROR", `${field.name} is read-only.`)
    }
    const resolved = resolveCellInput(field, change.after)
    if (resolved === undefined) {
      throw new AppError("VALIDATION_ERROR", `${field.name} is not one of the available choices.`)
    }
    values[field.id] = validateCellValue(field, resolved)
  }

  // UTF-8 bytes, matching `lib/cell-validation.ts`; `.length` counted UTF-16
  // code units and let multi-byte payloads through.
  const serializedSize = new TextEncoder().encode(JSON.stringify(values)).length
  if (serializedSize > MAX_RECORD_VALUE_BYTES) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Record payload exceeds the ${MAX_RECORD_VALUE_BYTES.toLocaleString()} byte limit.`,
    )
  }

  const validated = values as Record<string, CellValue>
  const updated = await ctx.db
    .update(records)
    .set({
      values: validated,
      searchText: buildRecordSearchText(validated, definitions),
      revision: row.revision + 1,
      updatedAt: new Date(),
      updatedBy: ctx.session.userId,
    })
    .where(
      and(
        eq(records.orgId, ctx.session.orgId),
        eq(records.id, row.id),
        eq(records.revision, input.expectedVersion),
      ),
    )
    .returning({ id: records.id })

  if (updated.length === 0) {
    throw new AppError(
      "REVISION_CONFLICT",
      "This record changed while you were reviewing it. Refresh and try again.",
    )
  }

  return {
    operation: "update_record",
    summary: `Updated a record in ${table.name}.`,
    entityIds: { baseId: base.id, tableId: table.id, recordId: row.id },
    result: { recordId: row.id, revision: row.revision + 1 },
  }
}

/* ---- delete_record ------------------------------------------------------- */

async function proposeDeleteRecord(
  ctx: AiToolContext,
  input: z.infer<typeof deleteRecordInputSchema>,
): Promise<WriteProposal> {
  const base = await requireBase(ctx, input.baseId)
  const table = await requireTable(ctx, base.id, input.tableId)
  const row = await requireRecord(ctx, table.id, input.recordId)

  return {
    operation: "delete_record",
    title: "Delete a record",
    summary: `Removes one record from ${table.name}.`,
    requiresApproval: true,
    diff: [
      { label: "Table", after: table.name },
      { label: "Before", after: recordSummary(row.values) },
      { label: "After", after: "Record removed" },
      { label: "What will be removed", after: input.deletionSummary.join(" ") },
    ],
    input: input as unknown as Record<string, JsonValue>,
    warnings:
      row.revision === input.expectedVersion
        ? []
        : ["This record changed since it was read. The deletion may need to be retried."],
  }
}

async function executeDeleteRecord(
  ctx: AiToolContext,
  input: z.infer<typeof deleteRecordInputSchema>,
): Promise<WriteExecution> {
  const base = await requireBase(ctx, input.baseId)
  const table = await requireTable(ctx, base.id, input.tableId)
  const row = await requireRecord(ctx, table.id, input.recordId)

  if (row.revision !== input.expectedVersion) {
    throw new AppError(
      "REVISION_CONFLICT",
      "This record changed while you were reviewing it. Refresh and try again.",
    )
  }

  const deleted = await ctx.db
    .update(records)
    .set({
      status: "archived",
      revision: row.revision + 1,
      updatedAt: new Date(),
      updatedBy: ctx.session.userId,
    })
    .where(
      and(
        eq(records.orgId, ctx.session.orgId),
        eq(records.id, row.id),
        eq(records.revision, input.expectedVersion),
      ),
    )
    .returning({ id: records.id })

  if (deleted.length === 0) {
    throw new AppError(
      "REVISION_CONFLICT",
      "This record changed while you were reviewing it. Refresh and try again.",
    )
  }

  return {
    operation: "delete_record",
    summary: `Removed a record from ${table.name}.`,
    entityIds: { baseId: base.id, tableId: table.id, recordId: row.id },
    result: { recordId: row.id },
  }
}

/* ---- delete_field -------------------------------------------------------- */

async function proposeDeleteField(
  ctx: AiToolContext,
  input: z.infer<typeof deleteFieldInputSchema>,
): Promise<WriteProposal> {
  const base = await requireBase(ctx, input.baseId)
  const table = await requireTable(ctx, base.id, input.tableId)
  const definitions = (await loadFieldRows(ctx, table.id)).map(toFieldDefinition)
  const field = definitions.find((candidate) => candidate.id === input.fieldId)
  if (!field) {
    throw new AppError("NOT_FOUND", "That column is no longer available.")
  }
  if (field.name !== input.expectedName || field.type !== input.expectedType) {
    throw new AppError(
      "REVISION_CONFLICT",
      "This column changed while you were reviewing it. Refresh and try again.",
    )
  }
  if (field.isPrimary) {
    throw new AppError("VALIDATION_ERROR", "The primary field cannot be deleted.")
  }

  return {
    operation: "delete_field",
    title: `Delete column "${field.name}"`,
    summary: `Removes the ${field.name} column from ${table.name}.`,
    requiresApproval: true,
    diff: [
      { label: "Table", after: table.name },
      { label: "Before", after: `${field.name} (${getFieldTypeLabel(field.type)})` },
      { label: "After", after: "Column removed" },
      { label: "Impact", after: input.dataLossSummary },
    ],
    input: input as unknown as Record<string, JsonValue>,
    warnings: ["Saved values in this column will no longer be shown."],
  }
}

async function executeDeleteField(
  ctx: AiToolContext,
  input: z.infer<typeof deleteFieldInputSchema>,
): Promise<WriteExecution> {
  const base = await requireBase(ctx, input.baseId)
  const table = await requireTable(ctx, base.id, input.tableId)
  const definitions = (await loadFieldRows(ctx, table.id)).map(toFieldDefinition)
  const field = definitions.find((candidate) => candidate.id === input.fieldId)
  if (!field) {
    throw new AppError("NOT_FOUND", "That column is no longer available.")
  }
  if (field.name !== input.expectedName || field.type !== input.expectedType) {
    throw new AppError(
      "REVISION_CONFLICT",
      "This column changed while you were reviewing it. Refresh and try again.",
    )
  }
  if (field.isPrimary) {
    throw new AppError("VALIDATION_ERROR", "The primary field cannot be deleted.")
  }

  await ctx.db
    .update(fields)
    .set({ status: "archived", updatedAt: new Date() })
    .where(
      and(eq(fields.orgId, ctx.session.orgId), eq(fields.id, field.id)),
    )
  // Archived columns must also disappear from search text, exactly like the
  // workspace delete path in `services/fields.ts`.
  await rebuildTableSearchText(ctx.db, ctx.session.orgId, table.id)

  return {
    operation: "delete_field",
    summary: `Removed the ${field.name} column from ${table.name}.`,
    entityIds: { baseId: base.id, tableId: table.id, fieldId: field.id },
    result: { fieldId: field.id },
  }
}

/* ---- create_form --------------------------------------------------------- */

async function proposeCreateForm(
  ctx: AiToolContext,
  input: z.infer<typeof createFormInputSchema>,
): Promise<WriteProposal> {
  const base = await requireBase(ctx, input.baseId)
  const table = await requireTable(ctx, base.id, input.tableId)
  const definitions = (await loadFieldRows(ctx, table.id)).map(toFieldDefinition)
  assertFormFields(definitions, input.fields)

  return {
    operation: "create_form",
    title: `Create form "${input.title}"`,
    summary: `Creates a draft form with ${input.fields.length} ${input.fields.length === 1 ? "question" : "questions"} for ${table.name}.`,
    requiresApproval: true,
    diff: [
      { label: "Base", after: base.name },
      { label: "Table", after: table.name },
      { label: "Form", after: input.title },
      {
        label: "Questions",
        after: input.fields
          .map((field) => field.label || field.fieldName)
          .join(", ")
          .slice(0, 500),
      },
      { label: "Status", after: "Draft — publish when you are ready" },
    ],
    input: input as unknown as Record<string, JsonValue>,
    warnings: [],
  }
}

async function executeCreateForm(
  ctx: AiToolContext,
  input: z.infer<typeof createFormInputSchema>,
): Promise<WriteExecution> {
  const { db, session } = ctx
  const base = await requireBase(ctx, input.baseId)
  const table = await requireTable(ctx, base.id, input.tableId)
  const definitions = (await loadFieldRows(ctx, table.id)).map(toFieldDefinition)
  const fieldById = assertFormFields(definitions, input.fields)

  const formId = `frm_${nanoid(10)}`
  const slug = `${slugify(input.title)}-${nanoid(6).toLowerCase()}`

  await db.insert(forms).values({
    id: formId,
    orgId: session.orgId,
    baseId: base.id,
    tableId: table.id,
    name: input.title,
    description: input.description,
    slug,
    status: "draft",
    settings: {
      allowMultipleSubmissions: true,
      submitButtonLabel: input.appearance.submitButtonLabel,
    },
    theme: { accentColor: input.appearance.accentColor },
    thankYou: {
      title: "Thanks for your response",
      message: input.appearance.successMessage,
    },
    createdBy: session.userId,
  })

  const ranks = generateNKeysBetween(null, null, input.fields.length)
  await db.insert(formDraftFields).values(
    input.fields.map((field, index) => ({
      id: `fdf_${nanoid(10)}`,
      orgId: session.orgId,
      formId,
      targetFieldId: field.fieldId,
      label: field.label || fieldById.get(field.fieldId)?.name || "Question",
      helpText: field.description,
      placeholder: "",
      required: field.required,
      hidden: false,
      rank: ranks[index],
      mode: "visible",
    })),
  )

  return {
    operation: "create_form",
    summary: `Created the draft form "${input.title}".`,
    entityIds: { baseId: base.id, tableId: table.id, formId },
    result: {
      formId,
      slug,
      href: `/bases/${base.id}/forms/${formId}`,
    },
  }
}

function assertFormFields(
  definitions: readonly FieldDefinition[],
  inputFields: ReadonlyArray<{ fieldId: string; fieldName: string; label: string }>,
): Map<string, FieldDefinition> {
  const byId = new Map(definitions.map((field) => [field.id, field]))
  for (const field of inputFields) {
    const definition = byId.get(field.fieldId)
    if (!definition) {
      throw new AppError(
        "NOT_FOUND",
        `"${field.fieldName}" is no longer a column in this table.`,
      )
    }
    if (
      definition.type === "autoNumber" ||
      definition.type === "createdTime" ||
      definition.type === "createdBy"
    ) {
      throw new AppError(
        "VALIDATION_ERROR",
        `${definition.name} is filled in automatically and cannot be a question.`,
      )
    }
  }
  return byId
}

/* ---- update_form_settings ------------------------------------------------ */

function formSettingSnapshot(
  form: { description: string; name: string; status: string; settings: unknown; theme: unknown; thankYou: unknown },
  latestVersion: number,
): Record<string, JsonValue> {
  const settings = form.settings as Record<string, unknown>
  const theme = form.theme as Record<string, unknown>
  const thankYou = form.thankYou as Record<string, unknown>
  return {
    title: form.name,
    description: form.description,
    submitButtonLabel: stringSetting(settings.submitButtonLabel) ?? "Submit",
    successMessage:
      stringSetting(thankYou.message) ?? stringSetting(thankYou.title) ?? "",
    accentColor: stringSetting(theme.accentColor) ?? "#2563eb",
    isOpen: form.status === "published",
    allowMultipleSubmissions: settings.allowMultipleSubmissions === true,
    version: latestVersion,
  }
}

async function proposeUpdateFormSettings(
  ctx: AiToolContext,
  input: z.infer<typeof updateFormSettingsInputSchema>,
): Promise<WriteProposal> {
  const base = await requireBase(ctx, input.baseId)
  const form = await requireForm(ctx, base.id, input.formId)
  const latest = await latestFormVersion(ctx, form.id)
  const current = formSettingSnapshot(form, latest?.versionNumber ?? 0)

  if ((latest?.versionNumber ?? 0) !== input.expectedVersion) {
    throw new AppError(
      "REVISION_CONFLICT",
      "This form changed while you were reviewing it. Refresh and try again.",
    )
  }

  return {
    operation: "update_form_settings",
    title: `Update "${form.name}"`,
    summary: `Updates ${input.changes.length} ${input.changes.length === 1 ? "setting" : "settings"} on this form.`,
    requiresApproval: true,
    diff: input.changes.map((change) => ({
      label: FORM_PROPERTY_LABELS[change.property] ?? "Setting",
      before: describeSettingValue(current[change.property]),
      after: describeSettingValue(change.after),
    })),
    input: input as unknown as Record<string, JsonValue>,
    warnings: [],
  }
}

async function executeUpdateFormSettings(
  ctx: AiToolContext,
  input: z.infer<typeof updateFormSettingsInputSchema>,
): Promise<WriteExecution> {
  const base = await requireBase(ctx, input.baseId)
  const form = await requireForm(ctx, base.id, input.formId)
  const latest = await latestFormVersion(ctx, form.id)
  if ((latest?.versionNumber ?? 0) !== input.expectedVersion) {
    throw new AppError(
      "REVISION_CONFLICT",
      "This form changed while you were reviewing it. Refresh and try again.",
    )
  }

  const settings = { ...(form.settings as Record<string, unknown>) }
  const theme = { ...(form.theme as Record<string, unknown>) }
  const thankYou = { ...(form.thankYou as Record<string, unknown>) }
  const columns: { description?: string; name?: string; status?: string } = {}

  for (const change of input.changes) {
    switch (change.property) {
      case "title":
        if (typeof change.after === "string" && change.after.trim()) {
          columns.name = change.after.trim().slice(0, 240)
        }
        break
      case "description":
        columns.description =
          typeof change.after === "string" ? change.after.slice(0, 2_000) : ""
        break
      case "submitButtonLabel":
        settings.submitButtonLabel = stringSetting(change.after) ?? "Submit"
        break
      case "successMessage":
        thankYou.message = stringSetting(change.after) ?? ""
        break
      case "accentColor":
        theme.accentColor = stringSetting(change.after) ?? "#2563eb"
        break
      case "isOpen":
        columns.status = change.after === true ? "published" : "draft"
        break
      case "allowMultipleSubmissions":
        settings.allowMultipleSubmissions = change.after === true
        break
    }
  }

  await ctx.db
    .update(forms)
    .set({
      ...columns,
      settings,
      theme,
      thankYou,
      updatedAt: new Date(),
    })
    .where(and(eq(forms.orgId, ctx.session.orgId), eq(forms.id, form.id)))

  return {
    operation: "update_form_settings",
    summary: `Updated ${form.name}.`,
    entityIds: { baseId: base.id, formId: form.id },
    result: { formId: form.id, updatedProperties: input.changes.map((change) => change.property) },
  }
}

/* ---- create_view --------------------------------------------------------- */

async function proposeCreateView(
  ctx: AiToolContext,
  input: z.infer<typeof createViewInputSchema>,
): Promise<WriteProposal> {
  const base = await requireBase(ctx, input.baseId)
  const table = await requireTable(ctx, base.id, input.tableId)
  const definitions = (await loadFieldRows(ctx, table.id)).map(toFieldDefinition)
  assertViewConfiguration(definitions, input.type as ViewType, input.configuration)

  return {
    operation: "create_view",
    title: `Create view "${input.name}"`,
    summary: `Adds a ${input.type} view to ${table.name}.`,
    requiresApproval: true,
    diff: [
      { label: "Table", after: table.name },
      { label: "Before", after: "No new view" },
      { label: "After", after: `${input.name} (${input.type})` },
    ],
    input: input as unknown as Record<string, JsonValue>,
    warnings: [],
  }
}

async function executeCreateView(
  ctx: AiToolContext,
  input: z.infer<typeof createViewInputSchema>,
): Promise<WriteExecution> {
  const base = await requireBase(ctx, input.baseId)
  const table = await requireTable(ctx, base.id, input.tableId)
  const definitions = (await loadFieldRows(ctx, table.id)).map(toFieldDefinition)
  assertViewConfiguration(definitions, input.type as ViewType, input.configuration)

  const viewId = `viw_${nanoid(10)}`
  const rank = await nextViewRank(ctx, table.id)
  await ctx.db.insert(views).values({
    id: viewId,
    orgId: ctx.session.orgId,
    tableId: table.id,
    name: input.name,
    type: input.type,
    isDefault: false,
    rank,
    configuration: input.configuration,
    status: "active",
  })

  return {
    operation: "create_view",
    summary: `Added the ${input.name} view to ${table.name}.`,
    entityIds: { baseId: base.id, tableId: table.id, viewId },
    result: {
      viewId,
      href: `/bases/${base.id}/tables/${table.id}?view=${viewId}`,
    },
  }
}

function assertViewConfiguration(
  definitions: readonly FieldDefinition[],
  type: ViewType,
  configuration: Record<string, unknown>,
): void {
  const byId = new Map(definitions.map((field) => [field.id, field]))
  const requireField = (key: string, fieldTypes: readonly FieldType[]) => {
    const fieldId = configuration[key]
    if (typeof fieldId !== "string") {
      throw new AppError("VALIDATION_ERROR", "Choose the column this view should use.")
    }
    const field = byId.get(fieldId)
    if (!field) {
      throw new AppError("NOT_FOUND", "That column is no longer available.")
    }
    if (!fieldTypes.includes(field.type)) {
      throw new AppError(
        "VALIDATION_ERROR",
        `${field.name} cannot be used by a ${type} view.`,
      )
    }
  }

  if (type === "kanban") {
    requireField("kanbanFieldId", ["singleSelect"])
  }
  if (type === "calendar") {
    requireField("calendarDateFieldId", ["date"])
  }
  if (type === "timeline") {
    requireField("timelineStartFieldId", ["date"])
    if (configuration.timelineEndFieldId !== undefined) {
      requireField("timelineEndFieldId", ["date"])
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

async function requireBase(ctx: AiToolContext, baseId: string) {
  const [base] = await ctx.db
    .select()
    .from(bases)
    .where(
      and(
        eq(bases.orgId, ctx.session.orgId),
        eq(bases.id, baseId),
        eq(bases.status, "active"),
      ),
    )
    .limit(1)
  if (!base) {
    throw new AppError("NOT_FOUND", "That base is no longer available.")
  }
  return base
}

async function requireTable(
  ctx: AiToolContext,
  baseId: string,
  tableId: string,
) {
  const [table] = await ctx.db
    .select()
    .from(tables)
    .where(
      and(
        eq(tables.orgId, ctx.session.orgId),
        eq(tables.baseId, baseId),
        eq(tables.id, tableId),
        eq(tables.status, "active"),
      ),
    )
    .limit(1)
  if (!table) {
    throw new AppError("NOT_FOUND", "That table is no longer available.")
  }
  return table
}

async function requireForm(
  ctx: AiToolContext,
  baseId: string,
  formId: string,
) {
  const [form] = await ctx.db
    .select()
    .from(forms)
    .where(
      and(
        eq(forms.orgId, ctx.session.orgId),
        eq(forms.baseId, baseId),
        eq(forms.id, formId),
      ),
    )
    .limit(1)
  if (!form) {
    throw new AppError("NOT_FOUND", "That form is no longer available.")
  }
  return form
}

async function loadFieldRows(ctx: AiToolContext, tableId: string) {
  return ctx.db
    .select()
    .from(fields)
    .where(
      and(
        eq(fields.orgId, ctx.session.orgId),
        eq(fields.tableId, tableId),
        eq(fields.status, "active"),
      ),
    )
    .orderBy(asc(fields.rank))
}

async function loadViewRows(ctx: AiToolContext, tableId: string) {
  return ctx.db
    .select()
    .from(views)
    .where(
      and(
        eq(views.orgId, ctx.session.orgId),
        eq(views.tableId, tableId),
        eq(views.status, "active"),
      ),
    )
    .orderBy(asc(views.rank))
}

async function countRecords(
  ctx: AiToolContext,
  tableId: string,
): Promise<number> {
  const [row] = await ctx.db
    .select({ value: count() })
    .from(records)
    .where(
      and(
        eq(records.orgId, ctx.session.orgId),
        eq(records.tableId, tableId),
        eq(records.status, "active"),
      ),
    )
  return Number(row?.value ?? 0)
}

async function latestFormVersion(ctx: AiToolContext, formId: string) {
  const [version] = await ctx.db
    .select({ versionNumber: formVersions.versionNumber })
    .from(formVersions)
    .where(eq(formVersions.formId, formId))
    .orderBy(desc(formVersions.versionNumber))
    .limit(1)
  return version
}

async function nextTableRank(ctx: AiToolContext, baseId: string) {
  const rows = await ctx.db
    .select({ rank: tables.rank })
    .from(tables)
    .where(
      and(
        eq(tables.orgId, ctx.session.orgId),
        eq(tables.baseId, baseId),
        eq(tables.status, "active"),
      ),
    )
    .orderBy(desc(tables.rank))
    .limit(1)
  return generateKeyBetween(rows[0]?.rank ?? null, null)
}

async function nextViewRank(ctx: AiToolContext, tableId: string) {
  const rows = await ctx.db
    .select({ rank: views.rank })
    .from(views)
    .where(
      and(
        eq(views.orgId, ctx.session.orgId),
        eq(views.tableId, tableId),
        eq(views.status, "active"),
      ),
    )
    .orderBy(desc(views.rank))
    .limit(1)
  return generateKeyBetween(rows[0]?.rank ?? null, null)
}

async function nextRecordRank(
  ctx: AiToolContext,
  tableId: string,
  db: AppDb = ctx.db,
) {
  const rows = await db
    .select({ rank: records.rank })
    .from(records)
    .where(
      and(
        eq(records.orgId, ctx.session.orgId),
        eq(records.tableId, tableId),
        eq(records.status, "active"),
      ),
    )
    .orderBy(desc(records.rank))
    .limit(1)
  return generateKeyBetween(rows[0]?.rank ?? null, null)
}

function toFieldDefinition(row: typeof fields.$inferSelect): FieldDefinition {
  return {
    id: row.id,
    name: row.name,
    type: row.type as FieldType,
    config: (row.config ?? {}) as FieldConfig,
    rank: row.rank,
    width: row.width,
    isPrimary: row.isPrimary,
    frozen: row.frozen,
  }
}

function contractField(
  field: FieldDefinition,
  row: typeof fields.$inferSelect | undefined,
) {
  const options = field.config.options ?? []
  return {
    id: field.id,
    name: field.name,
    type: field.type,
    revision: 0,
    config: (row?.config ?? {}) as unknown as Record<string, JsonValue>,
    ...(options.length > 0
      ? {
          options: options.slice(0, 200).map((option) => ({
            id: option.id,
            label: option.label,
            ...(option.color ? { color: option.color } : {}),
          })),
        }
      : {}),
  }
}

type SourceQuery = {
  description: string
  kind: "recordList" | "tableSummary" | "formAnalytics"
  rowLimit: number
  records?: Array<{ id: string; name: string }>
}

function tableSource(
  base: { id: string; name: string },
  table: { id: string; name: string },
  fieldEntities: ReadonlyArray<{ id: string; name: string }>,
  query: SourceQuery,
): z.infer<typeof assistantSourceSchema> {
  return {
    kind: "table",
    base,
    table,
    fields: fieldEntities.slice(0, 100),
    ...(query.records
      ? { records: query.records.slice(0, 50) }
      : {}),
    query: {
      kind: query.kind,
      description: query.description.slice(0, 500),
      rowLimit: Math.max(1, Math.min(6_000, query.rowLimit)),
    },
  }
}

function primaryField(
  definitions: readonly FieldDefinition[],
): FieldDefinition | undefined {
  return (
    definitions.find((field) => field.isPrimary) ??
    definitions.find((field) => field.type === "singleLineText") ??
    definitions[0]
  )
}

function recordLabel(
  values: Record<string, unknown>,
  primary: FieldDefinition | undefined,
): string | undefined {
  if (!primary) return undefined
  const value = values[primary.id]
  const label = displayValue(primary, value)
  return label === "No value" ? undefined : label.slice(0, 240)
}

function recordSummary(values: Record<string, unknown>): string {
  const first = Object.values(values).find(
    (value) => typeof value === "string" && value.trim().length > 0,
  )
  return typeof first === "string" ? first.slice(0, 240) : "One record"
}

function describeRecordValues(
  definitions: readonly FieldDefinition[],
  values: Record<string, CellValue>,
): WriteDiffRow[] {
  const byId = new Map(definitions.map((field) => [field.id, field]))
  return Object.entries(values)
    .slice(0, 8)
    .map(([fieldId, value]) => {
      const field = byId.get(fieldId)
      return field
        ? { label: field.name, after: displayValue(field, value) }
        : undefined
    })
    .filter((row): row is WriteDiffRow => row !== undefined)
}

function buildChangeDiff(
  definitions: readonly FieldDefinition[],
  changes: ReadonlyArray<{ after: JsonValue; before: JsonValue; fieldId: string; fieldName: string }>,
): WriteDiffRow[] {
  const byId = new Map(definitions.map((field) => [field.id, field]))
  return changes.slice(0, 12).map((change) => {
    const field = byId.get(change.fieldId)
    return {
      label: field?.name ?? change.fieldName,
      before: field ? displayValue(field, change.before) : describeSettingValue(change.before),
      after: field ? displayValue(field, change.after) : describeSettingValue(change.after),
    }
  })
}

function summarizeField(
  field: FieldDefinition,
  rawValues: readonly unknown[],
  topValueLimit: number,
) {
  const values = rawValues.filter(isPopulated)
  const numeric = NUMERIC_FIELD_TYPES.has(field.type)
    ? values
        .map((value) => (typeof value === "number" ? value : Number(value)))
        .filter((value) => Number.isFinite(value))
    : []

  const counts = new Map<string, { count: number; raw: JsonValue }>()
  for (const value of values) {
    for (const entry of valueEntries(field, value)) {
      const key = entry.label.toLowerCase()
      const existing = counts.get(key)
      if (existing) existing.count += 1
      else counts.set(key, { count: 1, raw: entry.raw })
    }
  }

  const summary: z.infer<typeof fieldSummarySchema> = {
    fieldId: field.id,
    fieldName: field.name,
    fieldType: field.type,
    populatedCount: values.length,
    emptyCount: Math.max(0, rawValues.length - values.length),
    distinctCount: distinctCount(values),
    ...(numeric.length > 0
      ? {
          total: roundNumber(numeric.reduce((total, value) => total + value, 0)),
          minimum: roundNumber(Math.min(...numeric)),
          maximum: roundNumber(Math.max(...numeric)),
          average: roundNumber(
            numeric.reduce((total, value) => total + value, 0) / numeric.length,
          ),
        }
      : {}),
    ...(counts.size > 0
      ? {
          topValues: [...counts.entries()]
            .sort((left, right) => right[1].count - left[1].count)
            .slice(0, topValueLimit)
            .map(([, entry]) => ({ value: entry.raw, count: entry.count })),
        }
      : {}),
  }
  return summary
}

function groupValues(
  field: FieldDefinition,
  rawValues: readonly unknown[],
  limit: number,
) {
  const counts = new Map<string, { count: number; raw: JsonValue }>()
  for (const value of rawValues) {
    const entries = isPopulated(value)
      ? valueEntries(field, value)
      : [{ label: "No value", raw: null as JsonValue }]
    for (const entry of entries) {
      const key = entry.label.toLowerCase()
      const existing = counts.get(key)
      if (existing) existing.count += 1
      else counts.set(key, { count: 1, raw: entry.raw })
    }
  }

  return [...counts.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, limit)
    .map((entry) => ({
      group: entry.raw,
      label: labelFromRaw(entry.raw),
      value: entry.count,
    }))
}

function labelFromRaw(raw: JsonValue): string {
  if (typeof raw === "string") return raw.slice(0, 240) || "No value"
  if (typeof raw === "number") return new Intl.NumberFormat().format(raw)
  if (typeof raw === "boolean") return raw ? "Yes" : "No"
  return "No value"
}

function valueEntries(
  field: FieldDefinition,
  value: unknown,
): Array<{ label: string; raw: JsonValue }> {
  if (CHOICE_FIELD_TYPES.has(field.type)) {
    const options = field.config.options ?? []
    const resolve = (item: string) => {
      const option = options.find((candidate) => candidate.id === item)
      const label = option?.label ?? item
      return { label, raw: label }
    }
    if (field.type === "singleSelect" && typeof value === "string") {
      return [resolve(value)]
    }
    if (field.type === "multiSelect" && Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === "string")
        .map(resolve)
    }
  }
  const label = displayValue(field, value)
  return [{ label, raw: rawFromValue(value) }]
}

function displayValue(field: FieldDefinition, value: unknown): string {
  if (!isPopulated(value)) return "No value"
  if (field.type === "singleSelect" && typeof value === "string") {
    const option = (field.config.options ?? []).find(
      (candidate) => candidate.id === value,
    )
    return (option?.label ?? value).slice(0, 240)
  }
  if (field.type === "multiSelect" && Array.isArray(value)) {
    const options = field.config.options ?? []
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => options.find((option) => option.id === item)?.label ?? item)
      .join(", ")
      .slice(0, 240)
  }
  if (field.type === "checkbox") return value === true ? "Checked" : "Not checked"
  if (field.type === "currency" && typeof value === "number") {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: field.config.currency ?? "USD",
        maximumFractionDigits: field.config.precision ?? 2,
      }).format(value)
    } catch {
      return `${field.config.currency ?? "USD"} ${value}`
    }
  }
  if (typeof value === "number") {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: field.config.precision ?? 2,
    }).format(value)
  }
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value)) return `${value.length} files`
  return String(value).slice(0, 240)
}

function rawFromValue(value: unknown): JsonValue {
  if (typeof value === "string") return value.slice(0, 240)
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "boolean") return value
  if (Array.isArray(value)) return `${value.length} files`
  return null
}

function describeSettingValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "Not set"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") return String(value)
  return String(value).slice(0, 240)
}

function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === "string") return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

function distinctCount(values: readonly unknown[]): number {
  return new Set(values.map((value) => JSON.stringify(value) ?? "")).size
}

function roundNumber(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 1_000_000) / 1_000_000 || 0
}

/**
 * Sort key for one column, typed the way the column stores its values: numbers
 * and timestamps compare numerically, text compares case-insensitively.
 */
function sortExpression(field: FieldDefinition) {
  const raw = sql`${records.values} ->> ${field.id}`
  switch (field.type) {
    case "number":
    case "currency":
    case "percent":
    case "rating":
    case "date":
    case "createdTime":
      return sql`nullif(${raw}, '')::double precision`
    case "checkbox":
      return sql`case when ${raw} = 'true' then 1 else 0 end`
    default:
      return sql`lower(${raw})`
  }
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  const parsed = Number.parseInt(cursor, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function likePattern(search: string): string {
  return `%${search.toLowerCase().replace(/[\\%_]/g, (match) => `\\${match}`)}%`
}

function normalizeOptions(
  type: FieldType,
  raw: unknown,
  fieldName: string,
): SelectOption[] | undefined {
  if (type !== "singleSelect" && type !== "multiSelect") return undefined
  const entries = Array.isArray(raw) ? raw : []
  const options: SelectOption[] = []

  for (const entry of entries) {
    if (typeof entry === "string") {
      const label = entry.trim()
      if (!label) continue
      options.push({
        id: `opt_${nanoid(8)}`,
        label: label.slice(0, 240),
        color: OPTION_COLORS[options.length % OPTION_COLORS.length],
      })
      continue
    }
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      continue
    }
    const record = entry as Record<string, unknown>
    const label =
      typeof record.label === "string"
        ? record.label.trim()
        : typeof record.name === "string"
          ? record.name.trim()
          : ""
    if (!label) continue
    options.push({
      id:
        typeof record.id === "string" && record.id.trim()
          ? record.id.trim().slice(0, 80)
          : `opt_${nanoid(8)}`,
      label: label.slice(0, 240),
      color:
        typeof record.color === "string" && record.color.trim()
          ? record.color.trim().slice(0, 32)
          : OPTION_COLORS[options.length % OPTION_COLORS.length],
    })
  }

  if (options.length === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      `${fieldName} needs at least one choice.`,
    )
  }

  return options.slice(0, 200)
}

function resolveCellInput(
  field: FieldDefinition,
  value: unknown,
): unknown {
  if (value === null || value === undefined || value === "") return null

  if (CHOICE_FIELD_TYPES.has(field.type)) {
    const options = field.config.options ?? []
    const resolveOne = (item: unknown): string | undefined => {
      if (typeof item !== "string") return undefined
      if (options.some((option) => option.id === item)) return item
      const match = options.find(
        (option) => option.label.toLowerCase() === item.trim().toLowerCase(),
      )
      return match?.id
    }
    if (field.type === "singleSelect") return resolveOne(value)
    if (!Array.isArray(value)) return undefined
    const resolved = value
      .map(resolveOne)
      .filter((item): item is string => item !== undefined)
    return resolved.length > 0 ? resolved : undefined
  }

  if (
    field.type === "number" ||
    field.type === "currency" ||
    field.type === "percent" ||
    field.type === "rating"
  ) {
    const numeric = typeof value === "number" ? value : Number(value)
    return Number.isFinite(numeric) ? numeric : undefined
  }

  if (field.type === "checkbox") {
    if (typeof value === "boolean") return value
    if (value === "true" || value === "yes") return true
    if (value === "false" || value === "no") return false
    return undefined
  }

  if (field.type === "date") {
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value !== "string") return undefined
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? undefined : value
  }

  if (
    field.type === "singleLineText" ||
    field.type === "longText" ||
    field.type === "email" ||
    field.type === "phone" ||
    field.type === "url"
  ) {
    return typeof value === "string" ? value : undefined
  }

  if (field.type === "attachment" || field.type === "image") {
    return Array.isArray(value) ? value : undefined
  }

  return undefined
}

function stringSetting(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  return slug || "form"
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function enumerateDays(fromDay: string, toDay: string): string[] {
  const days: string[] = []
  const start = Date.parse(`${fromDay}T00:00:00.000Z`)
  const end = Date.parse(`${toDay}T00:00:00.000Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return days
  }
  for (let time = start; time <= end; time += 24 * 60 * 60 * 1_000) {
    days.push(new Date(time).toISOString().slice(0, 10))
    if (days.length >= 90) break
  }
  return days
}
