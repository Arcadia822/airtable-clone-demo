import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
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
import type { FieldConfig, FieldDefinition } from "@/lib/domain"

import {
  fieldRowToDefinition,
  toMillis,
  type FieldRow,
} from "@/server/services/tables"

function likePattern(query: string): string {
  const escaped = query
    .trim()
    .toLowerCase()
    .replace(/[\\%_]/g, (match) => `\\${match}`)
  return `%${escaped}%`
}

export interface NameSearchHit {
  id: string
  name: string
  description?: string
  icon?: string
}

export interface GlobalSearchResult {
  bases: Array<NameSearchHit & { color: string }>
  tables: Array<NameSearchHit & { baseId: string; baseName: string }>
  views: Array<NameSearchHit & { baseId: string; tableId: string; type: string }>
  forms: Array<NameSearchHit & { baseId: string; slug: string; status: string }>
}

/** Case-insensitive name search across the workspace navigation surfaces. */
export async function searchWorkspace(
  db: AppDb,
  orgId: string,
  rawQuery: string,
): Promise<GlobalSearchResult> {
  const query = rawQuery.trim()
  if (!query) return { bases: [], tables: [], views: [], forms: [] }
  const pattern = likePattern(query)

  const [baseRows, tableRows, viewRows, formRows] = await Promise.all([
    db
      .select()
      .from(bases)
      .where(
        and(
          eq(bases.orgId, orgId),
          eq(bases.status, "active"),
          sql`lower(${bases.name}) like ${pattern}`,
        ),
      )
      .orderBy(asc(bases.name))
      .limit(10),
    db
      .select({
        id: tablesTable.id,
        name: tablesTable.name,
        description: tablesTable.description,
        baseId: tablesTable.baseId,
        baseName: bases.name,
      })
      .from(tablesTable)
      .innerJoin(bases, and(eq(tablesTable.baseId, bases.id), eq(bases.orgId, orgId)))
      .where(
        and(
          eq(tablesTable.orgId, orgId),
          eq(tablesTable.status, "active"),
          eq(bases.status, "active"),
          sql`lower(${tablesTable.name}) like ${pattern}`,
        ),
      )
      .orderBy(asc(tablesTable.name))
      .limit(10),
    db
      .select({
        id: viewsTable.id,
        name: viewsTable.name,
        type: viewsTable.type,
        tableId: viewsTable.tableId,
        baseId: tablesTable.baseId,
      })
      .from(viewsTable)
      .innerJoin(
        tablesTable,
        and(eq(viewsTable.tableId, tablesTable.id), eq(tablesTable.orgId, orgId)),
      )
      .where(
        and(
          eq(viewsTable.orgId, orgId),
          eq(viewsTable.status, "active"),
          eq(tablesTable.status, "active"),
          sql`lower(${viewsTable.name}) like ${pattern}`,
        ),
      )
      .orderBy(asc(viewsTable.name))
      .limit(10),
    db
      .select()
      .from(formsTable)
      .where(
        and(
          eq(formsTable.orgId, orgId),
          sql`lower(${formsTable.name}) like ${pattern}`,
        ),
      )
      .orderBy(asc(formsTable.name))
      .limit(10),
  ])

  return {
    bases: baseRows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      color: row.color,
    })),
    tables: tableRows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      baseId: row.baseId,
      baseName: row.baseName,
    })),
    views: viewRows.map((row) => ({
      id: row.id,
      name: row.name,
      baseId: row.baseId,
      tableId: row.tableId,
      type: row.type,
    })),
    forms: formRows.map((row) => ({
      id: row.id,
      name: row.name,
      baseId: row.baseId,
      slug: row.slug,
      status: row.status,
    })),
  }
}

export const searchRecordsInputSchema = z.object({
  q: z.string().trim().min(1, "Search query is required.").max(200),
  baseId: z.string().min(1).optional(),
  tableId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

export interface RecordSearchResult {
  recordId: string
  tableId: string
  baseId: string
  tableName: string
  baseName: string
  primaryLabel: string
  snippet: string
  matchedFieldIds: string[]
}

interface FieldText {
  text: string
  matchable: string
}

function optionLabel(config: FieldConfig, optionId: string): string | undefined {
  return config.options?.find((option) => option.id === optionId)?.label
}

function attachmentNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === "object" && item !== null && "name" in item) {
      const name = (item as { name?: unknown }).name
      if (typeof name === "string" && name.trim()) return [name]
    }
    return []
  })
}

function fieldText(
  field: FieldDefinition,
  value: unknown,
  recordCreatedAt: number,
): FieldText | undefined {
  if (field.type === "createdTime") {
    const millis = typeof value === "number" ? value : recordCreatedAt
    if (!millis) return undefined
    const text = new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(millis)
    return { text, matchable: `${text} ${millis}` }
  }
  if (value === null || value === undefined || value === "") return undefined

  if (field.type === "singleSelect" && typeof value === "string") {
    const label = optionLabel(field.config, value)
    return { text: label ?? value, matchable: `${label ?? ""} ${value}` }
  }
  if (field.type === "multiSelect" && Array.isArray(value)) {
    const labels = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => optionLabel(field.config, item) ?? item)
    const text = labels.join(", ")
    return text ? { text, matchable: `${text} ${value.join(" ")}` } : undefined
  }
  if (field.type === "attachment" || field.type === "image") {
    const names = attachmentNames(value)
    return names.length ? { text: names.join(", "), matchable: names.join(" ") } : undefined
  }
  if (field.type === "currency" && typeof value === "number") {
    let formatted = String(value)
    try {
      formatted = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: field.config.currency ?? "USD",
        maximumFractionDigits: field.config.precision ?? 2,
      }).format(value)
    } catch {
      formatted = `${field.config.currency ?? "USD"} ${value}`
    }
    return { text: formatted, matchable: `${formatted} ${value}` }
  }
  if (field.type === "checkbox" && typeof value === "boolean") {
    return { text: value ? "Checked" : "Not checked", matchable: value ? "true checked yes" : "false" }
  }
  if (field.type === "date" && (typeof value === "string" || typeof value === "number")) {
    const parsed = typeof value === "number" ? value : Date.parse(value)
    if (!Number.isNaN(parsed)) {
      return {
        text: new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(parsed),
        matchable: `${value} ${new Date(parsed).toISOString()}`,
      }
    }
  }
  if (Array.isArray(value)) {
    const text = value.filter((item) => typeof item === "string").join(", ")
    return text ? { text, matchable: text } : undefined
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value)
    return { text, matchable: text }
  }
  return undefined
}

