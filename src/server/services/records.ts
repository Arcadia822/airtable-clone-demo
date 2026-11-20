import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm"
import { generateKeyBetween } from "jittered-fractional-indexing"
import { nanoid } from "nanoid"
import { z } from "zod"

import { attachments as attachmentsTable, records as recordsTable } from "../../../drizzle/schema"
import type { AppDb } from "@/db/client"
import { isReadOnlyFieldType, validateCellValue, validateRecordValues } from "@/lib/cell-validation"
import { AppError, type CellValue, type FieldDefinition, type GridRecord } from "@/lib/domain"
import { buildRecordSearchText } from "@/server/search-text"
import {
  flattenSavedViewGroups,
  processSavedView,
  type SavedViewDefinition,
  type SavedViewFilter,
  type SavedViewGroup,
  type SavedViewRecordGroup,
  type SavedViewSort,
} from "@/lib/view-processing"

import { attachmentValueFromRow, type ResolvedAttachment } from "@/server/services/attachments"
import {
  allocateSequenceValues,
  fieldRowToDefinition,
  listActiveFields,
  recordRowToGridRecord,
  requireTable,
  type FieldRow,
} from "@/server/services/tables"

export type RecordRow = typeof recordsTable.$inferSelect

export const savedViewFilterSchema = z.object({
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

export const savedViewSortSchema = z.object({
  id: z.string().min(1),
  fieldId: z.string().min(1),
  direction: z.enum(["asc", "desc"]),
  rank: z.string().min(1),
})

export const savedViewGroupSchema = z.object({
  id: z.string().min(1),
  fieldId: z.string().min(1),
  direction: z.enum(["asc", "desc"]),
  rank: z.string().min(1),
})

export const queryRecordsInputSchema = z.object({
  filterConjunction: z.enum(["and", "or"]).optional(),
  filters: z.array(savedViewFilterSchema).optional(),
  sorts: z.array(savedViewSortSchema).optional(),
  groups: z.array(savedViewGroupSchema).optional(),
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
    // Two creates that read the same "last rank" would mint the same key.
    // A transaction-scoped advisory lock serializes rank assignment per table
    // and releases automatically on commit/rollback.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${tableId}))`)
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

  // Single-statement compare-and-swap: the revision guard lives in the WHERE
  // clause, so a concurrent writer can never be silently overwritten between
  // the read above and this write. A caller that omits `expectedRevision` is
  // still guarded, on the revision this request just read.
  const guardRevision = input.expectedRevision ?? row.revision
  const [written] = await db
    .update(recordsTable)
    .set({
      values,
      revision: sql`${recordsTable.revision} + 1`,
      searchText: buildRecordSearchText(values, definitions),
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(recordsTable.id, row.id),
        eq(recordsTable.orgId, orgId),
        eq(recordsTable.status, "active"),
        eq(recordsTable.revision, guardRevision),
      ),
    )
    .returning({ revision: recordsTable.revision })

  if (!written) {
    // A zero-row write means the row moved. Re-read without the active filter
    // so that a record archived mid-flight answers NOT_FOUND, and only a
    // revision that actually advanced answers REVISION_CONFLICT.
    const [current] = await db
      .select({ revision: recordsTable.revision, status: recordsTable.status })
      .from(recordsTable)
      .where(and(eq(recordsTable.id, row.id), eq(recordsTable.orgId, orgId)))
      .limit(1)
    if (!current || current.status !== "active") {
      throw new AppError("NOT_FOUND", "Record not found.")
    }
    throw new AppError("REVISION_CONFLICT", "This record was updated by someone else.", {
      recordId: row.id,
      expectedRevision: guardRevision,
      actualRevision: current.revision,
    })
  }

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
  const expectedByRecordId = new Map<string, number>()
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
    if (update.expectedRevision !== undefined) {
      expectedByRecordId.set(update.recordId, update.expectedRevision)
    }
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
      // Conditional write: the revision we read (or the caller's expected
      // revision) is part of the WHERE clause, so only a revision that actually
      // landed is ever reported back.
      const expectedRevision = expectedByRecordId.get(recordId) ?? row.revision
      const [written] = await tx
        .update(recordsTable)
        .set({
          values,
          revision: sql`${recordsTable.revision} + 1`,
          searchText: buildRecordSearchText(values, definitions),
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(recordsTable.id, recordId),
            eq(recordsTable.orgId, orgId),
            eq(recordsTable.status, "active"),
            eq(recordsTable.revision, expectedRevision),
          ),
        )
        .returning({ revision: recordsTable.revision })
      if (!written) {
        const [current] = await tx
          .select({ revision: recordsTable.revision })
          .from(recordsTable)
          .where(and(eq(recordsTable.id, recordId), eq(recordsTable.orgId, orgId)))
          .limit(1)
        throw new AppError("REVISION_CONFLICT", "This record was updated by someone else.", {
          recordId,
          expectedRevision,
          actualRevision: current?.revision ?? row.revision,
        })
      }
      revisions[recordId] = written.revision
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

const TEXT_FILTER_TYPES: Readonly<Partial<Record<FieldDefinition["type"], true>>> = {
  singleLineText: true,
  longText: true,
  email: true,
  phone: true,
  url: true,
}

const NUMERIC_FILTER_TYPES: Readonly<Partial<Record<FieldDefinition["type"], true>>> = {
  number: true,
  currency: true,
  percent: true,
  rating: true,
  autoNumber: true,
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function containsPattern(value: string): string {
  return `%${escapeLikePattern(value)}%`
}

/**
 * SQL predicate that is a *superset* of `matchesFilter` for every field type it
 * translates. Records the pure view engine keeps are therefore never dropped by
 * the pre-filter, so the in-memory pass stays authoritative while the scanned
 * row set stays bounded.
 */
function filterNarrowing(
  field: FieldDefinition,
  filter: SavedViewFilter,
): SQL | undefined {
  const text = sql`${recordsTable.values} ->> ${field.id}`

  if (TEXT_FILTER_TYPES[field.type]) {
    switch (filter.operator) {
      case "is_empty":
        // Blankness cannot be narrowed safely: the engine trims Unicode
        // whitespace, which SQL `btrim` does not. Scan without a predicate.
        return undefined
      case "is_not_empty":
        return sql`coalesce(btrim(${text}), '') <> ''`
      case "contains": {
        const token = typeof filter.value === "string" ? filter.value.trim() : ""
        if (!token) return undefined
        return sql`${text} ilike ${containsPattern(token)} escape '\\'`
      }
      case "is": {
        // Engine equality is trimmed, case-insensitive equality, so a matching
        // row necessarily contains the trimmed expectation as a substring.
        const expected = typeof filter.value === "string" ? filter.value.trim() : ""
        if (!expected) return undefined
        return sql`${text} ilike ${containsPattern(expected)} escape '\\'`
      }
      default:
        return undefined
    }
  }

  if (NUMERIC_FILTER_TYPES[field.type]) {
    const expected = typeof filter.value === "number" ? filter.value : Number(filter.value)
    if (!Number.isFinite(expected)) return undefined
    const numeric = sql`(${recordsTable.values} ->> ${field.id})::numeric`
    const isNumber = sql`jsonb_typeof(${recordsTable.values} -> ${field.id}) = 'number'`
    switch (filter.operator) {
      case "is":
        return sql`${isNumber} and ${numeric} = ${expected}`
      case "greater_than":
      case "after":
        return sql`${isNumber} and ${numeric} > ${expected}`
      case "less_than":
      case "before":
        return sql`${isNumber} and ${numeric} < ${expected}`
      default:
        return undefined
    }
  }

  return undefined
}

/**
 * Exact SQL rendering of the free-text search: one `ILIKE` per term over the
 * denormalized `search_text` column, matching the substring semantics of the
 * previous in-memory scan.
 */
function searchNarrowing(search: string | undefined): SQL | undefined {
  const terms = (search ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (!terms.length) return undefined
  return and(
    ...terms.map(
      (term) =>
        sql`${recordsTable.searchText} ilike ${containsPattern(term)} escape '\\'`,
    ),
  )
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

  const fieldsById = new Map(definitions.map((field) => [field.id, field]))
  const filters = input.filters ?? []

  // Narrow in SQL first. Every translated predicate is a superset of the pure
  // view engine's match, so the in-memory pass below remains authoritative.
  const narrowing: SQL[] = []
  let translatesEveryFilter = true
  for (const filter of filters) {
    const field = fieldsById.get(filter.fieldId)
    if (!field) continue
    const condition = filterNarrowing(field, filter)
    if (condition) {
      narrowing.push(condition)
    } else {
      translatesEveryFilter = false
    }
  }
  const conjunction = input.filterConjunction ?? "and"
  let filterCondition: SQL | undefined
  if (narrowing.length > 0) {
    if (conjunction === "and") {
      filterCondition = and(...narrowing)
    } else if (translatesEveryFilter) {
      filterCondition = or(...narrowing)
    }
  }

  const where = and(
    eq(recordsTable.orgId, orgId),
    eq(recordsTable.tableId, tableId),
    eq(recordsTable.status, "active"),
    searchNarrowing(input.search),
    filterCondition,
  )
  const offset = input.offset ?? 0
  const definition: SavedViewDefinition = {
    filterConjunction: conjunction,
    filters: filters as SavedViewDefinition["filters"],
    sorts: normalizeSorts(input.sorts),
    groups: normalizeGroups(input.groups),
  }
  const needsInMemoryProcessing =
    filters.length > 0 || definition.sorts.length > 0 || definition.groups.length > 0

  if (!needsInMemoryProcessing) {
    const [counted] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(recordsTable)
      .where(where)
    const orderedRows = db
      .select()
      .from(recordsTable)
      .where(where)
      .orderBy(asc(recordsTable.rank), asc(recordsTable.createdAt))
    const page =
      input.limit === undefined
        ? await orderedRows.offset(offset)
        : await orderedRows.limit(input.limit).offset(offset)
    return {
      records: await hydrateRows(db, orgId, page),
      totalCount: counted?.count ?? 0,
      groupLabelsByRecordId: {},
      groups: [],
    }
  }

  const rows = await db
    .select()
    .from(recordsTable)
    .where(where)
    .orderBy(asc(recordsTable.rank), asc(recordsTable.createdAt))

  const records = await hydrateRows(db, orgId, rows)
  const processed = processSavedView(records, definitions, definition)

  let ordered = processed.records
  let groupLabelsByRecordId: Record<string, string> = {}
  if (definition.groups.length) {
    const flattened = flattenSavedViewGroups(processed.groups)
    ordered = flattened.records
    groupLabelsByRecordId = flattened.labelsByRecordId
  }

  const totalCount = ordered.length
  const limited =
    input.limit === undefined ? ordered.slice(offset) : ordered.slice(offset, offset + input.limit)

  return {
    records: limited,
    totalCount,
    groupLabelsByRecordId,
    groups: processed.groups,
  }
}
