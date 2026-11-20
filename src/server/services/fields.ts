import { and, asc, eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { z } from "zod"

import {
  fieldSequences,
  fields as fieldsTable,
  records as recordsTable,
} from "../../../drizzle/schema"
import type { AppDb } from "@/db/client"
import { AppError, type FieldConfig, type FieldDefinition, type FieldType } from "@/lib/domain"
import { buildRecordSearchText } from "@/server/search-text"

import {
  allocateSequenceValues,
  defaultFieldWidth,
  fieldInputSchema,
  fieldRowToDefinition,
  listActiveFields,
  nextRank,
  normalizeFieldConfig,
  requireTable,
  type FieldRow,
} from "@/server/services/tables"

export const updateFieldInputSchema = z.object({
  name: z.string().trim().min(1, "Field name is required.").max(80).optional(),
  config: z
    .object({
      maxLength: z.number().int().positive().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      precision: z.number().int().optional(),
      currency: z.string().trim().min(1).max(8).optional(),
      dateStyle: z.enum(["date", "dateTime"]).optional(),
      includeTime: z.boolean().optional(),
      attachmentKind: z.enum(["image", "file", "any"]).optional(),
      options: z
        .array(
          z.object({
            id: z.string().trim().min(1).max(80),
            label: z.string().trim().min(1).max(200),
            color: z.string().trim().min(1).max(32),
          }),
        )
        .optional(),
      archivedOptions: z
        .array(
          z.object({
            id: z.string().trim().min(1).max(80),
            label: z.string().trim().min(1).max(200),
            color: z.string().trim().min(1).max(32),
          }),
        )
        .optional(),
    })
    .catchall(z.unknown())
    .optional(),
  width: z.number().int().min(64).max(1_200).optional(),
  rank: z.string().trim().min(1).max(64).optional(),
  frozen: z.boolean().optional(),
})

export async function requireActiveField(
  db: AppDb,
  orgId: string,
  fieldId: string,
): Promise<FieldRow> {
  const [row] = await db
    .select()
    .from(fieldsTable)
    .where(
      and(
        eq(fieldsTable.id, fieldId),
        eq(fieldsTable.orgId, orgId),
        eq(fieldsTable.status, "active"),
      ),
    )
    .limit(1)
  if (!row) throw new AppError("NOT_FOUND", "Field not found.")
  return row
}

/** Rebuilds denormalized `search_text` for every active record in a table. */
export async function rebuildTableSearchText(
  db: AppDb,
  orgId: string,
  tableId: string,
  fieldRows?: readonly FieldRow[],
): Promise<number> {
  const activeFields = fieldRows ?? (await listActiveFields(db, orgId, tableId))
  const definitions = activeFields.map(fieldRowToDefinition)
  const recordRows = await db
    .select()
    .from(recordsTable)
    .where(
      and(
        eq(recordsTable.orgId, orgId),
        eq(recordsTable.tableId, tableId),
        eq(recordsTable.status, "active"),
      ),
    )
    .orderBy(asc(recordsTable.rank))

  let touched = 0
  for (const record of recordRows) {
    const searchText = buildRecordSearchText(record.values ?? {}, definitions)
    if (searchText === record.searchText) continue
    await db
      .update(recordsTable)
      .set({ searchText })
      .where(eq(recordsTable.id, record.id))
    touched += 1
  }
  return touched
}

function selectLabels(config: FieldConfig): string {
  return (config.options ?? [])
    .map((option) => `${option.id}:${option.label}`)
    .sort()
    .join("|")
}

/**
 * Adds an online custom column. Auto-number columns get a sequence row and
 * backfill active records in rank order so the grid is immediately coherent.
 */
export async function createField(
  db: AppDb,
  orgId: string,
  tableId: string,
  rawInput: unknown,
): Promise<{ field: FieldDefinition }> {
  await requireTable(db, orgId, tableId)
  const input = fieldInputSchema.parse(rawInput)
  const type = input.type as FieldType
  const config = normalizeFieldConfig(type, input.config)
  const existing = await listActiveFields(db, orgId, tableId)
  const fieldId = `fld_${nanoid(10)}`
  const rank = nextRank(existing.map((row) => row.rank))
  const width = input.width ?? defaultFieldWidth(type)

  await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as AppDb
    await tx.insert(fieldsTable).values({
      id: fieldId,
      orgId,
      tableId,
      name: input.name,
      type,
      config: config as Record<string, unknown>,
      rank,
      width,
      isPrimary: false,
      frozen: false,
      status: "active",
    })

    if (type === "autoNumber") {
      await tx.insert(fieldSequences).values({ fieldId, tableId, nextValue: 1 })
      await backfillAutoNumber(tx, orgId, tableId, fieldId)
    }
  })

  const [row] = await db
    .select()
    .from(fieldsTable)
    .where(and(eq(fieldsTable.id, fieldId), eq(fieldsTable.orgId, orgId)))
    .limit(1)
  if (!row) throw new AppError("NOT_FOUND", "Field not found.")
  return { field: fieldRowToDefinition(row) }
}

