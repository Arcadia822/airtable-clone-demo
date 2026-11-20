import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { generateKeyBetween } from "jittered-fractional-indexing"
import { nanoid } from "nanoid"
import { z } from "zod"

import {
  attachments as attachmentsTable,
  fieldSequences,
  records as recordsTable,
} from "../../../drizzle/schema"
import type { AppDb } from "@/db/client"
import { isReadOnlyFieldType, validateCellValue, validateRecordValues } from "@/lib/cell-validation"
import { AppError, type CellValue, type FieldDefinition, type GridRecord } from "@/lib/domain"
import { buildRecordSearchText } from "@/server/search-text"
import {
  flattenSavedViewGroups,
  processSavedView,
  type SavedViewDefinition,
  type SavedViewGroup,
  type SavedViewRecordGroup,
  type SavedViewSort,
} from "@/lib/view-processing"

import { attachmentValueFromRow, type ResolvedAttachment } from "@/server/services/attachments"
import {
  fieldRowToDefinition,
  listActiveFields,
  recordRowToGridRecord,
  requireTable,
  type FieldRow,
} from "@/server/services/tables"

export type RecordRow = typeof recordsTable.$inferSelect

const filterSchema = z.object({
  id: z.string().min(1),
  fieldId: z.string().min(1),
  operator: z.enum([
    "is",
    "is_not",
    "contains",
    "does_not_contain",
    "is_empty",
    "is_not_empty",
    "greater_than",
    "less_than",
    "before",
    "after",
  ]),
  value: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])
    .optional(),
})

const sortSchema = z.object({
  id: z.string().min(1),
  fieldId: z.string().min(1),
  direction: z.enum(["asc", "desc"]),
  rank: z.string().min(1),
})

const groupSchema = z.object({
  id: z.string().min(1),
  fieldId: z.string().min(1),
  direction: z.enum(["asc", "desc"]),
  rank: z.string().min(1),
})

export const queryRecordsInputSchema = z.object({
  filterConjunction: z.enum(["and", "or"]).optional(),
  filters: z.array(filterSchema).optional(),
  sorts: z.array(sortSchema).optional(),
  groups: z.array(groupSchema).optional(),
  search: z.string().max(400).optional(),
  limit: z.number().int().min(1).max(1_000).optional(),
  offset: z.number().int().min(0).max(100_000).optional(),
})

export const createRecordInputSchema = z.object({
  values: z.record(z.string(), z.unknown()).default({}),
})

export const updateRecordInputSchema = z.object({
  values: z.record(z.string(), z.unknown()).optional(),
  expectedRevision: z.number().int().min(1).optional(),
})

export const batchUpdateInputSchema = z.object({
  updates: z
    .array(
      z.object({
        recordId: z.string().min(1),
        fieldId: z.string().min(1),
        value: z.unknown(),
        expectedRevision: z.number().int().min(1).optional(),
      }),
    )
    .min(1, "At least one cell update is required.")
    .max(500, "At most 500 cell updates are allowed per batch."),
})

export const bulkDeleteInputSchema = z.object({
  recordIds: z.array(z.string().min(1)).min(1).max(500),
})

/* -------------------------------------------------------------------------- */
/* Attachment hydration                                                       */
/* -------------------------------------------------------------------------- */

function isAttachmentItem(value: unknown): value is { attachmentId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { attachmentId?: unknown }).attachmentId === "string"
  )
}

async function loadAttachmentIndex(
  db: AppDb,
  orgId: string,
  recordIds: readonly string[],
): Promise<Map<string, ResolvedAttachment>> {
  if (!recordIds.length) return new Map()
  const rows = await db
    .select()
    .from(attachmentsTable)
    .where(
      and(
        eq(attachmentsTable.orgId, orgId),
        eq(attachmentsTable.status, "active"),
        inArray(attachmentsTable.recordId, [...recordIds]),
      ),
    )
  return new Map(rows.map((row) => [row.id, attachmentValueFromRow(row)]))
}

/**
 * Resolves stored attachment cells to `AttachmentValue` entries with a
 * `/api/files/<id>` URL so grids render without a second round trip.
 */
