import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { generateKeyBetween } from "jittered-fractional-indexing"
import { nanoid } from "nanoid"
import { z } from "zod"

import {
  bases,
  fields as fieldsTable,
  fieldSequences,
  records as recordsTable,
  tables as tablesTable,
  views as viewsTable,
  viewFieldConfigs as viewFieldConfigsTable,
} from "../../../drizzle/schema"
import type { AppDb } from "@/db/client"
import { validateFieldConfiguration } from "@/lib/cell-validation"
import {
  AppError,
  FIELD_TYPES,
  VIEW_TYPES,
  type CellValue,
  type FieldConfig,
  type FieldDefinition,
  type FieldType,
  type GridRecord,
  type ViewType,
} from "@/lib/domain"

export type TableRow = typeof tablesTable.$inferSelect
export type FieldRow = typeof fieldsTable.$inferSelect
export type ViewRow = typeof viewsTable.$inferSelect
export type ViewFieldConfigRow = typeof viewFieldConfigsTable.$inferSelect

/* -------------------------------------------------------------------------- */
/* Validation primitives                                                      */
/* -------------------------------------------------------------------------- */

export const fieldTypeSchema = z.custom<FieldType>(
  (value) =>
    typeof value === "string" && (FIELD_TYPES as readonly string[]).includes(value),
  "Unknown field type.",
)

export const viewTypeSchema = z.custom<ViewType>(
  (value) =>
    typeof value === "string" && (VIEW_TYPES as readonly string[]).includes(value),
  "Unknown view type.",
)

const selectOptionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(200),
  color: z.string().trim().min(1).max(32),
})

const fieldConfigSchema = z
  .object({
    maxLength: z.number().int().positive().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    precision: z.number().int().optional(),
    currency: z.string().trim().min(1).max(8).optional(),
    dateStyle: z.enum(["date", "dateTime"]).optional(),
    includeTime: z.boolean().optional(),
    attachmentKind: z.enum(["image", "file", "any"]).optional(),
    options: z.array(selectOptionSchema).optional(),
    archivedOptions: z.array(selectOptionSchema).optional(),
  })
  .catchall(z.unknown())

export const fieldInputSchema = z.object({
  name: z.string().trim().min(1, "Field name is required.").max(80),
  type: fieldTypeSchema,
  config: fieldConfigSchema.optional(),
  width: z.number().int().min(64).max(1_200).optional(),
  isPrimary: z.boolean().optional(),
})

export type FieldInput = {
  name: string
  type: FieldType
  config: FieldConfig
  width: number
  isPrimary: boolean
}

const DEFAULT_FIELD_WIDTH: Record<FieldType, number> = {
  singleLineText: 180,
  longText: 280,
  number: 120,
  currency: 140,
  percent: 120,
  rating: 120,
  checkbox: 90,
  date: 150,
  email: 200,
  phone: 160,
  url: 220,
  singleSelect: 160,
  multiSelect: 200,
  attachment: 200,
  image: 180,
  autoNumber: 90,
  createdTime: 160,
  createdBy: 160,
}

export function defaultFieldWidth(type: FieldType): number {
  return DEFAULT_FIELD_WIDTH[type]
}

/**
 * Validates and canonicalizes a field configuration. Select options get
 * trimmed, de-duplicated, and defaulted so `searchText` and view filters can
 * rely on stable option ids/labels.
 */
export function normalizeFieldConfig(
  type: FieldType,
  config: FieldConfig | Record<string, unknown> | undefined,
): FieldConfig {
  const normalized = validateFieldConfiguration(type, (config ?? {}) as FieldConfig)

  if (type === "singleSelect" || type === "multiSelect") {
    const seen = new Set<string>()
    normalized.options = (normalized.options ?? []).map((option) => {
      const id = option.id.trim()
      const label = option.label.trim()
      if (!id || !label) {
        throw new AppError("VALIDATION_ERROR", "Choice options need both an id and a label.")
      }
      if (seen.has(id)) {
        throw new AppError("VALIDATION_ERROR", `Duplicate choice option id "${id}".`)
      }
      seen.add(id)
      return { id, label, color: option.color.trim() || "#64748b" }
    })
  }

  if (type === "attachment" && !normalized.attachmentKind) {
    normalized.attachmentKind = "any"
  }

  return normalized
}

export function normalizeFieldInput(raw: unknown): FieldInput {
  const parsed = fieldInputSchema.parse(raw)
  return {
    name: parsed.name,
    type: parsed.type,
    config: normalizeFieldConfig(parsed.type, parsed.config),
    width: parsed.width ?? DEFAULT_FIELD_WIDTH[parsed.type],
    isPrimary: parsed.isPrimary ?? false,
  }
}

