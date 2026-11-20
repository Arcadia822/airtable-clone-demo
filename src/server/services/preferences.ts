import { and, desc, eq, inArray } from "drizzle-orm"
import { nanoid } from "nanoid"
import { z } from "zod"

import {
  bases,
  forms as formsTable,
  resourcePreferences,
  tables as tablesTable,
  views as viewsTable,
} from "../../../drizzle/schema"
import type { AppDb } from "@/db/client"
import { AppError } from "@/lib/domain"

import { toMillis } from "@/server/services/tables"

export type PreferenceRow = typeof resourcePreferences.$inferSelect

export const preferenceResourceTypes = ["base", "table", "view", "form"] as const
export type PreferenceResourceType = (typeof preferenceResourceTypes)[number]

export interface PreferenceItem {
  id: string
  resourceType: PreferenceResourceType
  resourceId: string
  name: string
  favorited: boolean
  lastOpenedAt: number
}

export const updatePreferenceInputSchema = z.object({
  resourceType: z.enum(preferenceResourceTypes),
  resourceId: z.string().min(1).max(120),
  favorited: z.boolean().optional(),
  lastOpenedAt: z.union([z.string(), z.number()]).optional(),
})

function parseLastOpenedAt(value: string | number | undefined): Date | undefined {
  if (value === undefined) return undefined
  const millis = typeof value === "number" ? value : Date.parse(value)
  if (Number.isNaN(millis)) {
    throw new AppError("VALIDATION_ERROR", "lastOpenedAt must be a valid timestamp.")
  }
  return new Date(millis)
}

async function assertResourceExists(
  db: AppDb,
  orgId: string,
  resourceType: PreferenceResourceType,
  resourceId: string,
): Promise<void> {
  if (resourceType === "base") {
    const [row] = await db
      .select({ id: bases.id })
      .from(bases)
      .where(and(eq(bases.id, resourceId), eq(bases.orgId, orgId)))
      .limit(1)
    if (!row) throw new AppError("NOT_FOUND", "Base not found.")
    return
  }
  if (resourceType === "table") {
    const [row] = await db
      .select({ id: tablesTable.id })
      .from(tablesTable)
      .where(and(eq(tablesTable.id, resourceId), eq(tablesTable.orgId, orgId)))
      .limit(1)
    if (!row) throw new AppError("NOT_FOUND", "Table not found.")
    return
  }
  if (resourceType === "view") {
    const [row] = await db
      .select({ id: viewsTable.id })
      .from(viewsTable)
      .where(and(eq(viewsTable.id, resourceId), eq(viewsTable.orgId, orgId)))
      .limit(1)
    if (!row) throw new AppError("NOT_FOUND", "View not found.")
    return
  }
  const [row] = await db
    .select({ id: formsTable.id })
    .from(formsTable)
    .where(and(eq(formsTable.id, resourceId), eq(formsTable.orgId, orgId)))
    .limit(1)
  if (!row) throw new AppError("NOT_FOUND", "Form not found.")
}

async function resolveNames(
  db: AppDb,
  orgId: string,
  rows: readonly PreferenceRow[],
): Promise<Map<string, string>> {
  const idsByType = new Map<PreferenceResourceType, string[]>()
  for (const row of rows) {
    const type = row.resourceType as PreferenceResourceType
    const list = idsByType.get(type) ?? []
    list.push(row.resourceId)
    idsByType.set(type, list)
  }

  const names = new Map<string, string>()
  const collect = (type: PreferenceResourceType, list: Array<{ id: string; name: string }>) => {
    for (const item of list) names.set(`${type}:${item.id}`, item.name)
  }

  const baseIds = idsByType.get("base") ?? []
  const tableIds = idsByType.get("table") ?? []
  const viewIds = idsByType.get("view") ?? []
  const formIds = idsByType.get("form") ?? []

  const [baseRows, tableRows, viewRows, formRows] = await Promise.all([
    baseIds.length
      ? db
          .select({ id: bases.id, name: bases.name })
          .from(bases)
          .where(and(eq(bases.orgId, orgId), inArray(bases.id, baseIds)))
      : Promise.resolve([]),
    tableIds.length
      ? db
          .select({ id: tablesTable.id, name: tablesTable.name })
          .from(tablesTable)
          .where(and(eq(tablesTable.orgId, orgId), inArray(tablesTable.id, tableIds)))
      : Promise.resolve([]),
    viewIds.length
      ? db
          .select({ id: viewsTable.id, name: viewsTable.name })
          .from(viewsTable)
          .where(and(eq(viewsTable.orgId, orgId), inArray(viewsTable.id, viewIds)))
      : Promise.resolve([]),
    formIds.length
      ? db
          .select({ id: formsTable.id, name: formsTable.name })
          .from(formsTable)
          .where(and(eq(formsTable.orgId, orgId), inArray(formsTable.id, formIds)))
      : Promise.resolve([]),
  ])

  collect("base", baseRows)
  collect("table", tableRows)
  collect("view", viewRows)
  collect("form", formRows)
  return names
}