export function hydrateRecordValues(
  values: Record<string, unknown>,
  attachmentsById: ReadonlyMap<string, ResolvedAttachment>,
): Record<string, CellValue> {
  const hydrated: Record<string, CellValue> = { ...(values as Record<string, CellValue>) }
  for (const [fieldId, rawValue] of Object.entries(values)) {
    if (!Array.isArray(rawValue) || rawValue.length === 0) continue
    if (!rawValue.every(isAttachmentItem)) continue
    hydrated[fieldId] = rawValue.map((item) => {
      const resolved = attachmentsById.get(item.attachmentId)
      if (resolved) return resolved
      const fallback = item as {
        attachmentId: string
        name?: unknown
        mimeType?: unknown
        size?: unknown
      }
      return {
        id: fallback.attachmentId,
        attachmentId: fallback.attachmentId,
        name: typeof fallback.name === "string" ? fallback.name : fallback.attachmentId,
        mimeType:
          typeof fallback.mimeType === "string"
            ? fallback.mimeType
            : "application/octet-stream",
        size: typeof fallback.size === "number" ? fallback.size : 0,
        url: `/api/files/${encodeURIComponent(fallback.attachmentId)}`,
      } satisfies ResolvedAttachment
    })
  }
  return hydrated
}

async function hydrateRows(
  db: AppDb,
  orgId: string,
  rows: readonly RecordRow[],
): Promise<GridRecord[]> {
  const attachmentsById = await loadAttachmentIndex(
    db,
    orgId,
    rows.map((row) => row.id),
  )
  return rows.map((row) => {
    const record = recordRowToGridRecord(row)
    return { ...record, values: hydrateRecordValues(row.values ?? {}, attachmentsById) }
  })
}

/* -------------------------------------------------------------------------- */
/* Read                                                                       */
/* -------------------------------------------------------------------------- */

export async function getRecords(
  db: AppDb,
  orgId: string,
  tableId: string,
): Promise<{ records: GridRecord[] }> {
  await requireTable(db, orgId, tableId)
  const rows = await db
    .select()
    .from(recordsTable)
    .where(
      and(
        eq(recordsTable.orgId, orgId),
        eq(recordsTable.tableId, tableId),
        eq(recordsTable.status, "active"),
      ),
    )
    .orderBy(asc(recordsTable.rank), asc(recordsTable.createdAt))
  return { records: await hydrateRows(db, orgId, rows) }
}

export async function getRecord(
  db: AppDb,
  orgId: string,
  recordId: string,
): Promise<{ record: GridRecord }> {
  const [row] = await db
    .select()
    .from(recordsTable)
    .where(
      and(
        eq(recordsTable.id, recordId),
        eq(recordsTable.orgId, orgId),
        eq(recordsTable.status, "active"),
      ),
    )
    .limit(1)
  if (!row) throw new AppError("NOT_FOUND", "Record not found.")
  const [record] = await hydrateRows(db, orgId, [row])
  return { record }
}

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */

function writableValues(
  values: Record<string, unknown>,
  fieldRows: readonly FieldRow[],
): Record<string, unknown> {
  const byId = new Map(
    fieldRows.map((row) => [row.id, fieldRowToDefinition(row) as FieldDefinition]),
  )
  const writable: Record<string, unknown> = {}
  for (const [fieldId, value] of Object.entries(values)) {
    const field = byId.get(fieldId)
    if (!field) continue
    if (isReadOnlyFieldType(field.type)) continue
    writable[fieldId] = value
  }
  return writable
}

export const MAX_ATTACHMENTS_PER_CELL = 10

function assertAttachmentCellLimit(field: FieldDefinition, value: unknown): void {
  if (field.type !== "attachment" && field.type !== "image") return
  if (!Array.isArray(value)) return
  const limit = field.type === "image" ? 1 : MAX_ATTACHMENTS_PER_CELL
  if (value.length > limit) {
    throw new AppError(
      "VALIDATION_ERROR",
      `${field.name} accepts at most ${limit} ${field.type === "image" ? "image" : "attachments"}.`,
    )
  }
}

function validateCellWithinLimits(field: FieldDefinition, value: unknown): CellValue {
  const validated = validateCellValue(field, value)
  assertAttachmentCellLimit(field, validated)
  return validated
}

function assertCellLimits(
  values: Record<string, unknown>,
  fields: readonly FieldDefinition[],
): void {
  const byId = new Map(fields.map((field) => [field.id, field]))
  for (const [fieldId, value] of Object.entries(values)) {
    const field = byId.get(fieldId)
    if (field) assertAttachmentCellLimit(field, value)
  }
}