/* -------------------------------------------------------------------------- */
/* Rank + row coercion helpers                                                */
/* -------------------------------------------------------------------------- */

/** Builds the next appended fractional rank after every existing rank. */
export function nextRank(ranks: readonly string[]): string {
  let last: string | null = null
  for (const rank of ranks) {
    if (last === null || rank > last) last = rank
  }
  return generateKeyBetween(last, null)
}

/**
 * Reserves `count` consecutive values for each auto-number field and returns
 * the first reserved value per field. Each reservation is a single atomic
 * `UPDATE ... RETURNING`, so concurrent callers can never receive the same
 * counter.
 */
export async function allocateSequenceValues(
  db: AppDb,
  tableId: string,
  fieldIds: readonly string[],
  count: number,
): Promise<Record<string, number>> {
  const firstValues: Record<string, number> = {}
  for (const fieldId of fieldIds) {
    const [updated] = await db
      .update(fieldSequences)
      .set({ nextValue: sql`${fieldSequences.nextValue} + ${count}` })
      .where(and(eq(fieldSequences.fieldId, fieldId), eq(fieldSequences.tableId, tableId)))
      .returning({ nextValue: fieldSequences.nextValue })

    if (updated) {
      firstValues[fieldId] = updated.nextValue - count
      continue
    }

    await db
      .insert(fieldSequences)
      .values({ fieldId, tableId, nextValue: count + 1 })
      .onConflictDoNothing()

    const [retried] = await db
      .update(fieldSequences)
      .set({ nextValue: sql`${fieldSequences.nextValue} + ${count}` })
      .where(and(eq(fieldSequences.fieldId, fieldId), eq(fieldSequences.tableId, tableId)))
      .returning({ nextValue: fieldSequences.nextValue })
    if (!retried) {
      throw new AppError("VALIDATION_ERROR", "Auto-number sequence is unavailable.")
    }
    firstValues[fieldId] = retried.nextValue - count
  }
  return firstValues
}

export function toMillis(value: Date | string | number | null | undefined): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

export function fieldRowToDefinition(row: FieldRow): FieldDefinition {
  return {
    id: row.id,
    name: row.name,
    type: row.type as FieldType,
    config: (row.config ?? {}) as FieldConfig,
    rank: row.rank,
    width: row.width,
    isPrimary: row.isPrimary,
    frozen: row.frozen,
    isArchived: row.status !== "active",
  }
}

