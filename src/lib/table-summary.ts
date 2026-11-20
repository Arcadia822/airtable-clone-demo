import { calendarDateFromValue } from "@/lib/alternative-view-data"
import type {
  DashboardWidgetConfig,
  FieldDefinition,
  FieldType,
  GridRecord,
} from "@/lib/domain"

export type SummaryAggregate =
  | "count"
  | "populated"
  | "sum"
  | "avg"
  | "min"
  | "max"

export type FieldSummaryTopValue = {
  label: string
  value: string | number | boolean
  count: number
  color?: string
}

export type FieldSummary = {
  count: number
  populatedCount: number
  emptyCount: number
  sum?: number
  avg?: number
  min?: number
  max?: number
  topValues?: FieldSummaryTopValue[]
}

export type GroupedSeriesPoint = {
  label: string
  value: number
  color?: string
}

const NUMERIC_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  "number",
  "currency",
  "percent",
  "rating",
  "autoNumber",
])

const DATE_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  "date",
  "createdTime",
])

const SELECT_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  "singleSelect",
  "multiSelect",
])

const TEXT_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  "singleLineText",
  "longText",
  "email",
  "phone",
  "url",
  "createdBy",
])

const CATEGORICAL_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  ...SELECT_FIELD_TYPES,
  ...TEXT_FIELD_TYPES,
  "checkbox",
])

export const SERIES_COLOR_PALETTE = [
  "#6366F1",
  "#0EA5E9",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#14B8A6",
  "#EC4899",
] as const

const UNASSIGNED_COLOR = "#94A3B8"
const CHECKED_COLOR = "#10B981"
const MAX_TOP_VALUES = 8
const MAX_SERIES_BUCKETS = 12
const MAX_DATE_SERIES_BUCKETS = 24

type Bucket = {
  key: string
  label: string
  value: string | number | boolean
  color?: string
  sort: number
}

function isBlankValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === "string") return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function roundMetric(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Number(value.toFixed(6))
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function findOption(field: FieldDefinition, optionId: string) {
  return (
    field.config.options?.find((option) => option.id === optionId) ??
    field.config.archivedOptions?.find((option) => option.id === optionId)
  )
}

function unassignedBucket(field: FieldDefinition): Bucket {
  if (field.type === "checkbox") {
    return {
      key: "checkbox:false",
      label: "Not checked",
      value: false,
      color: UNASSIGNED_COLOR,
      sort: 1,
    }
  }
  if (DATE_FIELD_TYPES.has(field.type)) {
    return {
      key: "date:none",
      label: "No date",
      value: "",
      color: UNASSIGNED_COLOR,
      sort: Number.POSITIVE_INFINITY,
    }
  }
  return {
    key: "empty",
    label: "Unassigned",
    value: "",
    color: UNASSIGNED_COLOR,
    sort: Number.POSITIVE_INFINITY,
  }
}

/**
 * Splits one record value into the buckets it belongs to. Multi-select fields
 * deliberately contribute to several buckets so a single record can appear in
 * more than one slice of a chart.
 */
function bucketsForValue(
  value: unknown,
  field: FieldDefinition,
): Bucket[] {
  if (field.type === "singleSelect") {
    if (typeof value !== "string" || !value) return [unassignedBucket(field)]
    const option = findOption(field, value)
    if (!option) {
      return [
        {
          key: value,
          label: "Unavailable choice",
          value,
          color: UNASSIGNED_COLOR,
          sort: 0,
        },
      ]
    }
    return [
      {
        key: option.id,
        label: option.label,
        value: option.id,
        color: option.color,
        sort: 0,
      },
    ]
  }

  if (field.type === "multiSelect") {
    const ids = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : []
    const uniqueIds = [...new Set(ids)]
    if (uniqueIds.length === 0) return [unassignedBucket(field)]
    return uniqueIds.map((id) => {
      const option = findOption(field, id)
      return {
        key: id,
        label: option?.label ?? "Unavailable choice",
        value: id,
        color: option?.color ?? UNASSIGNED_COLOR,
        sort: 0,
      }
    })
  }

  if (field.type === "checkbox") {
    return value === true
      ? [
          {
            key: "checkbox:true",
            label: "Checked",
            value: true,
            color: CHECKED_COLOR,
            sort: 0,
          },
        ]
      : [
          {
            key: "checkbox:false",
            label: "Not checked",
            value: false,
            color: UNASSIGNED_COLOR,
            sort: 1,
          },
        ]
  }

  if (DATE_FIELD_TYPES.has(field.type)) {
    const date = calendarDateFromValue(value)
    if (!date) return [unassignedBucket(field)]
    return [
      {
        key: monthKey(date),
        label: monthKey(date),
        value: monthKey(date),
        sort: new Date(date.getFullYear(), date.getMonth(), 1).getTime(),
      },
    ]
  }

  if (NUMERIC_FIELD_TYPES.has(field.type)) {
    const numeric = numericValue(value)
    if (numeric === undefined) {
      return [
        {
          key: "number:none",
          label: "No value",
          value: "",
          color: UNASSIGNED_COLOR,
          sort: Number.POSITIVE_INFINITY,
        },
      ]
    }
    const rounded = roundMetric(numeric)
    return [
      {
        key: `number:${rounded}`,
        label: String(rounded),
        value: rounded,
        sort: rounded,
      },
    ]
  }

  if (field.type === "attachment" || field.type === "image") {
    const count = Array.isArray(value) ? value.length : 0
    return count > 0
      ? [
          {
            key: "files:yes",
            label: "Has files",
            value: true,
            color: SERIES_COLOR_PALETTE[1],
            sort: 0,
          },
        ]
      : [
          {
            key: "files:no",
            label: "No files",
            value: false,
            color: UNASSIGNED_COLOR,
            sort: 1,
          },
        ]
  }

  const text =
    typeof value === "string"
      ? value.trim()
      : value === null || value === undefined
        ? ""
        : String(value).trim()
  if (!text) {
    return [
      {
        key: "text:empty",
        label: "Empty",
        value: "",
        color: UNASSIGNED_COLOR,
        sort: Number.POSITIVE_INFINITY,
      },
    ]
  }
  return [
    {
      key: `text:${text}`,
      label: text,
      value: text,
      sort: 0,
    },
  ]
}

/**
 * Summarises a single column across the visible records: completeness for every
 * type plus numeric aggregates and the most common categorical values.
 */
export function computeFieldSummary(
  records: readonly GridRecord[],
  field: FieldDefinition,
): FieldSummary {
  let populatedCount = 0
  const numbers: number[] = []
  const buckets = new Map<string, FieldSummaryTopValue>()
  const summariseCategorically = CATEGORICAL_FIELD_TYPES.has(field.type)

  for (const record of records) {
    const value = record.values[field.id]
    if (!isBlankValue(value)) populatedCount += 1

    const numeric = NUMERIC_FIELD_TYPES.has(field.type)
      ? numericValue(value)
      : undefined
    if (numeric !== undefined) numbers.push(numeric)

    if (!summariseCategorically) continue
    for (const bucket of bucketsForValue(value, field)) {
      const current = buckets.get(bucket.key)
      if (current) {
        current.count += 1
      } else {
        buckets.set(bucket.key, {
          label: bucket.label,
          value: bucket.value,
          count: 1,
          color: bucket.color,
        })
      }
    }
  }

  const summary: FieldSummary = {
    count: records.length,
    populatedCount,
    emptyCount: records.length - populatedCount,
  }

  if (numbers.length > 0) {
    const sum = numbers.reduce((total, value) => total + value, 0)
    summary.sum = roundMetric(sum)
    summary.avg = roundMetric(sum / numbers.length)
    summary.min = roundMetric(Math.min(...numbers))
    summary.max = roundMetric(Math.max(...numbers))
  }

  if (summariseCategorically) {
    summary.topValues = [...buckets.values()]
      .sort(
        (left, right) =>
          right.count - left.count || left.label.localeCompare(right.label),
      )
      .slice(0, MAX_TOP_VALUES)
  }

  return summary
}

type SeriesEntry = {
  key: string
  label: string
  color?: string
  sort: number
  count: number
  sum: number
  populated: number
  min: number
  max: number
}

function seriesValueFor(
  entry: SeriesEntry,
  aggregate: SummaryAggregate,
  hasMetric: boolean,
): number {
  switch (aggregate) {
    case "populated":
      return hasMetric ? entry.populated : entry.count
    case "sum":
      return entry.sum
    case "avg":
      return entry.populated > 0 ? entry.sum / entry.populated : 0
    case "min":
      return entry.populated > 0 ? entry.min : 0
    case "max":
      return entry.populated > 0 ? entry.max : 0
    default:
      return entry.count
  }
}

function emptySeriesEntry(bucket: Bucket): SeriesEntry {
  return {
    key: bucket.key,
    label: bucket.label,
    color: bucket.color,
    sort: bucket.sort,
    count: 0,
    sum: 0,
    populated: 0,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
  }
}

/**
 * Groups records by a column (choice labels and colours, month keys for dates,
 * checkbox state, or raw text) and reduces a metric inside every group.
 */
export function computeGroupedSeries(
  records: readonly GridRecord[],
  groupByField: FieldDefinition,
  metricField?: FieldDefinition,
  aggregate: SummaryAggregate = "count",
): GroupedSeriesPoint[] {
  if (records.length === 0) return []

  const hasMetric = Boolean(metricField)
  const entries = new Map<string, SeriesEntry>()

  for (const record of records) {
    const value = metricField ? record.values[metricField.id] : undefined
    const numeric = metricField ? numericValue(value) : undefined
    for (const bucket of bucketsForValue(
      record.values[groupByField.id],
      groupByField,
    )) {
      let entry = entries.get(bucket.key)
      if (!entry) {
        entry = emptySeriesEntry(bucket)
        entries.set(bucket.key, entry)
      }
      entry.count += 1
      if (numeric !== undefined) {
        entry.sum += numeric
        entry.populated += 1
        entry.min = Math.min(entry.min, numeric)
        entry.max = Math.max(entry.max, numeric)
      }
    }
  }

  const chronological =
    DATE_FIELD_TYPES.has(groupByField.type) ||
    NUMERIC_FIELD_TYPES.has(groupByField.type)

  const ordered = [...entries.values()].sort((left, right) => {
    if (chronological) return left.sort - right.sort
    const leftValue = seriesValueFor(left, aggregate, hasMetric)
    const rightValue = seriesValueFor(right, aggregate, hasMetric)
    return rightValue - leftValue || left.label.localeCompare(right.label)
  })

  const limit = DATE_FIELD_TYPES.has(groupByField.type)
    ? MAX_DATE_SERIES_BUCKETS
    : MAX_SERIES_BUCKETS

  let visible = ordered
  let overflow: SeriesEntry[] = []
  if (ordered.length > limit) {
    visible = ordered.slice(0, limit - 1)
    overflow = ordered.slice(limit - 1)
  }

  const points: GroupedSeriesPoint[] = visible.map((entry, index) => ({
    label: entry.label,
    value: roundMetric(seriesValueFor(entry, aggregate, hasMetric)),
    color:
      entry.color ??
      SERIES_COLOR_PALETTE[index % SERIES_COLOR_PALETTE.length],
  }))

  if (overflow.length > 0) {
    points.push({
      label: "Other",
      value: roundMetric(
        overflow.reduce(
          (total, entry) =>
            total + seriesValueFor(entry, aggregate, hasMetric),
          0,
        ),
      ),
      color: UNASSIGNED_COLOR,
    })
  }

  return points
}

/**
 * Formats a previously computed numeric summary for display, honouring the
 * column's currency, percent and precision configuration.
 */
export function formatSummaryValue(
  field: FieldDefinition | undefined,
  value: number | undefined,
): string {
  if (value === undefined || !Number.isFinite(value)) return "—"
  if (field?.type === "currency" && field.config.currency) {
    try {
      return new Intl.NumberFormat("en", {
        style: "currency",
        currency: field.config.currency,
        maximumFractionDigits: field.config.precision ?? 2,
      }).format(value)
    } catch {
      return new Intl.NumberFormat("en", {
        maximumFractionDigits: field.config.precision ?? 2,
      }).format(value)
    }
  }
  if (field?.type === "percent") {
    return new Intl.NumberFormat("en", {
      style: "percent",
      maximumFractionDigits: field.config.precision ?? 2,
    }).format(value)
  }
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: field?.config.precision ?? 2,
  }).format(value)
}

