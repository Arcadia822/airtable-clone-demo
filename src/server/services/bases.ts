import { and, asc, count, eq, inArray } from "drizzle-orm"
import { nanoid } from "nanoid"
import { z } from "zod"

import {
  bases,
  fields as fieldsTable,
  forms as formsTable,
  records as recordsTable,
  tables as tablesTable,
  views as viewsTable,
} from "../../../drizzle/schema"
import type { AppDb } from "@/db/client"
import { ensureSeededBase } from "@/db/seed"
import {
  createTableBundle,
  nextRank,
  requireBase,
  tableRowToJson,
  toMillis,
  type TableBundle,
  type TableJson,
} from "@/server/services/tables"

export type BaseRow = typeof bases.$inferSelect

export interface BaseJson {
  id: string
  name: string
  description: string
  color: string
  rank: string
  createdAt: number
  updatedAt: number
}

export function baseRowToJson(row: BaseRow): BaseJson {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    rank: row.rank,
    createdAt: toMillis(row.createdAt),
    updatedAt: toMillis(row.updatedAt),
  }
}

export interface BaseListItem extends BaseJson {
  tableCount: number
  recordCount: number
  tables: Array<{ id: string; baseId: string; name: string; rank: string }>
}

const colorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value such as #2563eb.")

export const createBaseInputSchema = z.object({
  name: z.string().trim().min(1, "Base name is required.").max(80),
  description: z.string().max(500).optional(),
  color: colorSchema.optional(),
  tableName: z.string().trim().min(1).max(80).optional(),
})

export const updateBaseInputSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  color: colorSchema.optional(),
  rank: z.string().trim().min(1).max(64).optional(),
})

/**
 * Lists active bases for the organization, seeding the demo workspace the first
 * time an organization opens the product.
 */
export async function listBases(
  db: AppDb,
  orgId: string,
  userId: string,
): Promise<{ bases: BaseListItem[] }> {
  const existing = await db
    .select({ id: bases.id })
    .from(bases)
    .where(and(eq(bases.orgId, orgId), eq(bases.status, "active")))
    .limit(1)
  if (!existing.length) {
    await ensureSeededBase(db, orgId, userId)
  }

  const baseRows = await db
    .select()
    .from(bases)
    .where(and(eq(bases.orgId, orgId), eq(bases.status, "active")))
    .orderBy(asc(bases.rank), asc(bases.createdAt))

  const baseIds = baseRows.map((row) => row.id)
  if (!baseIds.length) return { bases: [] }

  const tableRows = await db
    .select()
    .from(tablesTable)
    .where(
      and(
        eq(tablesTable.orgId, orgId),
        eq(tablesTable.status, "active"),
        inArray(tablesTable.baseId, baseIds),
      ),
    )
    .orderBy(asc(tablesTable.rank))

  const tableIds = tableRows.map((row) => row.id)
  const recordCounts = tableIds.length
    ? await db
        .select({ tableId: recordsTable.tableId, total: count() })
        .from(recordsTable)
        .where(
          and(
            eq(recordsTable.orgId, orgId),
            eq(recordsTable.status, "active"),
            inArray(recordsTable.tableId, tableIds),
          ),
        )
        .groupBy(recordsTable.tableId)
    : []
  const recordCountByTableId = new Map(
    recordCounts.map((row) => [row.tableId, Number(row.total)]),
  )

  return {
    bases: baseRows.map((row) => {
      const tables = tableRows.filter((table) => table.baseId === row.id)
      return {
        ...baseRowToJson(row),
        tableCount: tables.length,
        recordCount: tables.reduce(
          (total, table) => total + (recordCountByTableId.get(table.id) ?? 0),
          0,
        ),
        tables: tables.map((table) => ({
          id: table.id,
          baseId: table.baseId,
          name: table.name,
          rank: table.rank,
        })),
      }
    }),
  }
}

export interface CreateBaseResult {
  base: BaseJson
  table: TableJson
  fields: TableBundle["fields"]
  views: TableBundle["views"]
}

export async function createBase(
  db: AppDb,
  orgId: string,
  userId: string,
  rawInput: unknown,
): Promise<CreateBaseResult> {
  const input = createBaseInputSchema.parse(rawInput)
  const existingRanks = (
    await db
      .select({ rank: bases.rank })
      .from(bases)
      .where(and(eq(bases.orgId, orgId), eq(bases.status, "active")))
  ).map((row) => row.rank)

  const baseId = `base_${nanoid(10)}`
  const [row] = await db
    .insert(bases)
    .values({
      id: baseId,
      orgId,
      name: input.name,
      description: input.description ?? "",
      color: input.color ?? "#2563eb",
      rank: nextRank(existingRanks),
      status: "active",
      createdBy: userId,
    })
    .returning()

  const bundle = await createTableBundle(db, {
    orgId,
    userId,
    baseId,
    name: input.tableName ?? "Table 1",
  })

  return {
    base: baseRowToJson(row),
    table: bundle.table,
    fields: bundle.fields,
    views: bundle.views,
  }
}

export interface BaseDetail {
  base: BaseJson
  tables: TableJson[]
}

export async function getBase(
  db: AppDb,
  orgId: string,
  baseId: string,
): Promise<BaseDetail> {
  const base = await requireBase(db, orgId, baseId)
  const tableRows = await db
    .select()
    .from(tablesTable)
    .where(
      and(
        eq(tablesTable.orgId, orgId),
        eq(tablesTable.baseId, base.id),
        eq(tablesTable.status, "active"),
      ),
    )
    .orderBy(asc(tablesTable.rank), asc(tablesTable.createdAt))
  return { base: baseRowToJson(base), tables: tableRows.map(tableRowToJson) }
}

