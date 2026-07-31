"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { RecordDrawer } from "@/components/views/record-drawer"
import type {
  CellValue,
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"

export function UrlRecordDrawer({
  fields,
  onUpdateCell,
  onUploadAttachments,
  records,
}: {
  fields: readonly FieldDefinition[]
  onUpdateCell?: (
    recordId: string,
    fieldId: string,
    value: CellValue,
  ) => void
  onUploadAttachments?: (
    recordId: string,
    fieldId: string,
    files: File[],
  ) => Promise<void> | void
  records: readonly GridRecord[]
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedRecordId = searchParams.get("record")
  const requestedRecord = requestedRecordId
    ? records.find((record) => record.id === requestedRecordId)
    : undefined

  function closeDrawer() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("record")
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    })
  }

  return (
    <RecordDrawer
      fields={fields}
      onOpenChange={(open) => {
        if (!open) closeDrawer()
      }}
      onUpdateCell={
        onUpdateCell
          ? (recordId, fieldId, value) =>
              onUpdateCell(recordId, fieldId, value)
          : undefined
      }
      onUploadAttachments={onUploadAttachments}
      open={Boolean(requestedRecord)}
      record={requestedRecord}
    />
  )
}
