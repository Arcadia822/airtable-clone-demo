import type {
  AttachmentValue,
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"
import { formatClipboardCellValue } from "@/lib/spreadsheet-clipboard"

export type KanbanLane = {
  id: string | null
  label: string
  color?: string
  canReceive: boolean
  records: GridRecord[]
}

export type CalendarDay = {
  date: Date
  key: string
  inCurrentMonth: boolean
}

export type FriendlyRecordDetail = {
  fieldId: string
  label: string
  value: string
}

export function buildKanbanLanes(
  records: readonly GridRecord[],
  field: FieldDefinition,
): KanbanLane[] {
  const options = field.config.options ?? []
  const archivedOptions = field.config.archivedOptions ?? []
  const recordsByOption = new Map<string, GridRecord[]>()
  const unassigned: GridRecord[] = []

  for (const record of records) {
    const value = record.values[field.id]
    const option =
      typeof value === "string"
        ? options.find((candidate) => candidate.id === value)
        : undefined
    if (
      typeof value !== "string" ||
      value.length === 0
    ) {
      unassigned.push(record)
      continue
    }
    if (!option) {
      const archivedOption = archivedOptions.find(
        (candidate) => candidate.id === value,
      )
      const archivedKey = archivedOption?.id ?? "__unavailable__"
      const current = recordsByOption.get(archivedKey) ?? []
      current.push(record)
      recordsByOption.set(archivedKey, current)
      continue
    }
    const current = recordsByOption.get(option.id) ?? []
    current.push(record)
    recordsByOption.set(option.id, current)
  }

  return [
    ...options.map((option) => ({
      id: option.id,
      label: option.label,
      color: option.color,
      canReceive: true,
      records: recordsByOption.get(option.id) ?? [],
    })),
    ...archivedOptions
      .filter((option) => recordsByOption.has(option.id))
      .map((option) => ({
        id: `archived:${option.id}`,
        label: `${option.label} (archived)`,
        color: option.color,
        canReceive: false,
        records: recordsByOption.get(option.id) ?? [],
      })),
    ...(recordsByOption.has("__unavailable__")
      ? [
          {
            id: "__unavailable__",
            label: "Unavailable choice",
            canReceive: false,
            records: recordsByOption.get("__unavailable__") ?? [],
          },
        ]
      : []),
    {
      id: null,
      label: "Unassigned",
      canReceive: true,
      records: unassigned,
    },
  ]
}

export function calendarDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function calendarDateFromValue(value: unknown): Date | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date
  }
  if (typeof value !== "string" || !value.trim()) return undefined
  const normalized = value.trim()
  const date = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? new Date(`${normalized}T12:00:00`)
    : new Date(normalized)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export function calendarMonthDays(anchor: Date): CalendarDay[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return {
      date,
      key: calendarDateKey(date),
      inCurrentMonth: date.getMonth() === anchor.getMonth(),
    }
  })
}

export function recordsByCalendarDay(
  records: readonly GridRecord[],
  dateField: FieldDefinition,
): {
  byDay: ReadonlyMap<string, GridRecord[]>
  unscheduled: GridRecord[]
} {
  const byDay = new Map<string, GridRecord[]>()
  const unscheduled: GridRecord[] = []
  for (const record of records) {
    const value = record.values[dateField.id]
    const date = calendarDateFromValue(value)
    if (!date) {
      unscheduled.push(record)
      continue
    }
    const key = calendarDateKey(date)
    const current = byDay.get(key) ?? []
    current.push(record)
    byDay.set(key, current)
  }
  return { byDay, unscheduled }
}

export function calendarValueForDay(
  date: Date,
  currentValue: unknown,
  dateStyle: "date" | "dateTime" = "date",
): string | number {
  const next = new Date(date)
  const current = calendarDateFromValue(currentValue)
  if (current) {
    next.setHours(
      current.getHours(),
      current.getMinutes(),
      current.getSeconds(),
      0,
    )
  } else {
    next.setHours(12, 0, 0, 0)
  }
  if (typeof currentValue === "number") return next.getTime()
  const day = calendarDateKey(next)
  if (dateStyle === "date") return day
  const hours = String(next.getHours()).padStart(2, "0")
  const minutes = String(next.getMinutes()).padStart(2, "0")
  return `${day}T${hours}:${minutes}`
}

export function galleryCover(
  record: GridRecord,
  coverField?: FieldDefinition,
): AttachmentValue | undefined {
  if (!coverField || coverField.type !== "attachment") return undefined
  const value = record.values[coverField.id]
  if (!Array.isArray(value)) return undefined
  return value.find(
    (item): item is AttachmentValue =>
      typeof item === "object" &&
      item !== null &&
      "name" in item &&
      typeof item.name === "string",
  )
}

export function friendlyRecordDetails(
  record: GridRecord,
  fields: readonly FieldDefinition[],
  options?: {
    excludeFieldIds?: ReadonlySet<string>
    limit?: number
  },
): FriendlyRecordDetail[] {
  const details: FriendlyRecordDetail[] = []
  const limit = options?.limit ?? 3
  for (const field of fields) {
    if (options?.excludeFieldIds?.has(field.id)) continue
    const value = formatClipboardCellValue(record.values[field.id], field)
    if (!value) continue
    details.push({
      fieldId: field.id,
      label: field.name,
      value,
    })
    if (details.length >= limit) break
  }
  return details
}