/**
 * Backfills an existing auto-number column in rank order. Runs inside the
 * caller's transaction and reserves the whole backfill range with one atomic
 * sequence update, so no counter is ever handed out twice.
 *
 * Only `updatedAt` moves: a backfill is not a user edit, so in-flight
 * optimistic writes keep their revision and never see a false conflict.
 */
async function backfillAutoNumber(
  db: AppDb,
  orgId: string,
  tableId: string,
  fieldId: string,
): Promise<void> {
  const fieldRows = await listActiveFields(db, orgId, tableId)
  const definitions = fieldRows.map(fieldRowToDefinition)
  const recordRows = await db
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

  const assigned = await allocateSequenceValues(db, tableId, [fieldId], recordRows.length)
  let counter = assigned[fieldId] ?? 1
  for (const record of recordRows) {
    const values = { ...(record.values ?? {}), [fieldId]: counter }
    counter += 1
    await db
      .update(recordsTable)
      .set({
        values,
        searchText: buildRecordSearchText(values, definitions),
        updatedAt: new Date(),
      })
      .where(and(eq(recordsTable.id, record.id), eq(recordsTable.orgId, orgId)))
  }
}

export async function updateField(
  db: AppDb,
  orgId: string,
  fieldId: string,
  rawInput: unknown,
): Promise<{ field: FieldDefinition }> {
  const field = await requireActiveField(db, orgId, fieldId)
  const input = updateFieldInputSchema.parse(rawInput)
  const type = field.type as FieldType

  let nextConfig: FieldConfig | undefined
  if (input.config !== undefined) {
    nextConfig = normalizeFieldConfig(type, {
      ...((field.config ?? {}) as FieldConfig),
      ...input.config,
    })
  }

  const [updated] = await db
    .update(fieldsTable)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(nextConfig ? { config: nextConfig as Record<string, unknown> } : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.rank !== undefined ? { rank: input.rank } : {}),
      ...(input.frozen !== undefined ? { frozen: input.frozen } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(fieldsTable.id, field.id), eq(fieldsTable.orgId, orgId)))
    .returning()

  const labelsChanged =
    nextConfig !== undefined &&
    (type === "singleSelect" || type === "multiSelect") &&
    selectLabels(nextConfig) !== selectLabels((field.config ?? {}) as FieldConfig)

  if (labelsChanged) {
    await rebuildTableSearchText(db, orgId, field.tableId)
  }

  return { field: fieldRowToDefinition(updated ?? field) }
}

export async function deleteField(db: AppDb, orgId: string, fieldId: string) {
  const field = await requireActiveField(db, orgId, fieldId)
  if (field.isPrimary) {
    throw new AppError("VALIDATION_ERROR", "The primary field cannot be deleted.")
  }
  await db
    .update(fieldsTable)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(fieldsTable.id, field.id), eq(fieldsTable.orgId, orgId)))
  await rebuildTableSearchText(db, orgId, field.tableId)
  return { ok: true as const, fieldId: field.id }
}

export async function restoreField(
  db: AppDb,
  orgId: string,
  fieldId: string,
): Promise<{ field: FieldDefinition }> {
  const [field] = await db
    .select()
    .from(fieldsTable)
    .where(and(eq(fieldsTable.id, fieldId), eq(fieldsTable.orgId, orgId)))
    .limit(1)
  if (!field) throw new AppError("NOT_FOUND", "Field not found.")
  await requireTable(db, orgId, field.tableId)

  if (field.type === "autoNumber") {
    const [sequence] = await db
      .select({ fieldId: fieldSequences.fieldId })
      .from(fieldSequences)
      .where(eq(fieldSequences.fieldId, field.id))
      .limit(1)
    if (!sequence) {
      const recordRows = await db
        .select({ values: recordsTable.values })
        .from(recordsTable)
        .where(
          and(
            eq(recordsTable.orgId, orgId),
            eq(recordsTable.tableId, field.tableId),
            eq(recordsTable.status, "active"),
          ),
        )
      let maxValue = 0
      for (const row of recordRows) {
        const value = (row.values ?? {})[field.id]
        if (typeof value === "number" && Number.isFinite(value) && value > maxValue) {
          maxValue = value
        }
      }
      await db
        .insert(fieldSequences)
        .values({ fieldId: field.id, tableId: field.tableId, nextValue: maxValue + 1 })
    }
  }

  const [updated] = await db
    .update(fieldsTable)
    .set({ status: "active", updatedAt: new Date() })
    .where(and(eq(fieldsTable.id, field.id), eq(fieldsTable.orgId, orgId)))
    .returning()

  await rebuildTableSearchText(db, orgId, field.tableId)

  return { field: fieldRowToDefinition(updated ?? field) }
}