function toItem(row: PreferenceRow, name: string): PreferenceItem {
  return {
    id: row.id,
    resourceType: row.resourceType as PreferenceResourceType,
    resourceId: row.resourceId,
    name,
    favorited: row.favorited,
    lastOpenedAt: toMillis(row.lastOpenedAt),
  }
}

export interface PreferencesResponse {
  favorites: PreferenceItem[]
  recent: PreferenceItem[]
}

export async function listPreferences(
  db: AppDb,
  orgId: string,
  userId: string,
): Promise<PreferencesResponse> {
  const rows = await db
    .select()
    .from(resourcePreferences)
    .where(
      and(
        eq(resourcePreferences.orgId, orgId),
        eq(resourcePreferences.userId, userId),
      ),
    )
    .orderBy(desc(resourcePreferences.favorited), desc(resourcePreferences.lastOpenedAt))
    .limit(100)

  const names = await resolveNames(db, orgId, rows)
  const items = rows.map((row) =>
    toItem(row, names.get(`${row.resourceType}:${row.resourceId}`) ?? row.resourceId),
  )
  return {
    favorites: items.filter((item) => item.favorited),
    recent: items.filter((item) => !item.favorited),
  }
}

export async function upsertPreference(
  db: AppDb,
  orgId: string,
  userId: string,
  rawInput: unknown,
): Promise<{ preference: PreferenceItem }> {
  const input = updatePreferenceInputSchema.parse(rawInput)
  await assertResourceExists(db, orgId, input.resourceType, input.resourceId)
  const lastOpenedAt = parseLastOpenedAt(input.lastOpenedAt)

  const [existing] = await db
    .select()
    .from(resourcePreferences)
    .where(
      and(
        eq(resourcePreferences.orgId, orgId),
        eq(resourcePreferences.userId, userId),
        eq(resourcePreferences.resourceType, input.resourceType),
        eq(resourcePreferences.resourceId, input.resourceId),
      ),
    )
    .limit(1)

  if (existing) {
    const [updated] = await db
      .update(resourcePreferences)
      .set({
        ...(input.favorited !== undefined ? { favorited: input.favorited } : {}),
        ...(lastOpenedAt ? { lastOpenedAt } : {}),
      })
      .where(eq(resourcePreferences.id, existing.id))
      .returning()
    const names = await resolveNames(db, orgId, [updated])
    return {
      preference: toItem(
        updated,
        names.get(`${updated.resourceType}:${updated.resourceId}`) ?? updated.resourceId,
      ),
    }
  }

  const [inserted] = await db
    .insert(resourcePreferences)
    .values({
      id: `pref_${nanoid(10)}`,
      orgId,
      userId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      favorited: input.favorited ?? false,
      lastOpenedAt: lastOpenedAt ?? new Date(),
    })
    .returning()
  const names = await resolveNames(db, orgId, [inserted])
  return {
    preference: toItem(
      inserted,
      names.get(`${inserted.resourceType}:${inserted.resourceId}`) ?? inserted.resourceId,
    ),
  }
}
