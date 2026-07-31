"use client"

import { useMemo, useState } from "react"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  List,
} from "lucide-react"

import { RecordDrawer } from "@/components/views/record-drawer"
import { Button } from "@/components/ui/button"
import type {
  CellValue,
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"
import {
  calendarDateFromValue,
  calendarDateKey,
  calendarMonthDays,
  calendarValueForDay,
  recordsByCalendarDay,
} from "@/lib/alternative-view-data"
import { recordLabel } from "@/lib/record-workflows"
import { cn } from "@/lib/utils"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function MoveDateInput({
  currentValue,
  onChange,
  title,
}: {
  currentValue: unknown
  onChange: (date: Date) => void
  title: string
}) {
  const currentDate = calendarDateFromValue(currentValue)
  const value = currentDate ? calendarDateKey(currentDate) : ""

  return (
    <input
      aria-label={`Move ${title} to date`}
      className="h-8 w-36 rounded-md border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
      onChange={(event) => {
        if (!event.target.value) return
        onChange(new Date(`${event.target.value}T12:00:00`))
      }}
      type="date"
      value={value}
    />
  )
}

export function CalendarView({
  dateField,
  fields,
  initialDisplay = "month",
  onDisplayChange,
  onUpdateCell,
  onUploadAttachments,
  records,
}: {
  dateField: FieldDefinition
  fields: readonly FieldDefinition[]
  initialDisplay?: "month" | "agenda"
  onDisplayChange?: (display: "month" | "agenda") => void
  onUpdateCell: (
    recordId: string,
    fieldId: string,
    value: CellValue,
    expectedRevision: number,
  ) => void
  onUploadAttachments?: (
    recordId: string,
    fieldId: string,
    files: File[],
  ) => Promise<void> | void
  records: readonly GridRecord[]
}) {
  const [display, setDisplay] = useState<"month" | "agenda">(
    initialDisplay,
  )
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  )
  const [openRecordId, setOpenRecordId] = useState<string>()
  const [dropDay, setDropDay] = useState<string>()
  const days = useMemo(() => calendarMonthDays(month), [month])
  const scheduled = useMemo(
    () => recordsByCalendarDay(records, dateField),
    [dateField, records],
  )
  const agendaDays = useMemo(() => {
    const monthPrefix = `${month.getFullYear()}-${String(
      month.getMonth() + 1,
    ).padStart(2, "0")}-`
    return [...scheduled.byDay.entries()]
      .filter(([day]) => day.startsWith(monthPrefix))
      .sort(([left], [right]) => left.localeCompare(right))
  }, [month, scheduled.byDay])
  const primary = fields.find((field) => field.isPrimary)
  const openRecord = records.find((record) => record.id === openRecordId)
  const timezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time"

  function selectDisplay(nextDisplay: "month" | "agenda") {
    setDisplay(nextDisplay)
    onDisplayChange?.(nextDisplay)
  }

  function moveRecord(recordId: string, date: Date) {
    const record = records.find((candidate) => candidate.id === recordId)
    if (!record) return
    onUpdateCell(
      record.id,
      dateField.id,
      calendarValueForDay(
        date,
        record.values[dateField.id],
        dateField.config.dateStyle,
      ),
      record.revision,
    )
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col bg-muted/15">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
          <Button
            aria-label="Previous month"
            onClick={() =>
              setMonth(
                (current) =>
                  new Date(current.getFullYear(), current.getMonth() - 1, 1),
              )
            }
            size="icon-sm"
            variant="ghost"
          >
            <ChevronLeft />
          </Button>
          <Button
            aria-label="Next month"
            onClick={() =>
              setMonth(
                (current) =>
                  new Date(current.getFullYear(), current.getMonth() + 1, 1),
              )
            }
            size="icon-sm"
            variant="ghost"
          >
            <ChevronRight />
          </Button>
          <h2 className="min-w-36 text-sm font-semibold">
            {month.toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
            })}
          </h2>
          <span className="hidden text-xs text-muted-foreground md:inline">
            {dateField.config.dateStyle === "dateTime" ||
            dateField.config.includeTime
              ? "Date and time"
              : "Date only"}
            {" · "}
            {timezone}
          </span>
          <div
            aria-label="Calendar display"
            className="ml-auto flex rounded-lg border bg-muted/30 p-0.5"
            role="group"
          >
            <Button
              aria-pressed={display === "month"}
              onClick={() => selectDisplay("month")}
              size="sm"
              variant={display === "month" ? "secondary" : "ghost"}
            >
              <CalendarDays />
              Month
            </Button>
            <Button
              aria-pressed={display === "agenda"}
              onClick={() => selectDisplay("agenda")}
              size="sm"
              variant={display === "agenda" ? "secondary" : "ghost"}
            >
              <List />
              Agenda
            </Button>
          </div>
          <Button
            onClick={() =>
              setMonth(
                new Date(new Date().getFullYear(), new Date().getMonth(), 1),
              )
            }
            size="sm"
            variant="outline"
          >
            Today
          </Button>
        </header>
        {display === "month" ? (
          <div className="min-h-0 flex-1 overflow-auto">
            <div
              aria-label={`Calendar using ${dateField.name}`}
              className="grid min-h-full min-w-[900px] grid-cols-7 grid-rows-[28px_repeat(6,minmax(110px,1fr))]"
            >
              {WEEKDAYS.map((weekday) => (
                <div
                  className="border-b border-r bg-muted/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                  key={weekday}
                >
                  {weekday}
                </div>
              ))}
              {days.map((day) => {
                const dayRecords = scheduled.byDay.get(day.key) ?? []
                return (
                  <section
                    aria-label={`${day.date.toLocaleDateString()}, ${dayRecords.length} records`}
                    className={cn(
                      "min-h-28 border-b border-r p-1.5 transition",
                      !day.inCurrentMonth && "bg-muted/20",
                      dropDay === day.key && "bg-primary/10",
                    )}
                    key={day.key}
                    onDragEnter={(event) => {
                      event.preventDefault()
                      setDropDay(day.key)
                    }}
                    onDragLeave={(event) => {
                      if (
                        !event.currentTarget.contains(
                          event.relatedTarget as Node,
                        )
                      ) {
                        setDropDay(undefined)
                      }
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault()
                      const recordId = event.dataTransfer.getData(
                        "text/basecraft-record",
                      )
                      if (recordId) moveRecord(recordId, day.date)
                      setDropDay(undefined)
                    }}
                  >
                    <p
                      className={cn(
                        "mb-1 text-xs tabular-nums text-muted-foreground",
                        !day.inCurrentMonth && "opacity-50",
                      )}
                    >
                      {day.date.getDate()}
                    </p>
                    <div className="space-y-1">
                      {dayRecords.slice(0, 4).map((record) => {
                        const title = recordLabel(
                          primary ? record.values[primary.id] : undefined,
                        )
                        return (
                          <button
                            aria-label={`Open ${title}`}
                            className="block w-full cursor-grab truncate rounded-md border bg-background px-2 py-1 text-left text-xs shadow-xs hover:border-primary/30 active:cursor-grabbing"
                            draggable
                            key={record.id}
                            onClick={() => setOpenRecordId(record.id)}
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move"
                              event.dataTransfer.setData(
                                "text/basecraft-record",
                                record.id,
                              )
                            }}
                            type="button"
                          >
                            {title}
                          </button>
                        )
                      })}
                      {dayRecords.length > 4 ? (
                        <button
                          className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setOpenRecordId(dayRecords[4]?.id)
                          }
                          type="button"
                        >
                          +{dayRecords.length - 4} more
                        </button>
                      ) : null}
                    </div>
                  </section>
                )
              })}
            </div>
          </div>
        ) : (
          <div
            aria-label={`Agenda using ${dateField.name}`}
            className="min-h-0 flex-1 overflow-y-auto p-4"
          >
            {agendaDays.length ? (
              <div className="mx-auto grid max-w-3xl gap-3">
                {agendaDays.map(([day, dayRecords]) => (
                  <section
                    className="overflow-hidden rounded-xl border bg-background"
                    key={day}
                  >
                    <header className="border-b bg-muted/30 px-4 py-2.5">
                      <h3 className="text-sm font-medium">
                        {new Date(`${day}T12:00:00`).toLocaleDateString(
                          undefined,
                          {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                          },
                        )}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {dayRecords.length.toLocaleString()}{" "}
                        {dayRecords.length === 1 ? "record" : "records"}
                      </p>
                    </header>
                    <div className="divide-y">
                      {dayRecords.map((record) => {
                        const title = recordLabel(
                          primary ? record.values[primary.id] : undefined,
                        )
                        const value = record.values[dateField.id]
                        const time =
                          (dateField.config.dateStyle === "dateTime" ||
                            dateField.config.includeTime) &&
                          typeof value === "number"
                            ? new Date(value).toLocaleTimeString(undefined, {
                                hour: "numeric",
                                minute: "2-digit",
                              })
                            : "All day"
                        return (
                          <div
                            className="flex items-center gap-3 px-4 py-2 hover:bg-muted/30"
                            key={record.id}
                          >
                            <button
                              aria-label={`Open ${title}`}
                              className="flex min-w-0 flex-1 items-center gap-4 py-1 text-left"
                              onClick={() => setOpenRecordId(record.id)}
                              type="button"
                            >
                              <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">
                                {time}
                              </span>
                              <span className="min-w-0 truncate text-sm font-medium">
                                {title}
                              </span>
                            </button>
                            <MoveDateInput
                              currentValue={value}
                              onChange={(date) => moveRecord(record.id, date)}
                              title={title}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="grid min-h-64 place-items-center text-center">
                <div>
                  <CalendarDays className="mx-auto size-5 text-muted-foreground" />
                  <p className="mt-2 text-sm font-medium">
                    Nothing scheduled this month
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Records with a {dateField.name} will appear here.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
        {scheduled.unscheduled.length > 0 ? (
          <aside className="shrink-0 border-t bg-background p-2">
            <p className="mb-2 text-xs font-medium">
              No {dateField.name.toLocaleLowerCase()}{" "}
              {display === "month" ? (
                <span className="font-normal text-muted-foreground">
                  · drag onto a day
                </span>
              ) : null}
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {scheduled.unscheduled.map((record) => {
                const title = recordLabel(
                  primary ? record.values[primary.id] : undefined,
                )
                return (
                  <div
                    className="flex shrink-0 items-center gap-1 rounded-lg border bg-muted/30 p-1"
                    draggable
                    key={record.id}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move"
                      event.dataTransfer.setData(
                        "text/basecraft-record",
                        record.id,
                      )
                    }}
                  >
                    <button
                      aria-label={`Open ${title}`}
                      className="max-w-52 cursor-grab truncate px-2 py-1 text-xs active:cursor-grabbing"
                      onClick={() => setOpenRecordId(record.id)}
                      type="button"
                    >
                      {title}
                    </button>
                    <MoveDateInput
                      currentValue={record.values[dateField.id]}
                      onChange={(date) => moveRecord(record.id, date)}
                      title={title}
                    />
                  </div>
                )
              })}
            </div>
          </aside>
        ) : null}
      </div>
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