export async function updateBase(
  db: AppDb,
  orgId: string,
  baseId: string,
  rawInput: unknown,
): Promise<{ base: BaseJson }> {
  const base = await requireBase(db, orgId, baseId)
  const input = updateBaseInputSchema.parse(rawInput)
  const [updated] = await db
    .update(bases)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.rank !== undefined ? { rank: input.rank } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(bases.id, base.id), eq(bases.orgId, orgId)))
    .returning()
  return { base: baseRowToJson(updated ?? base) }
}

export async function deleteBase(db: AppDb, orgId: string, baseId: string) {
  const base = await requireBase(db, orgId, baseId)
  const tableRows = await db
    .select({ id: tablesTable.id })
    .from(tablesTable)
    .where(and(eq(tablesTable.orgId, orgId), eq(tablesTable.baseId, base.id)))
  const tableIds = tableRows.map((row) => row.id)

  await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as AppDb
    const now = new Date()
    await tx
      .update(bases)
      .set({ status: "archived", updatedAt: now })
      .where(and(eq(bases.id, base.id), eq(bases.orgId, orgId)))
    if (!tableIds.length) return
    await tx
      .update(tablesTable)
      .set({ status: "archived", updatedAt: now })
      .where(and(eq(tablesTable.orgId, orgId), inArray(tablesTable.id, tableIds)))
    await tx
      .update(fieldsTable)
      .set({ status: "archived", updatedAt: now })
      .where(and(eq(fieldsTable.orgId, orgId), inArray(fieldsTable.tableId, tableIds)))
    await tx
      .update(viewsTable)
      .set({ status: "archived", updatedAt: now })
      .where(and(eq(viewsTable.orgId, orgId), inArray(viewsTable.tableId, tableIds)))
    await tx
      .update(recordsTable)
      .set({ status: "archived", updatedAt: now })
      .where(and(eq(recordsTable.orgId, orgId), inArray(recordsTable.tableId, tableIds)))
  })

  return { ok: true as const, baseId }
}

export interface BaseDashboardTable {
  id: string
  name: string
  description: string
  rank: string
  fieldCount: number
  viewCount: number
  recordCount: number
}

export interface BaseDashboard {
  base: BaseJson
  tables: BaseDashboardTable[]
  forms: Array<{ id: string; name: string; slug: string; status: string; tableId: string }>
  counts: { tables: number; views: number; records: number; forms: number }
}

export async function getBaseDashboard(
  db: AppDb,
  orgId: string,
  baseId: string,
): Promise<BaseDashboard> {
  const base = await requireBase(db, orgId, baseId)
  const tableRows = await db
    .select()
    .from(tablesTable)
    .where(
      and(
        eq(tablesTable.orgId, orgId),
        eq(tablesTable.baseId, base.id),
        eq(tablesTable.status, "active"),
      ),
    )
    .orderBy(asc(tablesTable.rank), asc(tablesTable.createdAt))
  const tableIds = tableRows.map((row) => row.id)

  const [fieldCounts, viewCounts, recordCounts, formRows] = await Promise.all([
    tableIds.length
      ? db
          .select({ tableId: fieldsTable.tableId, total: count() })
          .from(fieldsTable)
          .where(
            and(
              eq(fieldsTable.orgId, orgId),
              eq(fieldsTable.status, "active"),
              inArray(fieldsTable.tableId, tableIds),
            ),
          )
          .groupBy(fieldsTable.tableId)
      : Promise.resolve([]),
    tableIds.length
      ? db
          .select({ tableId: viewsTable.tableId, total: count() })
          .from(viewsTable)
          .where(
            and(
              eq(viewsTable.orgId, orgId),
              eq(viewsTable.status, "active"),
              inArray(viewsTable.tableId, tableIds),
            ),
          )
          .groupBy(viewsTable.tableId)
      : Promise.resolve([]),
    tableIds.length
      ? db
          .select({ tableId: recordsTable.tableId, total: count() })
          .from(recordsTable)
          .where(
            and(
              eq(recordsTable.orgId, orgId),
              eq(recordsTable.status, "active"),
              inArray(recordsTable.tableId, tableIds),
            ),
          )
          .groupBy(recordsTable.tableId)
      : Promise.resolve([]),
    db
      .select()
      .from(formsTable)
      .where(and(eq(formsTable.orgId, orgId), eq(formsTable.baseId, base.id)))
      .orderBy(asc(formsTable.createdAt)),
  ])

  const toMap = (rows: ReadonlyArray<{ tableId: string; total: unknown }>) =>
    new Map(rows.map((row) => [row.tableId, Number(row.total)]))
  const fieldMap = toMap(fieldCounts)
  const viewMap = toMap(viewCounts)
  const recordMap = toMap(recordCounts)

  const tables: BaseDashboardTable[] = tableRows.map((table) => ({
    id: table.id,
    name: table.name,
    description: table.description,
    rank: table.rank,
    fieldCount: fieldMap.get(table.id) ?? 0,
    viewCount: viewMap.get(table.id) ?? 0,
    recordCount: recordMap.get(table.id) ?? 0,
  }))

  return {
    base: baseRowToJson(base),
    tables,
    forms: formRows.map((form) => ({
      id: form.id,
      name: form.name,
      slug: form.slug,
      status: form.status,
      tableId: form.tableId,
    })),
    counts: {
      tables: tables.length,
      views: tables.reduce((total, table) => total + table.viewCount, 0),
      records: tables.reduce((total, table) => total + table.recordCount, 0),
      forms: formRows.length,
    },
  }
}
