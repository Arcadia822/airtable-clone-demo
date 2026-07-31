import type { Id } from "../../../convex/_generated/dataModel"

export type AssistantSourceKind =
  | "table"
  | "view"
  | "form"
  | "formAnalytics"

export type AssistantReportSource = {
  kind: AssistantSourceKind
  baseId: Id<"bases">
  tableId?: Id<"tables">
  viewId?: Id<"views">
  formId?: Id<"forms">
  fieldIds: Id<"fields">[]
  recordIds: Id<"records">[]
  queryDescriptions: string[]
}

export type AssistantCitation = {
  href: string
  kind: AssistantSourceKind
  label: string
}

export type AssistantChart = {
  type: "bar" | "line"
  title: string
  xLabel: string
  yLabel: string
  data: Array<{
    label: string
    value: number
  }>
}

type SourceEntity = {
  id: string
  name: string
}

type AssistantSource = {
  kind: AssistantSourceKind
  base: SourceEntity
  table?: SourceEntity
  view?: SourceEntity
  form?: SourceEntity
  fields: SourceEntity[]
  records: SourceEntity[]
  query?: {
    description: string
    kind: "recordList" | "tableSummary" | "formAnalytics"
    rowLimit: number
  }
}

type DynamicToolPart = {
  input?: unknown
  output?: unknown
  state?: string
  toolName?: string
  type?: string
}

export function assistantCitationFromToolPart(
  part: unknown,
): AssistantCitation | undefined {
  return assistantCitationsFromToolPart(part)[0]
}

export function assistantCitationsFromToolPart(
  part: unknown,
): AssistantCitation[] {
  const toolPart = dynamicToolPart(part)
  const source = toolPart ? sourceFromOutput(toolPart.output) : undefined
  if (!source) return []

  const citations: AssistantCitation[] = []
  if (source.kind === "view" && source.table && source.view) {
    citations.push({
      href: tableSourceHref(source),
      kind: source.kind,
      label: source.query
        ? `Query · ${source.query.description}`
        : `View · ${source.view.name} in ${source.table.name}`,
    })
  } else if (source.kind === "table" && source.table) {
    citations.push({
      href: tableSourceHref(source),
      kind: source.kind,
      label: source.query
        ? `Query · ${source.query.description}`
        : `Table · ${source.table.name}`,
    })
  } else if (
    (source.kind === "form" || source.kind === "formAnalytics") &&
    source.form
  ) {
    citations.push({
      href: `/bases/${routeSegment(source.base.id)}/forms/${routeSegment(
        source.form.id,
      )}${source.kind === "formAnalytics" ? "/analytics" : ""}`,
      kind: source.kind,
      label:
        source.query
          ? `Query · ${source.query.description}`
          : source.kind === "formAnalytics"
          ? `Form analytics · ${source.form.name}`
          : `Form · ${source.form.name}`,
    })
  }

  if (source.table) {
    citations.push(
      ...source.records.map((record) => ({
        href: tableSourceHref(source, record.id),
        kind: source.kind,
        label: `Record · ${record.name}`,
      })),
    )
  }
  return citations
}

export function assistantReportSourceFromToolPart(
  part: unknown,
): AssistantReportSource | undefined {
  const toolPart = dynamicToolPart(part)
  const source = toolPart ? sourceFromOutput(toolPart.output) : undefined
  if (!source) return undefined

  return {
    kind: source.kind,
    baseId: source.base.id as Id<"bases">,
    ...(source.table
      ? { tableId: source.table.id as Id<"tables"> }
      : {}),
    ...(source.view ? { viewId: source.view.id as Id<"views"> } : {}),
    ...(source.form ? { formId: source.form.id as Id<"forms"> } : {}),
    fieldIds: source.fields.map((field) => field.id as Id<"fields">),
    recordIds: source.records.map((record) => record.id as Id<"records">),
    queryDescriptions: source.query ? [source.query.description] : [],
  }
}

export function assistantChartFromToolPart(
  part: unknown,
): AssistantChart | undefined {
  const toolPart = dynamicToolPart(part)
  if (!toolPart || toolPart.state !== "output-available") return undefined
  const source = sourceFromOutput(toolPart.output)
  const output = objectValue(toolPart.output)
  if (!source || !output) return undefined

  if (toolPart.toolName === "form_analytics" && source.form) {
    const series = arrayValue(output.series)
      ?.map((row) => {
        const item = objectValue(row)
        return chartPoint(item?.date, item?.submissions)
      })
      .filter(isChartPoint)
    if (series?.length) {
      return {
        type: "line",
        title: `${source.form.name} submissions`,
        xLabel: "Date",
        yLabel: "Submissions",
        data: series.slice(0, 90),
      }
    }
  }

  if (toolPart.toolName !== "summarize_table" || !source.table) {
    return undefined
  }

  const input = objectValue(toolPart.input)
  const groupByFieldId =
    typeof input?.groupByFieldId === "string"
      ? input.groupByFieldId
      : undefined
  const grouped = arrayValue(output.grouped)
    ?.map((row) => {
      const item = objectValue(row)
      return chartPoint(item?.group, item?.count)
    })
    .filter(isChartPoint)
  if (grouped?.length) {
    const groupName = source.fields.find(
      (field) => field.id === groupByFieldId,
    )?.name
    return {
      type: "bar",
      title: groupName
        ? `${source.table.name} by ${groupName}`
        : `${source.table.name} groups`,
      xLabel: groupName ?? "Group",
      yLabel: "Records",
      data: grouped.slice(0, 20),
    }
  }

  const summaries = arrayValue(output.summaries)
  for (const summary of summaries ?? []) {
    const item = objectValue(summary)
    const topValues = arrayValue(item?.topValues)
      ?.map((row) => {
        const value = objectValue(row)
        return chartPoint(value?.value, value?.count)
      })
      .filter(isChartPoint)
    const fieldName =
      typeof item?.fieldName === "string" ? item.fieldName.trim() : ""
    if (topValues?.length && fieldName) {
      return {
        type: "bar",
        title: `${fieldName} values`,
        xLabel: fieldName,
        yLabel: "Records",
        data: topValues.slice(0, 20),
      }
    }
  }

  const averages = (summaries ?? [])
    .map((summary) => {
      const item = objectValue(summary)
      return chartPoint(item?.fieldName, item?.average)
    })
    .filter(isChartPoint)
  if (averages.length) {
    return {
      type: "bar",
      title: `${source.table.name} averages`,
      xLabel: "Column",
      yLabel: "Average",
      data: averages.slice(0, 10),
    }
  }
  return undefined
}

