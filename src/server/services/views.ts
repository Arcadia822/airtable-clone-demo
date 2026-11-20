import { and, asc, eq, ne } from "drizzle-orm"
import { nanoid } from "nanoid"
import { z } from "zod"

import {
  fields as fieldsTable,
  viewFieldConfigs as viewFieldConfigsTable,
  views as viewsTable,
} from "../../../drizzle/schema"
import type { AppDb } from "@/db/client"
import { AppError, type FieldDefinition, type ViewType } from "@/lib/domain"
import {
  savedViewFilterSchema,
  savedViewGroupSchema,
  savedViewSortSchema,
} from "@/server/services/records"

import {
  listActiveFields,
  listActiveViews,
  nextRank,
  requireTable,
  viewFieldConfigRowToJson,
  viewRowToJson,
  viewTypeSchema,
  type ViewFieldConfigJson,
  type ViewJson,
} from "@/server/services/tables"

const VIEW_TYPE_LABELS: Record<ViewType, string> = {
  grid: "Grid view",
  kanban: "Kanban view",
  timeline: "Timeline view",
  calendar: "Calendar view",
  gallery: "Gallery view",
  dashboard: "Dashboard",
}

const DATE_FIELD_TYPES = new Set(["date", "createdTime"])

const NUMERIC_FIELD_TYPES: Readonly<Partial<Record<FieldDefinition["type"], true>>> = {
  number: true,
  currency: true,
  percent: true,
  rating: true,
  autoNumber: true,
}

const NUMERIC_AGGREGATES: Readonly<Record<string, true>> = {
  sum: true,
  avg: true,
  min: true,
  max: true,
}

function requireField(
  fieldsById: ReadonlyMap<string, FieldDefinition>,
  fieldId: unknown,
  label: string,
): FieldDefinition {
  if (typeof fieldId !== "string" || !fieldId) {
    throw new AppError("VALIDATION_ERROR", `${label} is required for this view type.`)
  }
  const field = fieldsById.get(fieldId)
  if (!field) {
    throw new AppError("VALIDATION_ERROR", `${label} references an unknown field.`)
  }
  return field
}

const aggregateSchema = z.enum(["count", "populated", "sum", "avg", "min", "max"])