export function recordRowToGridRecord(row: typeof recordsTable.$inferSelect): GridRecord {
  return {
    id: row.id,
    rank: row.rank,
    values: (row.values ?? {}) as Record<string, CellValue>,
    revision: row.revision,
    createdAt: toMillis(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: toMillis(row.updatedAt),
    updatedBy: row.updatedBy,
  }
}

export interface ViewJson {
  id: string
  tableId: string
  name: string
  type: ViewType
  visibility: string
  ownerUserId: string | null
  isDefault: boolean
  rank: string
  filterConjunction: "and" | "or"
  filters: unknown[]
  sorts: unknown[]
  groups: unknown[]
  configuration: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export function viewRowToJson(row: ViewRow): ViewJson {
  return {
    id: row.id,
    tableId: row.tableId,
    name: row.name,
    type: row.type as ViewType,
    visibility: row.visibility,
    ownerUserId: row.ownerUserId,
    isDefault: row.isDefault,
    rank: row.rank,
    filterConjunction: row.filterConjunction === "or" ? "or" : "and",
    filters: row.filters ?? [],
    sorts: row.sorts ?? [],
    groups: row.groups ?? [],
    configuration: row.configuration ?? {},
    createdAt: toMillis(row.createdAt),
    updatedAt: toMillis(row.updatedAt),
  }
}

export interface ViewFieldConfigJson {
  id: string
  viewId: string
  fieldId: string
  hidden: boolean
  frozen: boolean
  width: number | null
  rank: string
  formatting: Record<string, unknown>
}

export function viewFieldConfigRowToJson(row: ViewFieldConfigRow): ViewFieldConfigJson {
  return {
    id: row.id,
    viewId: row.viewId,
    fieldId: row.fieldId,
    hidden: row.hidden,
    frozen: row.frozen,
    width: row.width,
    rank: row.rank,
    formatting: row.formatting ?? {},
  }
}

export interface TableJson {
  id: string
  baseId: string
  name: string
  description: string
  rank: string
  createdAt: number
  updatedAt: number
}

export function tableRowToJson(row: TableRow): TableJson {
  return {
    id: row.id,
    baseId: row.baseId,
    name: row.name,
    description: row.description,
    rank: row.rank,
    createdAt: toMillis(row.createdAt),
    updatedAt: toMillis(row.updatedAt),
  }
}

/* -------------------------------------------------------------------------- */
/* Lookups                                                                    */
/* -------------------------------------------------------------------------- */

export async function requireBase(db: AppDb, orgId: string, baseId: string) {
  const [row] = await db
    .select()
    .from(bases)
    .where(and(eq(bases.id, baseId), eq(bases.orgId, orgId), eq(bases.status, "active")))
    .limit(1)
  if (!row) throw new AppError("NOT_FOUND", "Base not found.")
  return row
}

export async function requireTable(db: AppDb, orgId: string, tableId: string) {
  const [row] = await db
    .select()
    .from(tablesTable)
    .where(
      and(
        eq(tablesTable.id, tableId),
        eq(tablesTable.orgId, orgId),
        eq(tablesTable.status, "active"),
      ),
    )
    .limit(1)
  if (!row) throw new AppError("NOT_FOUND", "Table not found.")
  return row
}

export async function listActiveFields(
  db: AppDb,
  orgId: string,
  tableId: string,
): Promise<FieldRow[]> {
  return db
    .select()
    .from(fieldsTable)
    .where(
      and(
        eq(fieldsTable.orgId, orgId),
        eq(fieldsTable.tableId, tableId),
        eq(fieldsTable.status, "active"),
      ),
    )
    .orderBy(asc(fieldsTable.rank), asc(fieldsTable.createdAt), asc(fieldsTable.id))
}

export async function listActiveViews(
  db: AppDb,
  orgId: string,
  tableId: string,
): Promise<ViewRow[]> {
  return db
    .select()
    .from(viewsTable)
    .where(
      and(
        eq(viewsTable.orgId, orgId),
        eq(viewsTable.tableId, tableId),
        eq(viewsTable.status, "active"),
      ),
    )
    .orderBy(asc(viewsTable.rank), asc(viewsTable.createdAt), asc(viewsTable.id))
}

export interface TableBundle {
  table: TableJson
  fields: FieldDefinition[]
  views: ViewJson[]
  viewFieldConfigs: ViewFieldConfigJson[]
}

export async function getTableBundle(
  db: AppDb,
  orgId: string,
  tableId: string,
): Promise<TableBundle> {
  const table = await requireTable(db, orgId, tableId)
  const [fieldRows, viewRows] = await Promise.all([
    listActiveFields(db, orgId, tableId),
    listActiveViews(db, orgId, tableId),
  ])

  const configRows = viewRows.length
    ? await db
        .select()
        .from(viewFieldConfigsTable)
        .where(
          and(
            eq(viewFieldConfigsTable.orgId, orgId),
            inArray(
              viewFieldConfigsTable.viewId,
              viewRows.map((view) => view.id),
            ),
          ),
        )
        .orderBy(asc(viewFieldConfigsTable.rank))
    : []

  return {
    table: tableRowToJson(table),
    fields: fieldRows.map(fieldRowToDefinition),
    views: viewRows.map(viewRowToJson),
    viewFieldConfigs: configRows.map(viewFieldConfigRowToJson),
  }
}

/* -------------------------------------------------------------------------- */
/* Creation                                                                   */
/* -------------------------------------------------------------------------- */

export const createTableInputSchema = z.object({
  baseId: z.string().min(1),
  name: z.string().trim().min(1, "Table name is required.").max(80),
  description: z.string().max(500).optional(),
  fields: z.array(fieldInputSchema).max(60).optional(),
})

function assignPrimaryField(specs: readonly FieldInput[]): FieldInput[] {
  const explicit = specs.findIndex((spec) => spec.isPrimary)
  if (explicit >= 0) {
    if (specs.filter((spec) => spec.isPrimary).length > 1) {
      throw new AppError("VALIDATION_ERROR", "A table can only have one primary field.")
    }
    return [...specs]
  }
  const textIndex = specs.findIndex(
    (spec) => spec.type === "singleLineText" || spec.type === "longText",
  )
  const primaryIndex = textIndex >= 0 ? textIndex : 0
  return specs.map((spec, index) => ({ ...spec, isPrimary: index === primaryIndex }))
}

export interface CreateTableOptions {
  orgId: string
  userId: string
  baseId: string
  name: string
  description?: string
  fields?: unknown[]
}

/**
 * Creates a table, its fields (defaulting to a primary "Name" text column),
 * any auto-number sequences, and a default grid view in one transaction.
 */
export async function createTableBundle(
  db: AppDb,
  options: CreateTableOptions,
): Promise<TableBundle> {
  const input = createTableInputSchema.parse({
    baseId: options.baseId,
    name: options.name,
    description: options.description,
    fields: options.fields,
  })
  await requireBase(db, options.orgId, input.baseId)

  const rawSpecs = input.fields?.length
    ? input.fields.map((field) => normalizeFieldInput(field))
    : [normalizeFieldInput({ name: "Name", type: "singleLineText", isPrimary: true })]
  const specs = assignPrimaryField(rawSpecs)

  const existingTableRanks = (
    await db
      .select({ rank: tablesTable.rank })
      .from(tablesTable)
      .where(
        and(
          eq(tablesTable.orgId, options.orgId),
          eq(tablesTable.baseId, input.baseId),
          eq(tablesTable.status, "active"),
        ),
      )
  ).map((row) => row.rank)

  const tableId = `tbl_${nanoid(10)}`
  const viewId = `viw_${nanoid(10)}`
  const fieldIds = specs.map(() => `fld_${nanoid(10)}`)
  const fieldRanks: string[] = []
  for (let index = 0; index < specs.length; index += 1) {
    fieldRanks.push(generateKeyBetween(fieldRanks[index - 1] ?? null, null))
  }

  await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as AppDb
    await tx.insert(tablesTable).values({
      id: tableId,
      orgId: options.orgId,
      baseId: input.baseId,
      name: input.name,
      description: input.description ?? "",
      rank: nextRank(existingTableRanks),
      status: "active",
    })

    await tx.insert(fieldsTable).values(
      specs.map((spec, index) => ({
        id: fieldIds[index],
        orgId: options.orgId,
        tableId,
        name: spec.name,
        type: spec.type,
        config: spec.config as Record<string, unknown>,
        rank: fieldRanks[index],
        width: spec.width,
        isPrimary: spec.isPrimary,
        frozen: false,
        status: "active",
      })),
    )

    const sequenceRows = specs.flatMap((spec, index) =>
      spec.type === "autoNumber"
        ? [{ fieldId: fieldIds[index], tableId, nextValue: 1 }]
        : [],
    )
    if (sequenceRows.length) {
      await tx.insert(fieldSequences).values(sequenceRows)
    }

    await tx.insert(viewsTable).values({
      id: viewId,
      orgId: options.orgId,
      tableId,
      name: "Grid view",
      type: "grid",
      visibility: "shared",
      isDefault: true,
      rank: generateKeyBetween(null, null),
      filterConjunction: "and",
      filters: [],
      sorts: [],
      groups: [],
      configuration: { rowHeight: "short" },
      status: "active",
    })
  })

  return getTableBundle(db, options.orgId, tableId)
}

