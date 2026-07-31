"use client"

import { CellEditor } from "@/components/grid/cell-editor"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type {
  CellValue,
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"
import { recordLabel } from "@/lib/record-workflows"

export function RecordDrawer({
  fields,
  onOpenChange,
  onUpdateCell,
  onUploadAttachments,
  open,
  record,
}: {
  fields: readonly FieldDefinition[]
  onOpenChange: (open: boolean) => void
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
  open: boolean
  record?: GridRecord
}) {
  const primary = fields.find((field) => field.isPrimary)
  const title = record
    ? recordLabel(primary ? record.values[primary.id] : undefined)
    : "Record"

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-hidden sm:max-w-lg">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            Review and update this record using its named columns.
          </SheetDescription>
        </SheetHeader>
        {record ? (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {fields.map((field) => (
              <div className="grid gap-1.5" key={field.id}>
                <p className="text-xs font-medium text-muted-foreground">
                  {field.name}
                </p>
                <div className="min-h-9 overflow-hidden rounded-lg border bg-background">
                  <CellEditor
                    ariaLabel={`${field.name} for ${title}`}
                    field={field}
                    onCommit={(value) => {
                      if (!onUpdateCell) return
                      onUpdateCell(
                        record.id,
                        field.id,
                        value,
                        record.revision,
                      )
                    }}
                    onUploadFiles={
                      onUploadAttachments &&
                      field.type === "attachment"
                        ? (files) =>
                            onUploadAttachments(
                              record.id,
                              field.id,
                              files,
                            )
                        : undefined
                    }
                    value={record.values[field.id]}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