function normalizeDashboardWidgets(
  fieldsById: ReadonlyMap<string, FieldDefinition>,
  rawWidgets: unknown,
): Array<Record<string, unknown>> {
  if (rawWidgets === undefined) return []
  if (!Array.isArray(rawWidgets)) {
    throw new AppError("VALIDATION_ERROR", "Dashboard widgets must be a list.")
  }
  if (rawWidgets.length > 12) {
    throw new AppError("VALIDATION_ERROR", "A dashboard supports at most 12 widgets.")
  }
  const seen = new Set<string>()
  return rawWidgets.map((raw, index) => {
    const widget = z
      .object({
        id: z.string().trim().min(1).max(80),
        kind: z.enum(["metric", "chart"]),
        title: z.string().trim().min(1).max(120),
        fieldId: z.string().min(1).optional(),
        groupByFieldId: z.string().min(1).optional(),
        aggregate: aggregateSchema.optional(),
        chartType: z.enum(["bar", "line", "pie"]).optional(),
        rank: z.string().trim().min(1).max(64).optional(),
      })
      .strict()
      .parse(raw)
    if (seen.has(widget.id)) {
      throw new AppError("VALIDATION_ERROR", `Duplicate dashboard widget "${widget.id}".`)
    }
    seen.add(widget.id)
    const metricField = widget.fieldId
      ? requireField(fieldsById, widget.fieldId, "Widget field")
      : undefined
    if (widget.groupByFieldId) {
      requireField(fieldsById, widget.groupByFieldId, "Widget grouping field")
    }
    if (widget.kind === "chart" && !widget.groupByFieldId) {
      throw new AppError("VALIDATION_ERROR", "Chart widgets need a grouping field.")
    }
    if (widget.aggregate === "populated" && !metricField) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Widget "${widget.title}" needs a field to count populated values.`,
      )
    }
    if (widget.aggregate && NUMERIC_AGGREGATES[widget.aggregate]) {
      if (!metricField) {
        throw new AppError(
          "VALIDATION_ERROR",
          `Widget "${widget.title}" needs a numeric field for the ${widget.aggregate} aggregate.`,
        )
      }
      if (!NUMERIC_FIELD_TYPES[metricField.type]) {
        throw new AppError(
          "VALIDATION_ERROR",
          `Widget "${widget.title}" cannot ${widget.aggregate} ${metricField.name}: that column is not numeric.`,
        )
      }
    }
    return {
      ...widget,
      chartType: widget.kind === "chart" ? (widget.chartType ?? "bar") : undefined,
      rank: widget.rank ?? `a${index.toString(36)}`,
    }
  })
}

/**
 * Enforces the per-type configuration contract so kanban, calendar, timeline,
 * gallery, and dashboard views cannot point at the wrong kind of column.
 */
export function validateViewConfiguration(
  fields: readonly FieldDefinition[],
  type: ViewType,
  rawConfiguration: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const configuration: Record<string, unknown> = { ...(rawConfiguration ?? {}) }
  const fieldsById = new Map(fields.map((field) => [field.id, field]))

  if (type === "kanban") {
    const field = requireField(fieldsById, configuration.kanbanFieldId, "Kanban field")
    if (field.type !== "singleSelect") {
      throw new AppError("VALIDATION_ERROR", "Kanban views need a single select field.")
    }
    const summaryIds = configuration.kanbanSummaryFieldIds
    if (summaryIds !== undefined) {
      if (!Array.isArray(summaryIds)) {
        throw new AppError("VALIDATION_ERROR", "Kanban summary fields must be a list.")
      }
      for (const fieldId of summaryIds) {
        requireField(fieldsById, fieldId, "Kanban summary field")
      }
    }
  }

  if (type === "calendar") {
    const field = requireField(
      fieldsById,
      configuration.calendarDateFieldId,
      "Calendar date field",
    )
    if (!DATE_FIELD_TYPES.has(field.type)) {
      throw new AppError("VALIDATION_ERROR", "Calendar views need a date field.")
    }
    if (
      configuration.calendarDisplay !== undefined &&
      configuration.calendarDisplay !== "month" &&
      configuration.calendarDisplay !== "week"
    ) {
      throw new AppError("VALIDATION_ERROR", "Calendar display must be month or week.")
    }
  }

  if (type === "timeline") {
    const start = requireField(
      fieldsById,
      configuration.timelineStartFieldId,
      "Timeline start field",
    )
    if (!DATE_FIELD_TYPES.has(start.type)) {
      throw new AppError("VALIDATION_ERROR", "Timeline views need a start date field.")
    }
    if (configuration.timelineEndFieldId !== undefined) {
      const end = requireField(
        fieldsById,
        configuration.timelineEndFieldId,
        "Timeline end field",
      )
      if (!DATE_FIELD_TYPES.has(end.type)) {
        throw new AppError("VALIDATION_ERROR", "Timeline end field must be a date field.")
      }
    }
    if (configuration.timelineGroupFieldId !== undefined) {
      requireField(fieldsById, configuration.timelineGroupFieldId, "Timeline group field")
    }
    if (
      configuration.timelineScale !== undefined &&
      !["day", "week", "month"].includes(String(configuration.timelineScale))
    ) {
      throw new AppError("VALIDATION_ERROR", "Timeline scale must be day, week, or month.")
    }
  }

  if (type === "gallery") {
    if (configuration.galleryCoverFieldId !== undefined) {
      const cover = requireField(
        fieldsById,
        configuration.galleryCoverFieldId,
        "Gallery cover field",
      )
      if (cover.type !== "image" && cover.type !== "attachment") {
        throw new AppError("VALIDATION_ERROR", "Gallery covers need an attachment field.")
      }
    }
    if (configuration.gallerySummaryFieldIds !== undefined) {
      if (!Array.isArray(configuration.gallerySummaryFieldIds)) {
        throw new AppError("VALIDATION_ERROR", "Gallery summary fields must be a list.")
      }
      for (const fieldId of configuration.gallerySummaryFieldIds) {
        requireField(fieldsById, fieldId, "Gallery summary field")
      }
    }
  }

  if (type === "dashboard") {
    configuration.dashboardWidgets = normalizeDashboardWidgets(
      fieldsById,
      configuration.dashboardWidgets,
    )
  }

  return configuration
}

/* -------------------------------------------------------------------------- */
/* Create / read                                                              */
/* -------------------------------------------------------------------------- */

export const createViewInputSchema = z.object({
  tableId: z.string().min(1),
  name: z.string().trim().min(1).max(80).optional(),
  type: viewTypeSchema.optional(),
  visibility: z.enum(["shared", "personal"]).optional(),
  ownerUserId: z.string().max(120).optional(),
  isDefault: z.boolean().optional(),
  filterConjunction: z.enum(["and", "or"]).optional(),
  filters: z.array(savedViewFilterSchema).optional(),
  sorts: z.array(savedViewSortSchema).optional(),
  groups: z.array(savedViewGroupSchema).optional(),
  configuration: z.record(z.string(), z.unknown()).optional(),
})

export async function listViews(
  db: AppDb,
  orgId: string,
  tableId?: string,
): Promise<{ views: ViewJson[] }> {
  if (tableId) {
    await requireTable(db, orgId, tableId)
    return { views: (await listActiveViews(db, orgId, tableId)).map(viewRowToJson) }
  }
  const rows = await db
    .select()
    .from(viewsTable)
    .where(and(eq(viewsTable.orgId, orgId), eq(viewsTable.status, "active")))
    .orderBy(asc(viewsTable.rank))
    .limit(500)
  return { views: rows.map(viewRowToJson) }
}

/**
 * Guarantees one active default view per table. Several defaults collapse to
 * the lowest ranked; none promotes the lowest ranked active view. `avoidViewId`
 * is skipped when promoting so clearing a view's default flag hands the flag to
 * a different view instead of immediately restoring it.
 */
async function ensureSingleDefaultView(
  tx: AppDb,
  orgId: string,
  tableId: string,
  avoidViewId?: string,
): Promise<void> {
  const rows = await tx
    .select({ id: viewsTable.id, isDefault: viewsTable.isDefault })
    .from(viewsTable)
    .where(
      and(
        eq(viewsTable.orgId, orgId),
        eq(viewsTable.tableId, tableId),
        eq(viewsTable.status, "active"),
      ),
    )
    .orderBy(asc(viewsTable.rank))
  if (!rows.length) return
  const defaults = rows.filter((row) => row.isDefault)
  if (defaults.length === 1) return
  const keeper =
    defaults.find((row) => row.id !== avoidViewId) ??
    rows.find((row) => row.id !== avoidViewId) ??
    rows[0]
  await tx
    .update(viewsTable)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(
      and(
        eq(viewsTable.orgId, orgId),
        eq(viewsTable.tableId, tableId),
        eq(viewsTable.isDefault, true),
        ne(viewsTable.id, keeper.id),
      ),
    )
  await tx
    .update(viewsTable)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(and(eq(viewsTable.id, keeper.id), eq(viewsTable.orgId, orgId)))
}

export async function createView(
  db: AppDb,
  orgId: string,
  rawInput: unknown,
): Promise<{ view: ViewJson }> {
  const input = createViewInputSchema.parse(rawInput)
  await requireTable(db, orgId, input.tableId)
  const fields = (await listActiveFields(db, orgId, input.tableId)).map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type as FieldDefinition["type"],
    config: row.config as FieldDefinition["config"],
    rank: row.rank,
    width: row.width,
    isPrimary: row.isPrimary,
  }))
  const type = (input.type ?? "grid") as ViewType
  const configuration = validateViewConfiguration(fields, type, input.configuration)

  const existing = await listActiveViews(db, orgId, input.tableId)
  const rank = nextRank(existing.map((row) => row.rank))
  const isDefault = input.isDefault ?? existing.length === 0
  const viewId = `viw_${nanoid(10)}`

  await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as AppDb
    if (isDefault) {
      await tx
        .update(viewsTable)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(viewsTable.orgId, orgId),
            eq(viewsTable.tableId, input.tableId),
            eq(viewsTable.isDefault, true),
          ),
        )
    }
    await tx.insert(viewsTable).values({
      id: viewId,
      orgId,
      tableId: input.tableId,
      name: input.name ?? VIEW_TYPE_LABELS[type],
      type,
      visibility: input.visibility ?? "shared",
      ownerUserId: input.ownerUserId ?? null,
      isDefault,
      rank,
      filterConjunction: input.filterConjunction ?? "and",
      filters: input.filters ?? [],
      sorts: input.sorts ?? [],
      groups: input.groups ?? [],
      configuration,
      status: "active",
    })
    await ensureSingleDefaultView(tx, orgId, input.tableId)
  })

  const [row] = await db
    .select()
    .from(viewsTable)
    .where(and(eq(viewsTable.id, viewId), eq(viewsTable.orgId, orgId)))
    .limit(1)
  return { view: viewRowToJson(row) }
}

export async function requireActiveView(db: AppDb, orgId: string, viewId: string) {
  const [row] = await db
    .select()
    .from(viewsTable)
    .where(
      and(
        eq(viewsTable.id, viewId),
        eq(viewsTable.orgId, orgId),
        eq(viewsTable.status, "active"),
      ),
    )
    .limit(1)
  if (!row) throw new AppError("NOT_FOUND", "View not found.")
  return row
}

export async function getView(
  db: AppDb,
  orgId: string,
  viewId: string,
): Promise<{ view: ViewJson; viewFieldConfigs: ViewFieldConfigJson[] }> {
  const view = await requireActiveView(db, orgId, viewId)
  await requireTable(db, orgId, view.tableId)
  const configs = await db
    .select()
    .from(viewFieldConfigsTable)
    .where(
      and(
        eq(viewFieldConfigsTable.orgId, orgId),
        eq(viewFieldConfigsTable.viewId, view.id),
      ),
    )
    .orderBy(asc(viewFieldConfigsTable.rank))
  return { view: viewRowToJson(view), viewFieldConfigs: configs.map(viewFieldConfigRowToJson) }
}

/* -------------------------------------------------------------------------- */
/* Update / delete                                                            */
/* -------------------------------------------------------------------------- */

export const updateViewInputSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  type: viewTypeSchema.optional(),
  visibility: z.enum(["shared", "personal"]).optional(),
  ownerUserId: z.string().max(120).nullable().optional(),
  isDefault: z.boolean().optional(),
  rank: z.string().trim().min(1).max(64).optional(),
  filterConjunction: z.enum(["and", "or"]).optional(),
  filters: z.array(savedViewFilterSchema).optional(),
  sorts: z.array(savedViewSortSchema).optional(),
  groups: z.array(savedViewGroupSchema).optional(),
  configuration: z.record(z.string(), z.unknown()).optional(),
})

export async function updateView(
  db: AppDb,
  orgId: string,
  viewId: string,
  rawInput: unknown,
): Promise<{ view: ViewJson }> {
  const view = await requireActiveView(db, orgId, viewId)
  const input = updateViewInputSchema.parse(rawInput)
  const fields = (await listActiveFields(db, orgId, view.tableId)).map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type as FieldDefinition["type"],
    config: row.config as FieldDefinition["config"],
    rank: row.rank,
    width: row.width,
    isPrimary: row.isPrimary,
  }))

  const type = (input.type ?? view.type) as ViewType
  const needsValidation = input.configuration !== undefined || input.type !== undefined
  const configuration = needsValidation
    ? validateViewConfiguration(
        fields,
        type,
        input.configuration ?? (view.configuration ?? {}),
      )
    : (view.configuration ?? {})

  await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as AppDb
    if (input.isDefault) {
      await tx
        .update(viewsTable)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(viewsTable.orgId, orgId),
            eq(viewsTable.tableId, view.tableId),
            eq(viewsTable.isDefault, true),
            ne(viewsTable.id, view.id),
          ),
        )
    }
    await tx
      .update(viewsTable)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.type !== undefined ? { type } : {}),
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        ...(input.rank !== undefined ? { rank: input.rank } : {}),
        ...(input.filterConjunction !== undefined
          ? { filterConjunction: input.filterConjunction }
          : {}),
        ...(input.filters !== undefined ? { filters: input.filters } : {}),
        ...(input.sorts !== undefined ? { sorts: input.sorts } : {}),
        ...(input.groups !== undefined ? { groups: input.groups } : {}),
        ...(needsValidation ? { configuration } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(viewsTable.id, view.id), eq(viewsTable.orgId, orgId)))
    await ensureSingleDefaultView(
      tx,
      orgId,
      view.tableId,
      input.isDefault === false ? view.id : undefined,
    )
  })

  const [updated] = await db
    .select()
    .from(viewsTable)
    .where(and(eq(viewsTable.id, view.id), eq(viewsTable.orgId, orgId)))
    .limit(1)
  return { view: viewRowToJson(updated ?? view) }
}

export async function deleteView(db: AppDb, orgId: string, viewId: string) {
  const view = await requireActiveView(db, orgId, viewId)
  await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as AppDb
    await tx
      .update(viewsTable)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(eq(viewsTable.id, view.id), eq(viewsTable.orgId, orgId)))

    await ensureSingleDefaultView(tx, orgId, view.tableId, view.id)
  })
  return { ok: true as const, viewId }
}

/* -------------------------------------------------------------------------- */
/* Per-view field configuration                                               */
/* -------------------------------------------------------------------------- */

export const updateViewFieldConfigInputSchema = z.object({
  hidden: z.boolean().optional(),
  frozen: z.boolean().optional(),
  width: z.number().int().min(48).max(1_200).nullable().optional(),
  rank: z.string().trim().min(1).max(64).optional(),
  formatting: z.record(z.string(), z.unknown()).optional(),
})

export async function upsertViewFieldConfig(
  db: AppDb,
  orgId: string,
  viewId: string,
  fieldId: string,
  rawInput: unknown,
): Promise<{ viewFieldConfig: ViewFieldConfigJson }> {
  const view = await requireActiveView(db, orgId, viewId)
  const input = updateViewFieldConfigInputSchema.parse(rawInput)

  const [field] = await db
    .select()
    .from(fieldsTable)
    .where(
      and(
        eq(fieldsTable.id, fieldId),
        eq(fieldsTable.orgId, orgId),
        eq(fieldsTable.tableId, view.tableId),
        eq(fieldsTable.status, "active"),
      ),
    )
    .limit(1)
  if (!field) throw new AppError("NOT_FOUND", "Field not found.")

  const [existing] = await db
    .select()
    .from(viewFieldConfigsTable)
    .where(
      and(
        eq(viewFieldConfigsTable.orgId, orgId),
        eq(viewFieldConfigsTable.viewId, view.id),
        eq(viewFieldConfigsTable.fieldId, fieldId),
      ),
    )
    .limit(1)

  const siblingConfigs = await db
    .select({ rank: viewFieldConfigsTable.rank })
    .from(viewFieldConfigsTable)
    .where(
      and(
        eq(viewFieldConfigsTable.orgId, orgId),
        eq(viewFieldConfigsTable.viewId, view.id),
      ),
    )

  const rank = input.rank ?? existing?.rank ?? nextRank(siblingConfigs.map((row) => row.rank))
  const width = input.width === undefined ? (existing?.width ?? null) : input.width

  await db
    .insert(viewFieldConfigsTable)
    .values({
      id: `vfc_${nanoid(10)}`,
      orgId,
      viewId: view.id,
      fieldId,
      hidden: input.hidden ?? existing?.hidden ?? false,
      frozen: input.frozen ?? existing?.frozen ?? false,
      width,
      rank,
      formatting: input.formatting ?? existing?.formatting ?? {},
    })
    .onConflictDoUpdate({
      target: [viewFieldConfigsTable.viewId, viewFieldConfigsTable.fieldId],
      set: {
        hidden: input.hidden ?? existing?.hidden ?? false,
        frozen: input.frozen ?? existing?.frozen ?? false,
        width,
        rank,
        formatting: input.formatting ?? existing?.formatting ?? {},
      },
    })

  const [row] = await db
    .select()
    .from(viewFieldConfigsTable)
    .where(
      and(
        eq(viewFieldConfigsTable.orgId, orgId),
        eq(viewFieldConfigsTable.viewId, view.id),
        eq(viewFieldConfigsTable.fieldId, fieldId),
      ),
    )
    .limit(1)
  return { viewFieldConfig: viewFieldConfigRowToJson(row) }
}
