"use client"

import { useMemo, useRef, useState } from "react"
import {
  Check,
  FileText,
  ImageIcon,
  Loader2,
  Plus,
  Star,
  X,
} from "lucide-react"
import { toast } from "sonner"

import type {
  AttachmentValue,
  CellValue,
  FieldDefinition,
} from "@/lib/domain"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import {
  attachmentAccept,
  attachmentKindErrorMessage,
} from "@/lib/file-selection"
import { MAX_ATTACHMENTS_PER_CELL, MAX_FILE_BYTES } from "@/lib/plans"
import { publicErrorMessage } from "@/lib/public-errors"
import { cn } from "@/lib/utils"

function localDateValue(value: number): string {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function localDateTimeValue(value: number): string {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function SelectPill({
  label,
  color,
  onRemove,
}: {
  label: string
  color: string
  onRemove?: () => void
}) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
        color,
      }}
    >
      <span className="truncate">{label}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          className="rounded-full p-0.5 hover:bg-black/5"
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
        >
          <X className="size-2.5" />
        </button>
      ) : null}
    </span>
  )
}

export function CellEditor({
  field,
  value,
  onCommit,
  onUploadFiles,
  ariaLabel,
}: {
  field: FieldDefinition
  value: CellValue | undefined
  onCommit: (value: CellValue) => void
  onUploadFiles?: (files: File[]) => Promise<void> | void
  ariaLabel?: string
}) {
  const [draft, setDraft] = useState<CellValue>(value ?? null)
  const [editingMulti, setEditingMulti] = useState(false)
  const [editingLongText, setEditingLongText] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const accessibleLabel = ariaLabel ?? field.name

  const options = useMemo(() => field.config.options ?? [], [field.config.options])

  function commit(next: CellValue) {
    setDraft(next)
    onCommit(next)
  }

  if (field.type === "autoNumber") {
    return (
      <span className="block truncate px-2.5 text-xs font-mono text-muted-foreground">
        {typeof value === "number" ? value : "—"}
      </span>
    )
  }

  if (field.type === "createdTime") {
    const timestamp = typeof value === "number" ? value : null
    return (
      <span className="block truncate px-2.5 text-xs text-muted-foreground">
        {timestamp ? new Date(timestamp).toLocaleDateString() : "—"}
      </span>
    )
  }

  if (field.type === "createdBy") {
    return (
      <span className="block truncate px-2.5 text-xs text-muted-foreground">
        {typeof value === "string" && value ? value : "—"}
      </span>
    )
  }

  if (field.type === "checkbox") {
    const checked = draft === true
    return (
      <button
        type="button"
        aria-label={`${checked ? "Uncheck" : "Check"} ${accessibleLabel}`}
        aria-pressed={checked}
        className="mx-2 grid size-5 place-items-center rounded-md border border-input bg-background transition hover:border-primary/50"
        onClick={() => commit(!checked)}
      >
        {checked ? <Check className="size-3.5 text-primary" strokeWidth={3} /> : null}
      </button>
    )
  }

  if (field.type === "rating") {
    const rating =
      typeof draft === "number" &&
      Number.isInteger(draft) &&
      draft >= 1 &&
      draft <= 5
        ? draft
        : 0
    return (
      <div
        aria-label={`${accessibleLabel}: ${rating ? `${rating} out of 5 stars` : "No rating"}`}
        className="flex h-full items-center px-1.5"
        role="group"
      >
        {Array.from({ length: 5 }, (_, index) => {
          const value = index + 1
          const selected = value <= rating
          return (
            <button
              aria-label={`Set ${accessibleLabel} to ${value} ${value === 1 ? "star" : "stars"}`}
              aria-pressed={rating === value}
              className="grid size-5 place-items-center rounded text-amber-500 outline-none transition hover:bg-amber-50 focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-amber-950/30"
              key={value}
              onClick={() => commit(value)}
              type="button"
            >
              <Star
                className={selected ? "size-3.5 fill-current" : "size-3.5"}
                strokeWidth={selected ? 1.5 : 1.8}
              />
            </button>
          )
        })}
        {rating ? (
          <button
            aria-label={`Clear ${accessibleLabel} rating`}
            className="ml-0.5 grid size-5 place-items-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => commit(null)}
            title="Clear rating"
            type="button"
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>
    )
  }

  if (field.type === "singleSelect") {
    const selected = options.find((option) => option.id === draft)
    return (
      <label className="relative flex h-full w-full cursor-pointer items-center px-2">
        {selected ? (
          <SelectPill label={selected.label} color={selected.color} />
        ) : (
          <span className="text-xs text-muted-foreground/55">Select…</span>
        )}
        <select
          aria-label={accessibleLabel}
          className="absolute inset-0 cursor-pointer opacity-0"
          value={typeof draft === "string" ? draft : ""}
          onChange={(event) => commit(event.target.value || null)}
        >
          <option value="">None</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    )
  }

  if (field.type === "multiSelect") {
    const selectedIds = Array.isArray(draft)
      ? draft.filter((item): item is string => typeof item === "string")
      : []
    const selected = selectedIds
      .map((id) => options.find((option) => option.id === id))
      .filter((option): option is NonNullable<typeof option> => Boolean(option))
    const remaining = options.filter((option) => !selectedIds.includes(option.id))

    return (
      <Popover open={editingMulti} onOpenChange={setEditingMulti}>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={`Edit ${accessibleLabel}`}
              className="flex h-full w-full min-w-0 items-center gap-1 overflow-hidden px-2 text-left"
            />
          }
        >
          {selected.length ? (
            selected
              .slice(0, 2)
              .map((option) => (
                <SelectPill
                  key={option.id}
                  label={option.label}
                  color={option.color}
                />
              ))
          ) : (
            <span className="text-xs text-muted-foreground/55">
              Add option…
            </span>
          )}
          {selected.length > 2 ? (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              +{selected.length - 2}
            </span>
          ) : null}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-64 gap-1 p-1.5"
          sideOffset={3}
        >
          <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {field.name}
          </p>
          {selected.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed="true"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
              onClick={() =>
                commit(selectedIds.filter((id) => id !== option.id))
              }
            >
              <span
                className="size-2.5 rounded-full"
                style={{ background: option.color }}
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              <Check className="size-3.5 text-primary" />
            </button>
          ))}
          {selected.length && remaining.length ? (
            <div className="my-1 h-px bg-border" />
          ) : null}
          {remaining.length ? (
            remaining.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed="false"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                onClick={() => commit([...selectedIds, option.id])}
              >
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: option.color }}
                />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            ))
          ) : selected.length ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              All options selected
            </p>
          ) : (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              Add options in field settings first.
            </p>
          )}
        </PopoverContent>
      </Popover>
    )
  }

  if (field.type === "attachment" || field.type === "image") {
    const isSingleImage = field.type === "image"
    const effectiveKind = isSingleImage ? "image" : field.config.attachmentKind
    const maxItems = isSingleImage ? 1 : MAX_ATTACHMENTS_PER_CELL
    const attachments = Array.isArray(draft)
      ? draft.filter(
          (item): item is AttachmentValue =>
            typeof item === "object" && item !== null && "name" in item,
        )
      : []

    return (
      <div className="flex h-full items-center gap-1.5 overflow-hidden px-2">
        <input
          ref={fileInputRef}
          type="file"
          aria-label={`Choose files for ${accessibleLabel}`}
          className="hidden"
          accept={attachmentAccept(effectiveKind)}
          multiple={!isSingleImage}
          onChange={async (event) => {
            const selectedFiles = Array.from(event.target.files ?? [])
            const remainingSlots = isSingleImage
              ? 1
              : Math.max(0, maxItems - attachments.length)
            const files = selectedFiles
              .filter((file) => {
                const kindError = attachmentKindErrorMessage(
                  file,
                  effectiveKind,
                )
                if (kindError) {
                  toast.error(kindError)
                  return false
                }
                if (file.size <= MAX_FILE_BYTES) return true
                toast.error(`${file.name} is larger than 25 MB`)
                return false
              })
              .slice(0, remainingSlots)
            if (!isSingleImage && selectedFiles.length > remainingSlots) {
              toast.error(`A cell can contain up to ${maxItems} files`)
            }
            event.target.value = ""
            if (!files.length) return
            if (onUploadFiles) {
              setUploading(true)
              try {
                await onUploadFiles(files)
              } catch (error) {
                toast.error("The attachment could not be uploaded", {
                  description: publicErrorMessage(error, "Please try again."),
                })
              } finally {
                setUploading(false)
              }
              return
            }
            const next = files.map<AttachmentValue>((file, index) => ({
              id: `local-${Date.now()}-${index}`,
              name: file.name,
              mimeType: file.type,
              size: file.size,
              url: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
            }))
            commit(isSingleImage ? next.slice(0, 1) : [...attachments, ...next])
          }}
        />
        {attachments.slice(0, 2).map((attachment) => {
          const content = (
            <>
              {attachment.mimeType.startsWith("image/") && attachment.url ? (
                <span
                  aria-label={`${attachment.name} thumbnail`}
                  className="size-5 shrink-0 rounded bg-cover bg-center"
                  role="img"
                  style={{ backgroundImage: `url("${attachment.url}")` }}
                />
              ) : attachment.mimeType.startsWith("image/") ? (
                <ImageIcon className="size-3 text-violet-500" />
              ) : (
                <FileText className="size-3 text-blue-500" />
              )}
              <span className="min-w-0">
                <span className="block truncate">{attachment.name}</span>
                {attachment.size > 0 ? (
                  <span className="block truncate text-[9px] text-muted-foreground">
                    {formatFileSize(attachment.size)}
                  </span>
                ) : null}
              </span>
            </>
          )

          return attachment.url ? (
            <a
              key={attachment.id}
              className="inline-flex h-8 max-w-36 items-center gap-1.5 rounded-md border bg-background px-1.5 text-[10px] hover:border-primary/40 hover:bg-muted"
              href={attachment.url}
              rel="noreferrer"
              target="_blank"
              title={`Open ${attachment.name}`}
            >
              {content}
            </a>
          ) : (
            <span
              key={attachment.id}
              className="inline-flex h-8 max-w-36 items-center gap-1.5 rounded-md border bg-background px-1.5 text-[10px]"
              title={attachment.name}
            >
              {content}
            </span>
          )
        })}
        <button
          type="button"
          aria-label={`Add attachment to ${accessibleLabel}`}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => fileInputRef.current?.click()}
          disabled={
            uploading || (!isSingleImage && attachments.length >= maxItems)
          }
        >
          {uploading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Plus className="size-3.5" />
          )}
        </button>
      </div>
    )
  }

  if (field.type === "date") {
    const includesTime = field.config.dateStyle === "dateTime"
    const dateValue =
      typeof draft === "number"
        ? includesTime
          ? localDateTimeValue(draft)
          : localDateValue(draft)
        : typeof draft === "string"
          ? draft.slice(0, includesTime ? 16 : 10)
          : ""
    return (
      <input
        type={includesTime ? "datetime-local" : "date"}
        aria-label={accessibleLabel}
        className="h-full w-full border-0 bg-transparent px-2.5 text-xs outline-none focus:bg-primary/[0.035]"
        value={dateValue}
        onChange={(event) => commit(event.target.value || null)}
      />
    )
  }

  if (
    field.type === "number" ||
    field.type === "currency" ||
    field.type === "percent"
  ) {
    const numberValue = typeof draft === "number" ? draft : ""
    const precision = Math.max(0, Math.min(field.config.precision ?? 2, 12))
    const displayedValue =
      field.type === "percent" && typeof numberValue === "number"
        ? Math.round(numberValue * 100)
        : numberValue
    return (
      <div className="relative h-full">
        <input
          type="number"
          aria-label={accessibleLabel}
          className={cn(
            "h-full w-full border-0 bg-transparent px-2.5 text-right text-xs tabular-nums outline-none focus:bg-primary/[0.035]",
            field.type === "percent" && "pr-6",
          )}
          value={displayedValue}
          min={field.type === "percent" ? 0 : undefined}
          max={field.type === "percent" ? 100 : undefined}
          step={10 ** -precision}
          onChange={(event) => {
            const next = event.target.value
              ? Number(event.target.value) / (field.type === "percent" ? 100 : 1)
              : null
            setDraft(next)
          }}
          onBlur={() => onCommit(draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur()
            if (event.key === "Escape") {
              setDraft(value ?? null)
              event.currentTarget.blur()
            }
          }}
        />
        {field.type === "percent" ? (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
            %
          </span>
        ) : null}
      </div>
    )
  }

  const textValue = typeof draft === "string" ? draft : ""

  if (field.type === "longText") {
    return (
      <Popover
        open={editingLongText}
        onOpenChange={(open) => {
          setEditingLongText(open)
          if (open) setDraft(value ?? null)
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={`Edit ${accessibleLabel}`}
              className={cn(
                "h-full w-full truncate px-2.5 text-left text-xs outline-none hover:bg-primary/[0.025]",
                field.isPrimary && "font-medium text-foreground",
              )}
            />
          }
        >
          {textValue || (
            <span className="text-muted-foreground/55">
              {field.isPrimary ? "Untitled record" : "Add text…"}
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(30rem,calc(100vw-2rem))]">
          <Textarea
            autoFocus
            aria-label={accessibleLabel}
            className="max-h-64 min-h-32 resize-y text-sm leading-6"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                commit(draft)
                setEditingLongText(false)
              }
            }}
            placeholder="Write a note…"
            value={textValue}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] text-muted-foreground">
              {textValue.length.toLocaleString()} characters ·{" "}
              <kbd className="font-sans">⌘ Enter</kbd> to save
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => {
                  setDraft(value ?? null)
                  setEditingLongText(false)
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                onClick={() => {
                  commit(draft)
                  setEditingLongText(false)
                }}
              >
                Save
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <input
      type={field.type === "email" ? "email" : field.type === "url" ? "url" : "text"}
      aria-label={accessibleLabel}
      className={cn(
        "h-full w-full border-0 bg-transparent px-2.5 text-xs outline-none focus:bg-primary/[0.035]",
        field.isPrimary && "font-medium text-foreground",
      )}
      value={textValue}
      placeholder={field.isPrimary ? "Untitled record" : ""}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && field.type !== "longText") {
          event.currentTarget.blur()
        }
        if (event.key === "Escape") {
          setDraft(value ?? null)
          event.currentTarget.blur()
        }
      }}
    />
  )
}
