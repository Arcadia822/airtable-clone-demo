"use client"

import { LoaderCircle } from "lucide-react"

import { Button } from "@/components/ui/button"

export type RecordLayout = "grid" | "kanban" | "calendar" | "gallery"
export type RecordPageStatus =
  | "LoadingFirstPage"
  | "CanLoadMore"
  | "LoadingMore"
  | "Exhausted"

export function RecordsPageFooter({
  layout,
  onLoadMore,
  pageSize = 100,
  status,
}: {
  layout: RecordLayout
  onLoadMore: (count: number) => void
  pageSize?: number
  status: RecordPageStatus
}) {
  if (status === "CanLoadMore") {
    return (
      <div className="flex h-9 shrink-0 items-center justify-center border-t bg-muted/20">
        <Button
          aria-label={`Load ${pageSize.toLocaleString()} more records into the ${layout} view`}
          onClick={() => onLoadMore(pageSize)}
          size="xs"
          variant="ghost"
        >
          Load {pageSize.toLocaleString()} more records
        </Button>
      </div>
    )
  }

  if (status === "LoadingMore") {
    return (
      <div
        aria-label={`Loading more records into the ${layout} view`}
        className="flex h-9 shrink-0 items-center justify-center gap-2 border-t text-xs text-muted-foreground"
        role="status"
      >
        <LoaderCircle className="size-3.5 animate-spin" />
        Loading more records…
      </div>
    )
  }

  return null
}
