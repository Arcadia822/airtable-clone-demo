"use client"

import { useMemo, useState } from "react"
import { ImageIcon, Plus, Search } from "lucide-react"

import { RecordDrawer } from "@/components/views/record-drawer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type {
  AttachmentValue,
  CellValue,
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"
import { friendlyRecordDetails } from "@/lib/alternative-view-data"
import { recordLabel } from "@/lib/record-workflows"
import { formatClipboardCellValue } from "@/lib/spreadsheet-clipboard"
import { cn } from "@/lib/utils"

function firstAttachment(
  record: GridRecord,
  attachmentFields: readonly FieldDefinition[],
): AttachmentValue | undefined {
  for (const field of attachmentFields) {
    const value = record.values[field.id]
    if (!Array.isArray(value)) continue
    const attachment = value.find(
      (item): item is AttachmentValue =>
        typeof item === "object" &&
        item !== null &&
        "name" in item &&
        typeof item.name === "string",
    )
    if (attachment) return attachment
  }
  return undefined
}

/**
 * Compact card list used below 640px so phones get readable, tappable records
 * instead of a horizontally scrolling spreadsheet.
 */
export function MobileRecordList({
  className,
  emptyMessage = "No records yet.",
  fields,
  initialQuery = "",
  onAddRecord,
  onUpdateCell,
  onUploadAttachments,
  readOnly = false,
  records,
}: {
  className?: string
  emptyMessage?: string
  fields: readonly FieldDefinition[]
  initialQuery?: string
  onAddRecord?: () => void
  onUpdateCell?: (
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
  readOnly?: boolean
  records: readonly GridRecord[]
}) {
  const [query, setQuery] = useState(initialQuery)
  const [openRecordId, setOpenRecordId] = useState<string>()

  const primary = fields.find((field) => field.isPrimary)
  const autoNumberField = fields.find(
    (field) => field.type === "autoNumber",
  )
  const attachmentFields = useMemo(
    () =>
      fields.filter(
        (field) => field.type === "attachment" || field.type === "image",
      ),
    [fields],
  )
  const detailFields = useMemo(
    () =>
      fields.filter(
        (field) =>
          field.id !== primary?.id &&
          field.id !== autoNumberField?.id &&
          field.type !== "attachment" &&
          field.type !== "image",
      ),
    [autoNumberField?.id, fields, primary?.id],
  )
  const normalizedQuery = query.trim().toLowerCase()
  const visibleRecords = useMemo(() => {
    if (!normalizedQuery) return [...records]
    return records.filter((record) => {
      const haystack = fields
        .map((field) =>
          formatClipboardCellValue(record.values[field.id], field),
        )
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [fields, normalizedQuery, records])

  const openRecord = records.find((record) => record.id === openRecordId)

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col bg-background",
        className,
      )}
    >
      <div className="shrink-0 space-y-2 border-b p-3">
        <div className="relative">
          <label className="sr-only" htmlFor="mobile-record-search">
            Search records
          </label>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search records"
            autoComplete="off"
            className="h-10 pl-8"
            id="mobile-record-search"
            inputMode="search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search records"
            type="search"
            value={query}
          />
        </div>
        <p aria-live="polite" className="text-[11px] text-muted-foreground">
          {normalizedQuery
            ? `${visibleRecords.length} of ${records.length} records`
            : `${records.length} record${records.length === 1 ? "" : "s"}`}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {visibleRecords.map((record) => {
          const title = recordLabel(
            primary ? record.values[primary.id] : undefined,
          )
          const autoNumberValue = autoNumberField
            ? formatClipboardCellValue(
                record.values[autoNumberField.id],
                autoNumberField,
              )
            : ""
          const details = friendlyRecordDetails(record, detailFields, {
            limit: 4,
          })
          const attachment = firstAttachment(record, attachmentFields)
          return (
            <article
              className="rounded-xl border bg-background shadow-xs transition-colors hover:border-primary/30"
              key={record.id}
            >
              <button
                aria-label={`Open ${title}`}
                className="flex min-h-11 w-full items-start gap-3 p-3 text-left"
                onClick={() => setOpenRecordId(record.id)}
                type="button"
              >
                {attachment ? (
                  attachment.url ? (
                    // Attachments are remote user content; a plain image keeps
                    // the card light and works with the demo's blob URLs.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      className="size-11 shrink-0 rounded-lg border object-cover"
                      src={attachment.url}
                    />
                  ) : (
                    <span className="grid size-11 shrink-0 place-items-center rounded-lg border bg-muted text-muted-foreground">
                      <ImageIcon className="size-4" />
                    </span>
                  )
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {title}
                    </span>
                    {autoNumberValue ? (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                        #{autoNumberValue}
                      </span>
                    ) : null}
                  </span>
                  {details.length > 0 ? (
                    <span className="mt-1.5 grid gap-0.5">
                      {details.map((detail) => (
                        <span
                          className="flex min-w-0 gap-1 text-[11px] leading-4 text-muted-foreground"
                          key={detail.fieldId}
                        >
                          <span className="shrink-0 text-muted-foreground/80">
                            {detail.label}
                          </span>
                          <span className="truncate">{detail.value}</span>
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </button>
            </article>
          )
        })}

        {visibleRecords.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-10 text-center">
            <p className="text-sm font-medium">
              {normalizedQuery ? "No matching records" : "No records"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {normalizedQuery
                ? `Nothing matches “${query.trim()}”. Try another search.`
                : emptyMessage}
            </p>
          </div>
        ) : null}
      </div>

      {!readOnly && onAddRecord ? (
        <div className="shrink-0 border-t bg-background/95 p-3 backdrop-blur">
          <Button
            className="h-11 w-full gap-1.5 text-sm"
            onClick={onAddRecord}
            type="button"
          >
            <Plus className="size-4" />
            New record
          </Button>
        </div>
      ) : null}

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
    </div>
  )
}
