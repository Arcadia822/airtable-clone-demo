"use client"

import { useState } from "react"
import { ImageIcon } from "lucide-react"

import { RecordDrawer } from "@/components/views/record-drawer"
import type {
  CellValue,
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"
import {
  friendlyRecordDetails,
  galleryCover,
} from "@/lib/alternative-view-data"
import { recordLabel } from "@/lib/record-workflows"

export function GalleryView({
  coverField,
  fields,
  onUpdateCell,
  onUploadAttachments,
  records,
  summaryFields,
}: {
  coverField?: FieldDefinition
  fields: readonly FieldDefinition[]
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
}) {
  const [openRecordId, setOpenRecordId] = useState<string>()
  const primary = fields.find((field) => field.isPrimary)
  const openRecord = records.find((record) => record.id === openRecordId)

  return (
    <>
      <div
        aria-label="Gallery view"
        className="min-h-0 flex-1 overflow-y-auto bg-muted/15 p-4"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {records.map((record) => {
            const title = recordLabel(
              primary ? record.values[primary.id] : undefined,
            )
            const cover = galleryCover(record, coverField)
            const details = friendlyRecordDetails(
              record,
              summaryFields ?? fields,
              {
                excludeFieldIds: new Set(
                  [primary?.id, coverField?.id].filter(
                    (value): value is string => Boolean(value),
                  ),
                ),
                limit: 4,
              },
            )
            return (
              <button
                aria-label={`Open ${title}`}
                className="overflow-hidden rounded-xl border bg-background text-left shadow-xs transition hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md"
                key={record.id}
                onClick={() => setOpenRecordId(record.id)}
                type="button"
              >
                <span className="flex aspect-[16/9] items-center justify-center overflow-hidden border-b bg-muted/40">
                  {cover?.url && cover.mimeType.startsWith("image/") ? (
                    // User-uploaded URLs are served by the configured storage provider.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={cover.name}
                      className="size-full object-cover"
                      src={cover.url}
                    />
                  ) : (
                    <span className="grid place-items-center gap-2 text-xs text-muted-foreground">
                      <ImageIcon className="size-6 opacity-50" />
                      {cover?.name ?? "No cover image"}
                    </span>
                  )}
                </span>
                <span className="block p-4">
                  <span className="block truncate font-medium">{title}</span>
                  {details.length > 0 ? (
                    <span className="mt-3 grid gap-1.5">
                      {details.map((detail) => (
                        <span
                          className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-2 text-xs"
                          key={detail.fieldId}
                        >
                          <span className="truncate text-muted-foreground">
                            {detail.label}
                          </span>
                          <span className="truncate text-right">
                            {detail.value}
                          </span>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="mt-2 block text-xs text-muted-foreground">
                      Open to see all fields
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
        {records.length === 0 ? (
          <div className="grid min-h-64 place-items-center text-sm text-muted-foreground">
            No records match this view.
          </div>
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