/* -------------------------------------------------------------------------- */
/* Mutation                                                                   */
/* -------------------------------------------------------------------------- */

export const updateTableInputSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  rank: z.string().trim().min(1).max(64).optional(),
})

export async function updateTable(
  db: AppDb,
  orgId: string,
  tableId: string,
  rawInput: unknown,
): Promise<{ table: TableJson }> {
  const table = await requireTable(db, orgId, tableId)
  const input = updateTableInputSchema.parse(rawInput)

  const [updated] = await db
    .update(tablesTable)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.rank !== undefined ? { rank: input.rank } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(tablesTable.id, table.id), eq(tablesTable.orgId, orgId)))
    .returning()

  return { table: tableRowToJson(updated ?? table) }
}

export async function deleteTable(db: AppDb, orgId: string, tableId: string) {
  const table = await requireTable(db, orgId, tableId)
  await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as AppDb
    const now = new Date()
    await tx
      .update(tablesTable)
      .set({ status: "archived", updatedAt: now })
      .where(and(eq(tablesTable.id, table.id), eq(tablesTable.orgId, orgId)))
    await tx
      .update(fieldsTable)
      .set({ status: "archived", updatedAt: now })
      .where(and(eq(fieldsTable.orgId, orgId), eq(fieldsTable.tableId, table.id)))
    await tx
      .update(viewsTable)
      .set({ status: "archived", updatedAt: now })
      .where(and(eq(viewsTable.orgId, orgId), eq(viewsTable.tableId, table.id)))
    await tx
      .update(recordsTable)
      .set({ status: "archived", updatedAt: now })
      .where(and(eq(recordsTable.orgId, orgId), eq(recordsTable.tableId, table.id)))
  })
  return { ok: true as const }
}