function makeSnippet(text: string, term: string, maxLength = 140): string {
  const normalized = text.trim()
  if (normalized.length <= maxLength) return normalized
  const index = normalized.toLowerCase().indexOf(term.toLowerCase())
  if (index < 0) return `${normalized.slice(0, maxLength).trim()}…`
  const padding = Math.max(0, Math.floor((maxLength - term.length) / 2))
  const start = Math.max(0, index - padding)
  const end = Math.min(normalized.length, start + maxLength)
  return `${start > 0 ? "…" : ""}${normalized.slice(start, end).trim()}${end < normalized.length ? "…" : ""}`
}

/**
 * Global record search. Every whitespace-separated token must appear in the
 * denormalized `search_text`, which covers text, select labels, numbers,
 * currency renderings, attachment names, and 2-character CJK words.
 */
export async function searchRecords(
  db: AppDb,
  orgId: string,
  rawInput: unknown,
): Promise<{ results: RecordSearchResult[] }> {
  const input = searchRecordsInputSchema.parse(rawInput)
  const terms = [...new Set(input.q.toLowerCase().split(/\s+/).filter(Boolean))].slice(0, 10)
  if (!terms.length) return { results: [] }

  const conditions = [
    eq(recordsTable.orgId, orgId),
    eq(recordsTable.status, "active"),
    eq(tablesTable.status, "active"),
    eq(bases.status, "active"),
    ...terms.map((term) => sql`position(${term} in ${recordsTable.searchText}) > 0`),
  ]
  if (input.tableId) conditions.push(eq(recordsTable.tableId, input.tableId))
  if (input.baseId) conditions.push(eq(tablesTable.baseId, input.baseId))

  const rows = await db
    .select({
      record: recordsTable,
      tableName: tablesTable.name,
      baseId: bases.id,
      baseName: bases.name,
    })
    .from(recordsTable)
    .innerJoin(
      tablesTable,
      and(eq(recordsTable.tableId, tablesTable.id), eq(tablesTable.orgId, orgId)),
    )
    .innerJoin(bases, and(eq(tablesTable.baseId, bases.id), eq(bases.orgId, orgId)))
    .where(and(...conditions))
    .orderBy(desc(recordsTable.updatedAt))
    .limit(input.limit ?? 20)

  if (!rows.length) return { results: [] }

  const tableIds = [...new Set(rows.map((row) => row.record.tableId))]
  const fieldRows = await db
    .select()
    .from(fieldsTable)
    .where(
      and(
        eq(fieldsTable.orgId, orgId),
        eq(fieldsTable.status, "active"),
        inArray(fieldsTable.tableId, tableIds),
      ),
    )
    .orderBy(asc(fieldsTable.rank), asc(fieldsTable.createdAt))

  const fieldsByTableId = new Map<string, FieldDefinition[]>()
  const fieldRowsByTableId = new Map<string, FieldRow[]>()
  for (const row of fieldRows) {
    const list = fieldRowsByTableId.get(row.tableId) ?? []
    list.push(row)
    fieldRowsByTableId.set(row.tableId, list)
  }
  for (const [tableId, list] of fieldRowsByTableId) {
    fieldsByTableId.set(tableId, list.map(fieldRowToDefinition))
  }

  const results = rows.map((row) => {
    const definitions = fieldsByTableId.get(row.record.tableId) ?? []
    const values = (row.record.values ?? {}) as Record<string, unknown>
    const createdAt = toMillis(row.record.createdAt)
    const matchedFieldIds: string[] = []
    let snippet = ""

    for (const field of definitions) {
      const rendered = fieldText(field, values[field.id], createdAt)
      if (!rendered) continue
      const haystack = rendered.matchable.toLowerCase()
      const hit = terms.find((term) => haystack.includes(term))
      if (!hit) continue
      matchedFieldIds.push(field.id)
      if (!snippet) snippet = makeSnippet(rendered.text, hit)
    }

    const primaryField =
      definitions.find((field) => field.isPrimary) ?? definitions[0]
    const primaryValue = primaryField ? values[primaryField.id] : undefined
    const primaryRendered = primaryField
      ? fieldText(primaryField, primaryValue, createdAt)?.text
      : undefined
    const primaryLabel = (primaryRendered ?? "").trim() || "Untitled record"

    return {
      recordId: row.record.id,
      tableId: row.record.tableId,
      baseId: row.baseId,
      tableName: row.tableName,
      baseName: row.baseName,
      primaryLabel,
      snippet:
        snippet || makeSnippet((row.record.searchText ?? "").trim(), terms[0]),
      matchedFieldIds,
    }
  })

  return { results }
}