async function allocateSequenceValues(
  tx: AppDb,
  tableId: string,
  fieldIds: readonly string[],
  count: number,
): Promise<Record<string, number>> {
  const firstValues: Record<string, number> = {}
  for (const fieldId of fieldIds) {
    const [updated] = await tx
      .update(fieldSequences)
      .set({ nextValue: sql`${fieldSequences.nextValue} + ${count}` })
      .where(
        and(eq(fieldSequences.fieldId, fieldId), eq(fieldSequences.tableId, tableId)),
      )
      .returning({ nextValue: fieldSequences.nextValue })

    if (updated) {
      firstValues[fieldId] = updated.nextValue - count
      continue
    }

    await tx
      .insert(fieldSequences)
      .values({ fieldId, tableId, nextValue: count + 1 })
      .onConflictDoNothing()

    const [retried] = await tx
      .update(fieldSequences)
      .set({ nextValue: sql`${fieldSequences.nextValue} + ${count}` })
      .where(
        and(eq(fieldSequences.fieldId, fieldId), eq(fieldSequences.tableId, tableId)),
      )
      .returning({ nextValue: fieldSequences.nextValue })
    if (!retried) {
      throw new AppError("VALIDATION_ERROR", "Auto-number sequence is unavailable.")
    }
    firstValues[fieldId] = retried.nextValue - count
  }
  return firstValues
}

export async function createRecord(
  db: AppDb,
  orgId: string,
  userId: string,
  tableId: string,
  rawInput: unknown,
): Promise<{ record: GridRecord }> {
  await requireTable(db, orgId, tableId)
  const input = createRecordInputSchema.parse(rawInput)
  const fieldRows = await listActiveFields(db, orgId, tableId)
  const definitions = fieldRows.map(fieldRowToDefinition)
  const autoNumberFieldIds = fieldRows
    .filter((row) => row.type === "autoNumber")
    .map((row) => row.id)

  const values = validateRecordValues(
    writableValues(input.values, fieldRows),
    definitions,
  ) as Record<string, unknown>
  assertCellLimits(values, definitions)

  const recordId = `rec_${nanoid(10)}`

  await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as AppDb
    const assigned = await allocateSequenceValues(tx, tableId, autoNumberFieldIds, 1)
    for (const [fieldId, value] of Object.entries(assigned)) {
      values[fieldId] = value
    }
    const [last] = await tx
      .select({ rank: recordsTable.rank })
      .from(recordsTable)
      .where(
        and(
          eq(recordsTable.orgId, orgId),
          eq(recordsTable.tableId, tableId),
          eq(recordsTable.status, "active"),
        ),
      )
      .orderBy(desc(recordsTable.rank))
      .limit(1)

    await tx.insert(recordsTable).values({
      id: recordId,
      orgId,
      tableId,
      rank: generateKeyBetween(last?.rank ?? null, null),
      values,
      searchText: buildRecordSearchText(values, definitions),
      revision: 1,
      status: "active",
      createdBy: userId,
      updatedBy: userId,
    })
  })

  return getRecord(db, orgId, recordId)
}

/* -------------------------------------------------------------------------- */
/* Update                                                                     */
/* -------------------------------------------------------------------------- */

function assertRevision(row: RecordRow, expectedRevision: number | undefined): void {
  if (expectedRevision !== undefined && row.revision !== expectedRevision) {
    throw new AppError("REVISION_CONFLICT", "This record was updated by someone else.", {
      recordId: row.id,
      expectedRevision,
      actualRevision: row.revision,
    })
  }
}