function widgetTitleFor(
  aggregate: SummaryAggregate,
  field: FieldDefinition | undefined,
  groupBy: FieldDefinition | undefined,
): string {
  const fieldName = field?.name
  const groupName = groupBy?.name
  if (groupBy && groupName) {
    if (aggregate === "count") return `Records by ${groupName}`
    if (aggregate === "populated") return `${fieldName ?? "Values"} filled by ${groupName}`
    if (aggregate === "avg") return `Average ${fieldName} by ${groupName}`
    if (aggregate === "min") return `Minimum ${fieldName} by ${groupName}`
    if (aggregate === "max") return `Maximum ${fieldName} by ${groupName}`
    return `${fieldName} by ${groupName}`
  }
  if (aggregate === "count" || !fieldName) return "Total records"
  if (aggregate === "populated") return `${fieldName} filled`
  if (aggregate === "avg") return `Average ${fieldName}`
  if (aggregate === "min") return `Minimum ${fieldName}`
  if (aggregate === "max") return `Maximum ${fieldName}`
  return `Total ${fieldName}`
}

/**
 * Picks sensible default KPI cards and charts so a brand new dashboard view is
 * immediately useful: record count, the first money column, completeness, and
 * one or two charts built from choice/date columns.
 */
export function buildDefaultDashboardWidgets(
  fields: readonly FieldDefinition[],
): DashboardWidgetConfig[] {
  const sorted = [...fields]
    .filter((field) => !field.isArchived)
    .sort((left, right) => left.rank.localeCompare(right.rank))
  const primary = sorted.find((field) => field.isPrimary)
  const currency = sorted.find((field) => field.type === "currency")
  const number = sorted.find((field) => field.type === "number")
  const selects = sorted.filter(
    (field) =>
      field.type === "singleSelect" &&
      (field.config.options?.length ?? 0) > 0,
  )
  const dates = sorted.filter((field) => DATE_FIELD_TYPES.has(field.type))
  const checkboxes = sorted.filter((field) => field.type === "checkbox")
  const metricSource = currency ?? number

  const widgets: DashboardWidgetConfig[] = []
  let rank = 0
  const nextRank = () => `a${rank++}`

  widgets.push({
    id: "dashboard_total_records",
    kind: "metric",
    title: "Total records",
    aggregate: "count",
    rank: nextRank(),
  })

  if (metricSource) {
    widgets.push({
      id: `dashboard_sum_${metricSource.id}`,
      kind: "metric",
      title: widgetTitleFor("sum", metricSource, undefined),
      fieldId: metricSource.id,
      aggregate: "sum",
      rank: nextRank(),
    })
  }

  if (primary) {
    widgets.push({
      id: `dashboard_filled_${primary.id}`,
      kind: "metric",
      title: widgetTitleFor("populated", primary, undefined),
      fieldId: primary.id,
      aggregate: "populated",
      rank: nextRank(),
    })
  }

  let chartCount = 0
  const usedGroupIds = new Set<string>()

  function pushChart(
    groupField: FieldDefinition,
    chartType: "bar" | "line" | "pie",
    options?: {
      field?: FieldDefinition
      aggregate?: SummaryAggregate
    },
  ) {
    if (chartCount >= 2 || usedGroupIds.has(groupField.id)) return
    usedGroupIds.add(groupField.id)
    const aggregate = options?.aggregate ?? "count"
    widgets.push({
      id: `dashboard_chart_${groupField.id}`,
      kind: "chart",
      title: widgetTitleFor(aggregate, options?.field, groupField),
      fieldId: options?.field?.id,
      groupByFieldId: groupField.id,
      aggregate,
      chartType,
      rank: nextRank(),
    })
    chartCount += 1
  }

  if (selects[0]) pushChart(selects[0], "bar")
  if (selects[1]) pushChart(selects[1], "pie")

  if (chartCount < 2 && dates[0]) {
    pushChart(dates[0], "line", {
      field: currency,
      aggregate: currency ? "sum" : "count",
    })
  }

  if (chartCount < 2 && checkboxes[0]) {
    pushChart(checkboxes[0], "pie")
  }

  return widgets
}
