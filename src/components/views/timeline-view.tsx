"use client"

import { useMemo, useRef, useState } from "react"
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Plus,
} from "lucide-react"

import { RecordDrawer } from "@/components/views/record-drawer"
import { Button } from "@/components/ui/button"
import type {
  CellValue,
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"
import {
  buildKanbanLanes,
  buildTimelineBars,
  calendarDateKey,
  calendarValueForDay,
  type TimelineBar,
} from "@/lib/alternative-view-data"
import { recordLabel } from "@/lib/record-workflows"
import { cn } from "@/lib/utils"

export type TimelineScale = "day" | "week" | "month"

const DAY_MS = 86_400_000

const SCALE_OPTIONS: ReadonlyArray<{ value: TimelineScale; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
]

const BAR_COLORS = [
  "#6366F1",
  "#0EA5E9",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#14B8A6",
  "#EC4899",
] as const

const dayLabelFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
})
const monthLabelFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  year: "numeric",
})
const dateLabelFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

type TimelineColumn = {
  key: string
  label: string
  start: number
  end: number
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfWeek(date: Date): Date {
  const day = startOfDay(date)
  const weekday = (day.getDay() + 6) % 7
  return addDays(day, -weekday)
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

function buildTimelineColumns(
  bars: readonly TimelineBar[],
  scale: TimelineScale,
  today: Date,
): { columns: TimelineColumn[]; rangeStart: number; rangeEnd: number } {
  const stamps: number[] = [startOfDay(today).getTime()]
  for (const bar of bars) {
    stamps.push(startOfDay(bar.start).getTime())
    stamps.push(startOfDay(bar.end).getTime() + DAY_MS)
  }
  const min = new Date(Math.min(...stamps))
  const max = new Date(Math.max(...stamps))
  const columns: TimelineColumn[] = []

  if (scale === "day") {
    let cursor = addDays(startOfDay(min), -2)
    const paddedMax = addDays(startOfDay(max), 2)
    const minimumEnd = addDays(startOfDay(today), 7)
    const limitTime = Math.max(paddedMax.getTime(), minimumEnd.getTime())
    while (cursor.getTime() <= limitTime) {
      const next = addDays(cursor, 1)
      columns.push({
        key: calendarDateKey(cursor),
        label: dayLabelFormatter.format(cursor),
        start: cursor.getTime(),
        end: next.getTime(),
      })
      cursor = next
    }
  } else if (scale === "week") {
    let cursor = addDays(startOfWeek(min), -7)
    const paddedMax = addDays(startOfWeek(max), 14)
    const minimumEnd = addDays(startOfWeek(today), 14)
    const limitTime = Math.max(paddedMax.getTime(), minimumEnd.getTime())
    while (cursor.getTime() <= limitTime) {
      const next = addDays(cursor, 7)
      columns.push({
        key: calendarDateKey(cursor),
        label: dayLabelFormatter.format(cursor),
        start: cursor.getTime(),
        end: next.getTime(),
      })
      cursor = next
    }
  } else {
    let cursor = addMonths(startOfMonth(min), -1)
    const paddedMax = addMonths(startOfMonth(max), 1)
    const minimumEnd = addMonths(startOfMonth(today), 1)
    const limitTime = Math.max(paddedMax.getTime(), minimumEnd.getTime())
    while (cursor.getTime() <= limitTime) {
      const next = addMonths(cursor, 1)
      columns.push({
        key: calendarDateKey(cursor),
        label: monthLabelFormatter.format(cursor),
        start: cursor.getTime(),
        end: next.getTime(),
      })
      cursor = next
    }
  }

  return {
    columns,
    rangeStart: columns[0]?.start ?? startOfDay(today).getTime(),
    rangeEnd:
      columns[columns.length - 1]?.end ?? addDays(startOfDay(today), 1).getTime(),
  }
}

function barDateRangeLabel(bar: TimelineBar): string {
  const start = dateLabelFormatter.format(bar.start)
  const end = dateLabelFormatter.format(bar.end)
  return start === end ? start : `${start} → ${end}`
}

function barGeometry(
  bar: TimelineBar,
  rangeStart: number,
  rangeEnd: number,
): { left: string; width: string } {
  const span = Math.max(rangeEnd - rangeStart, 1)
  const start = Math.min(
    Math.max(bar.start.getTime(), rangeStart),
    rangeEnd,
  )
  const end = Math.min(
    Math.max(bar.end.getTime() + DAY_MS, start + DAY_MS),
    rangeEnd,
  )
  const left = ((start - rangeStart) / span) * 100
  const width = Math.max(((end - start) / span) * 100, 1.25)
  return {
    left: `${Math.min(left, 98.5)}%`,
    width: `${Math.min(width, 100 - Math.min(left, 98.5))}%`,
  }
}

export function TimelineView({
  endField,
  fields,
  groupField,
  onAddRecord,
  onScaleChange,
  onSelectDateFields,
  onUpdateCell,
  onUploadAttachments,
  readOnly = false,
  records,
  scale,
  startField,
}: {
  fields: readonly FieldDefinition[]
  records: readonly GridRecord[]
  startField: FieldDefinition
  endField?: FieldDefinition
  groupField?: FieldDefinition
  scale?: TimelineScale
  onScaleChange?: (scale: TimelineScale) => void
  onSelectDateFields?: (startFieldId: string, endFieldId?: string) => void
  onUpdateCell: (
    recordId: string,
    fieldId: string,
    value: CellValue,
    expectedRevision: number,
  ) => void
  onAddRecord?: () => void
  onUploadAttachments?: (
    recordId: string,
    fieldId: string,
    files: File[],
  ) => Promise<void> | void
  readOnly?: boolean
}) {
  const [internalScale, setInternalScale] = useState<TimelineScale>(
    scale ?? "week",
  )
  const [openRecordId, setOpenRecordId] = useState<string>()
  const [unscheduledOpen, setUnscheduledOpen] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeScale = scale ?? internalScale
  const today = useMemo(() => startOfDay(new Date()), [])

  const dateFields = useMemo(
    () =>
      fields.filter(
        (field) => field.type === "date" || field.type === "createdTime",
      ),
    [fields],
  )
  const primary = fields.find((field) => field.isPrimary)
  const { bars, unscheduled } = useMemo(
    () => buildTimelineBars(records, startField, endField),
    [endField, records, startField],
  )
  const { columns, rangeStart, rangeEnd } = useMemo(
    () => buildTimelineColumns(bars, activeScale, today),
    [activeScale, bars, today],
  )
  const span = Math.max(rangeEnd - rangeStart, 1)
  const todayTime = today.getTime()
  const todayPct =
    todayTime >= rangeStart && todayTime <= rangeEnd
      ? ((todayTime - rangeStart) / span) * 100
      : undefined
  const colorByRecordId = useMemo(() => {
    const colors = new Map<string, string>()
    records.forEach((record, index) => {
      colors.set(record.id, BAR_COLORS[index % BAR_COLORS.length])
    })
    return colors
  }, [records])

  const barsByRecordId = useMemo(
    () => new Map(bars.map((bar) => [bar.record.id, bar])),
    [bars],
  )
  const lanes = useMemo(
    () =>
      groupField
        ? buildKanbanLanes(records, groupField).filter(
            (lane) => lane.records.length > 0,
          )
        : null,
    [groupField, records],
  )

  const openRecord = records.find((record) => record.id === openRecordId)

  function chooseScale(nextScale: TimelineScale) {
    setInternalScale(nextScale)
    onScaleChange?.(nextScale)
  }

  function jumpToToday() {
    const container = scrollRef.current
    if (!container || todayPct === undefined) return
    const labelWidth = 176
    const trackWidth = Math.max(
      container.scrollWidth - labelWidth,
      container.clientWidth,
    )
    container.scrollLeft = Math.max(
      (trackWidth * todayPct) / 100 + labelWidth - container.clientWidth / 2,
      0,
    )
  }

  function setStartDateToday(record: GridRecord) {
    onUpdateCell(
      record.id,
      startField.id,
      calendarValueForDay(
        new Date(),
        record.values[startField.id],
        startField.config.dateStyle,
      ),
      record.revision,
    )
  }

  function renderRow(bar: TimelineBar) {
    const record = bar.record
    const title = recordLabel(
      primary ? record.values[primary.id] : undefined,
    )
    const rangeText = barDateRangeLabel(bar)
    const geometry = barGeometry(bar, rangeStart, rangeEnd)
    const laneColor = groupField
      ? record.values[groupField.id]
      : undefined
    const laneOption =
      typeof laneColor === "string"
        ? groupField?.config.options?.find(
            (option) => option.id === laneColor,
          )
        : undefined
    const barColor =
      laneOption?.color ??
      colorByRecordId.get(record.id) ??
      BAR_COLORS[0]

    return (
      <div className="flex border-b border-border/70 last:border-b-0" key={record.id}>
        <div className="sticky left-0 z-10 flex w-36 shrink-0 items-center border-r bg-background px-2 sm:w-52 sm:px-3">
          <span className="w-full truncate text-xs font-medium" title={title}>
            {title}
          </span>
        </div>
        <div className="relative h-11 min-w-0 flex-1">
          <div aria-hidden className="pointer-events-none absolute inset-0 flex">
            {columns.map((column) => (
              <div
                className="h-full shrink-0 border-r border-dashed border-border/50"
                key={column.key}
                style={{ width: `${100 / columns.length}%` }}
              />
            ))}
          </div>
          {todayPct !== undefined ? (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 z-[1] w-px bg-primary/50"
              style={{ left: `${todayPct}%` }}
            />
          ) : null}
          <button
            aria-label={`Open ${title}`}
            className="absolute top-2 z-[2] flex h-7 items-center overflow-hidden rounded-md px-2 text-left text-[11px] font-medium text-white shadow-sm transition hover:brightness-105 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            onClick={() => setOpenRecordId(record.id)}
            style={{
              ...geometry,
              backgroundColor: barColor,
            }}
            title={`${title} · ${rangeText}`}
            type="button"
          >
            <span className="truncate">{title}</span>
          </button>
        </div>
      </div>
    )
  }

  const scheduledCount = bars.length

  return (
    <>
      <section
        aria-label={`Timeline using ${startField.name}`}
        className="flex min-h-0 flex-1 flex-col bg-muted/15"
      >
        <header className="flex flex-wrap items-center gap-1.5 border-b bg-background px-2 py-1.5 sm:px-3">
          <div
            aria-label="Timeline scale"
            className="flex shrink-0 items-center rounded-lg border p-0.5"
            role="group"
          >
            {SCALE_OPTIONS.map((option) => (
              <button
                aria-pressed={activeScale === option.value}
                className={cn(
                  "h-7 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                  activeScale === option.value &&
                    "bg-muted text-foreground shadow-xs",
                )}
                key={option.value}
                onClick={() => chooseScale(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>

          <Button
            className="h-8 gap-1.5 px-2 text-xs"
            onClick={jumpToToday}
            size="sm"
            type="button"
            variant="outline"
          >
            <CalendarDays />
            Today
          </Button>

          {dateFields.length > 1 ? (
            <div className="flex min-w-0 items-center gap-1">
              <label className="sr-only" htmlFor="timeline-start-field">
                Start date field
              </label>
              <select
                aria-label="Start date field"
                className="h-8 w-28 rounded-md border bg-background px-1.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 sm:w-36"
                disabled={!onSelectDateFields}
                id="timeline-start-field"
                onChange={(event) =>
                  onSelectDateFields?.(event.target.value, endField?.id)
                }
                value={startField.id}
              >
                {dateFields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor="timeline-end-field">
                End date field
              </label>
              <select
                aria-label="End date field"
                className="h-8 w-24 rounded-md border bg-background px-1.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 sm:w-32"
                disabled={!onSelectDateFields}
                id="timeline-end-field"
                onChange={(event) =>
                  onSelectDateFields?.(
                    startField.id,
                    event.target.value || undefined,
                  )
                }
                value={endField?.id ?? ""}
              >
                <option value="">No end date</option>
                {dateFields
                  .filter((field) => field.id !== startField.id)
                  .map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.name}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}

          {groupField ? (
            <span className="inline-flex h-7 items-center gap-1 rounded-full bg-muted px-2 text-[11px] text-muted-foreground">
              Grouped by {groupField.name}
            </span>
          ) : null}

          <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">
            {scheduledCount} scheduled
            {unscheduled.length > 0 ? ` · ${unscheduled.length} unscheduled` : ""}
          </span>

          {onAddRecord && !readOnly ? (
            <Button
              className="h-8 gap-1 px-2 text-xs"
              onClick={onAddRecord}
              size="sm"
              type="button"
              variant="outline"
            >
              <Plus />
              New record
            </Button>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-auto" ref={scrollRef}>
          <div className="min-w-[620px]">
            <div className="sticky top-0 z-20 flex border-b bg-background/95 backdrop-blur">
              <div className="sticky left-0 z-30 w-36 shrink-0 border-r bg-background px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:w-52 sm:px-3">
                Records
              </div>
              <div className="relative flex min-w-0 flex-1">
                {columns.map((column) => (
                  <div
                    className="shrink-0 border-r border-border/50 px-1.5 py-2 text-[11px] tabular-nums text-muted-foreground last:border-r-0"
                    key={column.key}
                    style={{ width: `${100 / columns.length}%` }}
                  >
                    <span className="block truncate">{column.label}</span>
                  </div>
                ))}
                {todayPct !== undefined ? (
                  <span
                    aria-label="Today"
                    className="absolute top-0 z-10 -translate-x-1/2 rounded-sm bg-primary px-1 py-0.5 text-[9px] font-medium text-primary-foreground"
                    style={{ left: `${todayPct}%` }}
                  >
                    Today
                  </span>
                ) : null}
              </div>
            </div>

            {lanes
              ? lanes.map((lane) => {
                  const laneBars = lane.records
                    .map((record) => barsByRecordId.get(record.id))
                    .filter((bar): bar is TimelineBar => Boolean(bar))
                  return (
                    <div key={lane.id ?? "unassigned"}>
                      <div className="flex border-b bg-muted/40">
                        <div className="sticky left-0 z-10 flex w-36 shrink-0 items-center gap-1.5 border-r bg-muted/40 px-2 py-1.5 sm:w-52 sm:px-3">
                          <span
                            aria-hidden
                            className="size-2 shrink-0 rounded-full"
                            style={{
                              backgroundColor: lane.color ?? "#94A3B8",
                            }}
                          />
                          <h3 className="min-w-0 flex-1 truncate text-[11px] font-semibold">
                            {lane.label}
                          </h3>
                          <span className="text-[10px] text-muted-foreground">
                            {lane.records.length}
                          </span>
                        </div>
                        <div className="flex-1" />
                      </div>
                      {laneBars.map((bar) => renderRow(bar))}
                      {laneBars.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-muted-foreground">
                          No scheduled records in this group yet.
                        </p>
                      ) : null}
                    </div>
                  )
                })
              : bars.map((bar) => renderRow(bar))}

            {bars.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
                <p className="text-sm font-medium">Nothing scheduled yet</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  Add a date to “{startField.name}” and the record will appear on
                  this timeline.
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <footer className="shrink-0 border-t bg-background">
          <button
            aria-expanded={unscheduledOpen}
            className="flex h-10 w-full items-center gap-2 px-3 text-left text-xs font-medium"
            onClick={() => setUnscheduledOpen((open) => !open)}
            type="button"
          >
            {unscheduledOpen ? (
              <ChevronDown className="size-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3.5 text-muted-foreground" />
            )}
            Unscheduled ({unscheduled.length})
            <span className="ml-auto text-[11px] font-normal text-muted-foreground">
              Records missing a start date
            </span>
          </button>
          {unscheduledOpen ? (
            unscheduled.length > 0 ? (
              <ul className="max-h-44 overflow-y-auto border-t">
                {unscheduled.map((record) => {
                  const title = recordLabel(
                    primary ? record.values[primary.id] : undefined,
                  )
                  return (
                    <li
                      className="flex min-h-11 items-center gap-2 border-b px-3 py-1.5 last:border-b-0"
                      key={record.id}
                    >
                      <button
                        aria-label={`Open ${title}`}
                        className="min-w-0 flex-1 truncate text-left text-xs font-medium underline-offset-2 hover:underline"
                        onClick={() => setOpenRecordId(record.id)}
                        type="button"
                      >
                        {title}
                      </button>
                      {!readOnly ? (
                        <Button
                          aria-label={`Set start date for ${title} to today`}
                          className="h-8 text-xs"
                          onClick={() => setStartDateToday(record)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          Set start date
                        </Button>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="border-t px-3 py-3 text-xs text-muted-foreground">
                Every record has a start date.
              </p>
            )
          ) : null}
        </footer>
      </section>

      <RecordDrawer
        fields={fields}
        onOpenChange={(open) => {
          if (!open) setOpenRecordId(undefined)
        }}
        onUpdateCell={onUpdateCell}
        onUploadAttachments={onUploadAttachments}
        open={Boolean(openRecord)}
        record={openRecord}
      />
    </>
  )
}