export async function updateRecord(
  db: AppDb,
  orgId: string,
  userId: string,
  recordId: string,
  rawInput: unknown,
): Promise<{ record: GridRecord }> {
  const input = updateRecordInputSchema.parse(rawInput)
  const [row] = await db
    .select()
    .from(recordsTable)
    .where(
      and(
        eq(recordsTable.id, recordId),
        eq(recordsTable.orgId, orgId),
        eq(recordsTable.status, "active"),
      ),
    )
    .limit(1)
  if (!row) throw new AppError("NOT_FOUND", "Record not found.")
  await requireTable(db, orgId, row.tableId)
  assertRevision(row, input.expectedRevision)

  const fieldRows = await listActiveFields(db, orgId, row.tableId)
  const definitions = fieldRows.map(fieldRowToDefinition)
  const validated = validateRecordValues(
    writableValues(input.values ?? {}, fieldRows),
    definitions,
  )
  assertCellLimits(validated, definitions)
  const values: Record<string, unknown> = { ...(row.values ?? {}), ...validated }
  const revision = row.revision + 1

  await db
    .update(recordsTable)
    .set({
      values,
      revision,
      searchText: buildRecordSearchText(values, definitions),
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(and(eq(recordsTable.id, row.id), eq(recordsTable.orgId, orgId)))

  return getRecord(db, orgId, recordId)
}

export interface BatchUpdateResult {
  revisions: Record<string, number>
}

export async function batchUpdateRecords(
  db: AppDb,
  orgId: string,
  userId: string,
  tableId: string,
  rawInput: unknown,
): Promise<BatchUpdateResult> {
  await requireTable(db, orgId, tableId)
  const input = batchUpdateInputSchema.parse(rawInput)
  const fieldRows = await listActiveFields(db, orgId, tableId)
  const fieldsById = new Map(fieldRows.map((row) => [row.id, fieldRowToDefinition(row)]))
  const definitions = fieldRows.map(fieldRowToDefinition)

  const recordIds = [...new Set(input.updates.map((update) => update.recordId))]
  const rows = await db
    .select()
    .from(recordsTable)
    .where(
      and(
        eq(recordsTable.orgId, orgId),
        eq(recordsTable.tableId, tableId),
        eq(recordsTable.status, "active"),
        inArray(recordsTable.id, recordIds),
      ),
    )
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  if (rowsById.size !== recordIds.length) {
    throw new AppError("NOT_FOUND", "One or more records do not belong to this table.")
  }
  const updatesByRecordId = new Map<
    string,
    Array<{ fieldId: string; value: CellValue }>
  >()
  for (const update of input.updates) {
    const field = fieldsById.get(update.fieldId)
    if (!field) {
      throw new AppError("VALIDATION_ERROR", `Unknown field "${update.fieldId}".`)
    }
    if (isReadOnlyFieldType(field.type)) {
      throw new AppError(
        "VALIDATION_ERROR",
        `${field.name} is read-only and cannot be edited.`,
      )
    }
    const row = rowsById.get(update.recordId)!
    assertRevision(row, update.expectedRevision)
    const validated = validateCellWithinLimits(field, update.value)
    const existing = updatesByRecordId.get(update.recordId) ?? []
    existing.push({ fieldId: update.fieldId, value: validated })
    updatesByRecordId.set(update.recordId, existing)
  }

  const revisions: Record<string, number> = {}
  await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as AppDb
    for (const [recordId, cellUpdates] of updatesByRecordId) {
      const row = rowsById.get(recordId)!
      const values: Record<string, unknown> = { ...(row.values ?? {}) }
      for (const cell of cellUpdates) {
        values[cell.fieldId] = cell.value
      }
      const revision = row.revision + 1
      revisions[recordId] = revision
      await tx
        .update(recordsTable)
        .set({
          values,
          revision,
          searchText: buildRecordSearchText(values, definitions),
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(and(eq(recordsTable.id, recordId), eq(recordsTable.orgId, orgId)))
    }
  })

  return { revisions }
}

/* -------------------------------------------------------------------------- */
/* Delete / restore                                                           */
/* -------------------------------------------------------------------------- */

export async function deleteRecord(db: AppDb, orgId: string, recordId: string) {
  const [row] = await db
    .select({ id: recordsTable.id })
    .from(recordsTable)
    .where(
      and(
        eq(recordsTable.id, recordId),
        eq(recordsTable.orgId, orgId),
        eq(recordsTable.status, "active"),
      ),
    )
    .limit(1)
  if (!row) throw new AppError("NOT_FOUND", "Record not found.")
  await db
    .update(recordsTable)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(recordsTable.id, recordId), eq(recordsTable.orgId, orgId)))
  return { ok: true as const, recordId }
}