export function collectAssistantReportSources(
  messages: readonly unknown[],
): AssistantReportSource[] {
  const byResource = new Map<string, AssistantReportSource>()
  for (const message of messages) {
    const parts = arrayValue(objectValue(message)?.parts) ?? []
    for (const part of parts) {
      const source = assistantReportSourceFromToolPart(part)
      if (!source) continue
      const key = [
        source.kind,
        source.baseId,
        source.tableId,
        source.viewId,
        source.formId,
      ].join(":")
      const existing = byResource.get(key)
      byResource.set(key, {
        ...source,
        fieldIds: [
          ...new Set([...(existing?.fieldIds ?? []), ...source.fieldIds]),
        ],
        recordIds: [
          ...new Set([...(existing?.recordIds ?? []), ...source.recordIds]),
        ].slice(0, 50),
        queryDescriptions: [
          ...new Set([
            ...(existing?.queryDescriptions ?? []),
            ...source.queryDescriptions,
          ]),
        ].slice(0, 12),
      })
    }
  }
  return [...byResource.values()].slice(0, 12)
}

export function latestAssistantChart(
  messages: readonly unknown[],
): AssistantChart | undefined {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const parts = arrayValue(objectValue(messages[messageIndex])?.parts) ?? []
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const chart = assistantChartFromToolPart(parts[partIndex])
      if (chart) return chart
    }
  }
  return undefined
}

function dynamicToolPart(value: unknown): DynamicToolPart | undefined {
  const part = objectValue(value)
  return part?.type === "dynamic-tool" &&
    typeof part.toolName === "string" &&
    part.state === "output-available"
    ? (part as DynamicToolPart)
    : undefined
}

function sourceFromOutput(value: unknown): AssistantSource | undefined {
  const source = objectValue(objectValue(value)?.source)
  const kind = source?.kind
  const base = sourceEntity(source?.base)
  const table = sourceEntity(source?.table)
  const view = sourceEntity(source?.view)
  const form = sourceEntity(source?.form)
  const fields = (arrayValue(source?.fields) ?? [])
    .map(sourceEntity)
    .filter((field): field is SourceEntity => Boolean(field))
  const records = (arrayValue(source?.records) ?? [])
    .map(sourceEntity)
    .filter((record): record is SourceEntity => Boolean(record))
    .slice(0, 50)
  const query = sourceQuery(source?.query)
  if (
    !base ||
    (kind !== "table" &&
      kind !== "view" &&
      kind !== "form" &&
      kind !== "formAnalytics")
  ) {
    return undefined
  }
  if (kind === "table" && !table) return undefined
  if (kind === "view" && (!table || !view)) return undefined
  if ((kind === "form" || kind === "formAnalytics") && !form) {
    return undefined
  }
  return {
    kind,
    base,
    ...(table ? { table } : {}),
    ...(view ? { view } : {}),
    ...(form ? { form } : {}),
    fields,
    records,
    ...(query ? { query } : {}),
  }
}

function sourceQuery(value: unknown): AssistantSource["query"] | undefined {
  const query = objectValue(value)
  if (
    (query?.kind !== "recordList" &&
      query?.kind !== "tableSummary" &&
      query?.kind !== "formAnalytics") ||
    typeof query.description !== "string" ||
    !query.description.trim() ||
    typeof query.rowLimit !== "number" ||
    !Number.isInteger(query.rowLimit) ||
    query.rowLimit < 1 ||
    query.rowLimit > 6_000
  ) {
    return undefined
  }
  return {
    kind: query.kind,
    description: query.description.trim().slice(0, 500),
    rowLimit: query.rowLimit,
  }
}

function tableSourceHref(
  source: AssistantSource,
  recordId?: string,
): string {
  if (!source.table) return `/bases/${routeSegment(source.base.id)}`
  const pathname = `/bases/${routeSegment(
    source.base.id,
  )}/tables/${routeSegment(source.table.id)}`
  const params = new URLSearchParams()
  if (source.view) params.set("view", source.view.id)
  if (recordId) params.set("record", recordId)
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

function sourceEntity(value: unknown): SourceEntity | undefined {
  const entity = objectValue(value)
  if (
    typeof entity?.id !== "string" ||
    !entity.id.trim() ||
    typeof entity.name !== "string" ||
    !entity.name.trim()
  ) {
    return undefined
  }
  return {
    id: entity.id,
    name: entity.name.trim().slice(0, 240),
  }
}

function chartPoint(label: unknown, value: unknown) {
  const readable = chartLabel(label)
  return readable &&
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? { label: readable, value }
    : undefined
}

function chartLabel(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim().slice(0, 120)
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat().format(value)
  }
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (value === null) return "No value"
  return undefined
}

function isChartPoint(
  value: { label: string; value: number } | undefined,
): value is { label: string; value: number } {
  return value !== undefined
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function routeSegment(value: string): string {
  return encodeURIComponent(value)
}
