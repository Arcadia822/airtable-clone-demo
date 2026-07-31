"use client"

import { useMemo, useState } from "react"
import { GripVertical } from "lucide-react"

import { RecordDrawer } from "@/components/views/record-drawer"
import type {
  CellValue,
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"
import {
  buildKanbanLanes,
  friendlyRecordDetails,
} from "@/lib/alternative-view-data"
import { recordLabel } from "@/lib/record-workflows"
import { cn } from "@/lib/utils"

export function KanbanView({
  fields,
  groupField,
  onUpdateCell,
  onUploadAttachments,
  records,
  summaryFields,
  wipLimit,
}: {
  fields: readonly FieldDefinition[]
  groupField: FieldDefinition
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
  summaryFields?: readonly FieldDefinition[]
  wipLimit?: number
}) {
  const [openRecordId, setOpenRecordId] = useState<string>()
  const [dropLaneId, setDropLaneId] = useState<string | null | undefined>()
  const lanes = useMemo(
    () => buildKanbanLanes(records, groupField),
    [groupField, records],
  )
  const primary = fields.find((field) => field.isPrimary)
  const openRecord = records.find((record) => record.id === openRecordId)

  function moveRecord(recordId: string, laneId: string | null) {
    const record = records.find((candidate) => candidate.id === recordId)
    if (!record || record.values[groupField.id] === laneId) return
    onUpdateCell(
      record.id,
      groupField.id,
      laneId,
      record.revision,
    )
  }

  return (
    <>
      <div
        aria-label={`Kanban board grouped by ${groupField.name}`}
        className="flex min-h-0 flex-1 gap-3 overflow-auto bg-muted/20 p-3"
      >
        {lanes.map((lane) => {
          const limitReached =
            wipLimit !== undefined && lane.records.length > wipLimit
          return (
            <section
              aria-label={`${lane.label}, ${lane.records.length} records`}
              className={cn(
                "flex w-72 shrink-0 flex-col rounded-xl border bg-muted/35",
                dropLaneId === lane.id && "border-primary/40 bg-primary/5",
                limitReached && "border-amber-400/70",
              )}
              key={lane.id ?? "unassigned"}
              onDragEnter={(event) => {
                if (!lane.canReceive) return
                event.preventDefault()
                setDropLaneId(lane.id)
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                  setDropLaneId(undefined)
                }
              }}
              onDragOver={(event) => {
                if (lane.canReceive) event.preventDefault()
              }}
              onDrop={(event) => {
                if (!lane.canReceive) return
                event.preventDefault()
                const recordId = event.dataTransfer.getData(
                  "text/basecraft-record",
                )
                if (recordId) moveRecord(recordId, lane.id)
                setDropLaneId(undefined)
              }}
            >
              <header className="flex h-11 items-center gap-2 border-b px-3">
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: lane.color ?? "#94A3B8" }}
                />
                <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
                  {lane.label}
                </h2>
                <span
                  className={cn(
                    "rounded-full bg-background px-2 py-0.5 text-[11px] text-muted-foreground",
                    limitReached && "bg-amber-100 text-amber-800",
                  )}
                >
                  {lane.records.length}
                  {wipLimit !== undefined ? ` / ${wipLimit}` : ""}
                </span>
              </header>
              <div className="min-h-24 flex-1 space-y-2 overflow-y-auto p-2">
                {lane.records.map((record) => {
                  const title = recordLabel(
                    primary ? record.values[primary.id] : undefined,
                  )
                  const details = friendlyRecordDetails(
                    record,
                    summaryFields ?? fields,
                    {
                    excludeFieldIds: new Set(
                      [primary?.id, groupField.id].filter(
                        (value): value is string => Boolean(value),
                      ),
                    ),
                    limit: 2,
                    },
                  )
                  const groupValue = record.values[groupField.id]
                  const activeGroup = groupField.config.options?.some(
                    (option) => option.id === groupValue,
                  )
                    ? String(groupValue)
                    : groupValue
                      ? "__unavailable__"
                      : "__unassigned__"
                  return (
                    <article
                      className="group w-full cursor-grab overflow-hidden rounded-lg border bg-background text-left shadow-xs transition hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-sm active:cursor-grabbing"
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
                        className="flex w-full items-start gap-2 p-3 text-left"
                        onClick={() => setOpenRecordId(record.id)}
                        type="button"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {title}
                          </span>
                          {details.map((detail) => (
                            <span
                              className="mt-1 flex min-w-0 gap-1 text-xs text-muted-foreground"
                              key={detail.fieldId}
                            >
                              <span className="shrink-0">{detail.label}:</span>
                              <span className="truncate">{detail.value}</span>
                            </span>
                          ))}
                        </span>
                        <GripVertical className="size-4 shrink-0 text-muted-foreground/50 opacity-0 transition group-hover:opacity-100" />
                      </button>
                      <div className="border-t bg-muted/15 px-2 py-1.5">
                        <label className="sr-only" htmlFor={`move-${record.id}`}>
                          Move {title} to another group
                        </label>
                        <select
                          className="h-7 w-full rounded-md border bg-background px-2 text-xs text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                          id={`move-${record.id}`}
                          onChange={(event) => {
                            const nextLaneId = event.target.value
                            if (nextLaneId === "__unavailable__") return
                            moveRecord(
                              record.id,
                              nextLaneId === "__unassigned__"
                                ? null
                                : nextLaneId,
                            )
                          }}
                          onClick={(event) => event.stopPropagation()}
                          value={activeGroup}
                        >
                          {activeGroup === "__unavailable__" ? (
                            <option disabled value="__unavailable__">
                              Choose a new group
                            </option>
                          ) : null}
                          <option value="__unassigned__">Unassigned</option>
                          {(groupField.config.options ?? []).map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </article>
                  )
                })}
                {lane.records.length === 0 ? (
                  <p className="px-2 py-5 text-center text-xs text-muted-foreground">
                    {lane.canReceive
                      ? "Drag records here"
                      : "No records use this retired choice"}
                  </p>
                ) : null}
              </div>
            </section>
          )
        })}
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