export async function deleteRecords(
  db: AppDb,
  orgId: string,
  tableId: string,
  rawInput: unknown,
): Promise<{ deleted: number }> {
  await requireTable(db, orgId, tableId)
  const input = bulkDeleteInputSchema.parse(rawInput)
  const ids = [...new Set(input.recordIds)]
  const updated = await db
    .update(recordsTable)
    .set({ status: "archived", updatedAt: new Date() })
    .where(
      and(
        eq(recordsTable.orgId, orgId),
        eq(recordsTable.tableId, tableId),
        eq(recordsTable.status, "active"),
        inArray(recordsTable.id, ids),
      ),
    )
    .returning({ id: recordsTable.id })
  return { deleted: updated.length }
}

export async function restoreRecord(
  db: AppDb,
  orgId: string,
  recordId: string,
): Promise<{ record: GridRecord }> {
  const [row] = await db
    .select()
    .from(recordsTable)
    .where(and(eq(recordsTable.id, recordId), eq(recordsTable.orgId, orgId)))
    .limit(1)
  if (!row) throw new AppError("NOT_FOUND", "Record not found.")
  await requireTable(db, orgId, row.tableId)
  await db
    .update(recordsTable)
    .set({ status: "active", updatedAt: new Date() })
    .where(and(eq(recordsTable.id, recordId), eq(recordsTable.orgId, orgId)))
  return getRecord(db, orgId, recordId)
}

/* -------------------------------------------------------------------------- */
/* Conditional query                                                          */
/* -------------------------------------------------------------------------- */

function normalizeSorts(sorts: readonly SavedViewSort[] | undefined): SavedViewSort[] {
  return (sorts ?? []).map((sort, index) => ({
    id: sort.id,
    fieldId: sort.fieldId,
    direction: sort.direction,
    rank: sort.rank || `a${index}`,
  }))
}

function normalizeGroups(groups: readonly SavedViewGroup[] | undefined): SavedViewGroup[] {
  return (groups ?? []).map((group, index) => ({
    id: group.id,
    fieldId: group.fieldId,
    direction: group.direction,
    rank: group.rank || `a${index}`,
  }))
}

export interface QueryRecordsResult {
  records: GridRecord[]
  totalCount: number
  groupLabelsByRecordId: Record<string, string>
  groups: SavedViewRecordGroup[]
}

/**
 * Unified conditional query: global `search_text` filtering runs first, then
 * `processSavedView` applies the exact same filter/sort/group semantics as the
 * client grid.
 */
export async function queryRecords(
  db: AppDb,
  orgId: string,
  tableId: string,
  rawInput: unknown,
): Promise<QueryRecordsResult> {
  await requireTable(db, orgId, tableId)
  const input = queryRecordsInputSchema.parse(rawInput)
  const fieldRows = await listActiveFields(db, orgId, tableId)
  const definitions = fieldRows.map(fieldRowToDefinition)

  const rows = await db
    .select()
    .from(recordsTable)
    .where(
      and(
        eq(recordsTable.orgId, orgId),
        eq(recordsTable.tableId, tableId),
        eq(recordsTable.status, "active"),
      ),
    )
    .orderBy(asc(recordsTable.rank), asc(recordsTable.createdAt))

  const terms = (input.search ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  const filteredRows = terms.length
    ? rows.filter((row) => {
        const haystack = (row.searchText ?? "").toLowerCase()
        return terms.every((term) => haystack.includes(term))
      })
    : rows

  const records = await hydrateRows(db, orgId, filteredRows)
  const definition: SavedViewDefinition = {
    filterConjunction: input.filterConjunction ?? "and",
    filters: (input.filters ?? []) as SavedViewDefinition["filters"],
    sorts: normalizeSorts(input.sorts),
    groups: normalizeGroups(input.groups),
  }
  const processed = processSavedView(records, definitions, definition)

  let ordered = processed.records
  let groupLabelsByRecordId: Record<string, string> = {}
  if (definition.groups.length) {
    const flattened = flattenSavedViewGroups(processed.groups)
    ordered = flattened.records
    groupLabelsByRecordId = flattened.labelsByRecordId
  }

  const totalCount = ordered.length
  const offset = input.offset ?? 0
  const limited =
    input.limit === undefined ? ordered.slice(offset) : ordered.slice(offset, offset + input.limit)

  return {
    records: limited,
    totalCount,
    groupLabelsByRecordId,
    groups: processed.groups,
  }
}
