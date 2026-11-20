"use client"

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  AlignLeft,
  Archive,
  ArrowDownToLine,
  AtSign,
  CalendarDays,
  CheckSquare2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Columns3,
  Copy,
  CopyPlus,
  DollarSign,
  GripVertical,
  Hash,
  Image as ImageIcon,
  Link2,
  ListChecks,
  LoaderCircle,
  MoreHorizontal,
  Paperclip,
  Percent,
  Phone,
  Pin,
  PinOff,
  Plus,
  Redo2,
  Rows3,
  Search,
  Star,
  Text,
  Trash2,
  Undo2,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react"
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent,
  type ReactNode,
} from "react"
import { toast } from "sonner"

import { CellEditor } from "@/components/grid/cell-editor"
import { ConnectionStatus } from "@/components/grid/connection-status"
import { FieldValidationInputs } from "@/components/field-validation-inputs"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  CellValue,
  FieldConfig,
  FieldDefinition,
  FieldType,
  GridRecord,
} from "@/lib/domain"
import { FIELD_TYPES } from "@/lib/domain"
import { FIELD_TYPE_LABELS } from "@/lib/field-type-meta"
import { fieldConfigIssue } from "@/lib/field-config-validation"
import { createRecordsCsv, csvFileName } from "@/lib/csv-export"
import {
  clampColumnWidth,
  columnDropIndex,
  moveItemToIndex,
  type ColumnDropEdge,
} from "@/lib/column-interactions"
import {
  createGridColumnLayout,
  getGridColumnWindow,
  scrollLeftForGridColumn,
} from "@/lib/grid-column-window"
import { chunkGridCellUpdates } from "@/lib/grid-batch-updates"
import {
  clampGridCell,
  isGridCellSelected,
  moveGridSelection,
  normalizeGridSelection,
  selectedGridCells,
  type GridCellCoordinate,
  type GridSelection,
} from "@/lib/grid-selection"
import {
  formatClipboardCellValue,
  parseAndConvertClipboard,
  serializeClipboardRectangle,
} from "@/lib/spreadsheet-clipboard"
import {
  changedGridCellUpdates,
  completeGridRedo,
  completeGridUndo,
  createGridHistoryEntry,
  EMPTY_GRID_EDIT_HISTORY,
  gridHistoryUpdates,
  recordGridHistory,
  type GridEditHistory,
} from "@/lib/grid-edit-history"
import { publicErrorMessage } from "@/lib/public-errors"
import type { ConnectionHealth } from "@/lib/connection-health"
import {
  CURRENCY_OPTIONS,
  currencyOptionLabel,
} from "@/lib/currencies"
import {
  pruneRecordSelection,
  recordDeletionDescription,
  recordLabel,
  sameRecordSelection,
  selectedVisibleRecords,
  toggleRecordSelection,
  toggleVisibleRecordSelection,
} from "@/lib/record-workflows"
import { cn } from "@/lib/utils"

const ROW_HEIGHTS = {
  compact: 30,
  medium: 38,
  tall: 52,
} as const
const GROUP_HEADER_HEIGHT = 30
const ROW_NUMBER_WIDTH = 64
const COLUMN_CONTROLS_WIDTH = 48
const DEFAULT_GRID_VIEWPORT_WIDTH = 1024
const DEFAULT_GRID_VIEWPORT_HEIGHT = 600
const EMPTY_RECORD_GROUP_LABELS: Record<string, string> = {}
const EMPTY_RECORD_GROUP_COUNTS: Record<string, number> = {}
const NEW_FIELD_OPTION_COLORS = [
  "#2563eb",
  "#0891b2",
  "#ea580c",
  "#64748b",
] as const
const columnHelper = createColumnHelper<GridRecord>()

const FIELD_TYPE_ICONS: Record<FieldType, LucideIcon> = {
  singleLineText: Text,
  longText: AlignLeft,
  number: Hash,
  currency: DollarSign,
  percent: Percent,
  rating: Star,
  checkbox: CheckSquare2,
  date: CalendarDays,
  email: AtSign,
  phone: Phone,
  url: Link2,
  singleSelect: CircleDot,
  multiSelect: ListChecks,
  attachment: Paperclip,
  image: ImageIcon,
  autoNumber: Hash,
  createdTime: Clock3,
  createdBy: UserRound,
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timeout)
  }, [delay, value])
  return debounced
}

function recordFieldValue(
  record: GridRecord,
  field: FieldDefinition,
): CellValue | undefined {
  const stored = record.values[field.id]
  if (stored !== undefined) return stored
  if (field.type === "createdTime") return record.createdAt
  if (field.type === "createdBy") return record.createdBy
  return undefined
}

function searchableRecordText(
  record: GridRecord,
  fields: readonly FieldDefinition[],
) {
  return fields
    .map((field) =>
      formatClipboardCellValue(recordFieldValue(record, field), field),
    )
    .join("\u0000")
    .normalize("NFKC")
    .toLocaleLowerCase()
}

function cellValueSignature(value: CellValue | undefined) {
  if (!Array.isArray(value)) return String(value ?? "")
  return value
    .map((item) => {
      if (typeof item === "string") return item
      return [
        item.id,
        item.name,
        item.mimeType,
        item.size,
        item.url ?? "",
      ].join("\u0001")
    })
    .join("\u0002")
}

type CommitCellEdit = (
  record: GridRecord,
  field: FieldDefinition,
  nextValue: CellValue,
) => Promise<void>

const MemoizedGridCellEditor = memo(function MemoizedGridCellEditor({
  canUploadAttachments,
  cellEditorEpoch,
  commitCellEditRef,
  field,
  onUploadAttachmentsRef,
  record,
  rowIndex,
  value,
  valueSignature,
}: {
  canUploadAttachments: boolean
  cellEditorEpoch: number
  commitCellEditRef: MutableRefObject<CommitCellEdit>
  field: FieldDefinition
  onUploadAttachmentsRef: MutableRefObject<
    DataGridProps["onUploadAttachments"]
  >
  record: GridRecord
  rowIndex: number
  value: CellValue | undefined
  valueSignature: string
}) {
  return (
    <CellEditor
      key={`${record.id}-${field.id}-${record.revision}-${valueSignature}-${cellEditorEpoch}`}
      ariaLabel={`${field.name}, record ${rowIndex + 1}`}
      field={field}
      onCommit={(nextValue) =>
        void commitCellEditRef.current(record, field, nextValue)
      }
      onUploadFiles={
        (field.type === "attachment" || field.type === "image") && canUploadAttachments
          ? (files) =>
              onUploadAttachmentsRef.current?.(
                record.id,
                field.id,
                files,
              )
          : undefined
      }
      value={value}
    />
  )
}, (previous, next) =>
  previous.canUploadAttachments === next.canUploadAttachments &&
  previous.cellEditorEpoch === next.cellEditorEpoch &&
  previous.field === next.field &&
  previous.record.id === next.record.id &&
  previous.record.revision === next.record.revision &&
  previous.rowIndex === next.rowIndex &&
  previous.valueSignature === next.valueSignature
)

interface DataGridProps {
  fields: FieldDefinition[]
  records: GridRecord[]
  collaborators?: readonly GridCollaborator[]
  syncing?: boolean
  connectionHealth?: ConnectionHealth
  canManageSchema?: boolean
  rowHeight?: keyof typeof ROW_HEIGHTS
  onUpdateCell: (
    recordId: string,
    fieldId: string,
    value: CellValue,
    expectedRevision: number,
  ) => void
  onBatchUpdateCells?: (
    updates: GridCellBatchUpdate[],
  ) =>
    | GridCellBatchResult
    | GridCellBatchFailure
    | boolean
    | void
    | Promise<
        GridCellBatchResult | GridCellBatchFailure | boolean | void
      >
  onAddRecord: () => void
  onDeleteRecords: (
    records: GridRecord[],
  ) =>
    | boolean
    | void
    | { deletedRecords: GridRecord[] }
    | Promise<boolean | void | { deletedRecords: GridRecord[] }>
  onDuplicateRecords: (
    records: GridRecord[],
  ) => boolean | void | Promise<boolean | void>
  onAddField: (
    field: Pick<FieldDefinition, "name" | "type" | "config">,
  ) => boolean | void | Promise<boolean | void>
  onDeleteField: (fieldId: string) => void
  onReorderField: (
    fieldId: string,
    targetIndex: number,
  ) =>
    | boolean
    | void
    | GridFieldReorderFailure
    | Promise<boolean | void | GridFieldReorderFailure>
  onRenameField?: (
    fieldId: string,
    name: string,
  ) =>
    | boolean
    | void
    | GridFieldRenameFailure
    | Promise<boolean | void | GridFieldRenameFailure>
  onResizeField: (fieldId: string, width: number) => void
  onFreezeField?: (fieldId: string, frozen: boolean) => void
  onRowHeightChange?: (rowHeight: keyof typeof ROW_HEIGHTS) => void
  onManageFields?: () => void
  onManageField?: (fieldId: string) => void
  onDuplicateField?: (fieldId: string) => void
  onHideField?: (fieldId: string) => void
  viewControl?: ReactNode
  recordGroupCounts?: Readonly<Record<string, number>>
  recordGroupLabels?: Readonly<Record<string, string>>
  totalRecordCount?: number
  exportName?: string
  onUploadAttachments?: (
    recordId: string,
    fieldId: string,
    files: File[],
  ) => Promise<void> | void
  onActiveCellChange?: (
    location:
      | {
          fieldId: string
          recordId: string
        }
      | undefined,
  ) => void
  presenceReady?: boolean
}

export type GridCollaborator = {
  fieldId?: string
  image?: string
  isCurrentUser?: boolean
  name: string
  online: boolean
  recordId?: string
  userId: string
}

export type GridCellBatchUpdate = {
  recordId: string
  fieldId: string
  value: CellValue
  expectedRevision: number
}

export type GridCellBatchResult = {
  revisions: Array<{
    recordId: string
    revision: number
  }>
}

export type GridCellBatchFailure = {
  saved: false
  message?: string
  revisions?: GridCellBatchResult["revisions"]
  savedUpdateCount?: number
  failedUpdateCount?: number
}

type GridCellApplyOutcome = GridCellBatchResult | GridCellBatchFailure

export type GridFieldReorderFailure = {
  saved: false
  message?: string
}

export type GridFieldRenameFailure = {
  saved: false
  message?: string
}

function inferredBatchResult(
  updates: readonly GridCellBatchUpdate[],
): GridCellBatchResult {
  const revisions = new Map<string, number>()
  for (const update of updates) {
    revisions.set(update.recordId, update.expectedRevision + 1)
  }
  return {
    revisions: [...revisions].map(([recordId, revision]) => ({
      recordId,
      revision,
    })),
  }
}

function isBatchFailure(
  outcome:
    | GridCellBatchResult
    | GridCellBatchFailure
    | boolean
    | void,
): outcome is GridCellBatchFailure {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    "saved" in outcome &&
    outcome.saved === false
  )
}

function isFieldReorderFailure(
  outcome: boolean | void | GridFieldReorderFailure,
): outcome is GridFieldReorderFailure {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    "saved" in outcome &&
    outcome.saved === false
  )
}

function isFieldRenameFailure(
  outcome: boolean | void | GridFieldRenameFailure,
): outcome is GridFieldRenameFailure {
  return (
    typeof outcome === "object" &&
    outcome !== null &&
    "saved" in outcome &&
    outcome.saved === false
  )
}

function partialBatchFailure(
  totalUpdateCount: number,
  savedUpdateCount: number,
  revisions: GridCellBatchResult["revisions"],
  message?: string,
): GridCellBatchFailure {
  const failedUpdateCount = totalUpdateCount - savedUpdateCount
  if (savedUpdateCount === 0) {
    return {
      saved: false,
      message,
      revisions,
      savedUpdateCount,
      failedUpdateCount,
    }
  }
  const summary = `${savedUpdateCount.toLocaleString()} ${
    savedUpdateCount === 1 ? "cell was" : "cells were"
  } saved before a later group failed. ${failedUpdateCount.toLocaleString()} ${
    failedUpdateCount === 1 ? "cell was" : "cells were"
  } not changed.`
  return {
    saved: false,
    message: message ? `${summary} ${message}` : summary,
    revisions,
    savedUpdateCount,
    failedUpdateCount,
  }
}

function NewFieldDialog({
  onAnnounce,
  onAddField,
}: {
  onAnnounce: (message: string) => void
  onAddField: DataGridProps["onAddField"]
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [type, setType] = useState<FieldType>("singleLineText")
  const [config, setConfig] = useState<FieldConfig>({})
  const [creating, setCreating] = useState(false)

  function reset() {
    setName("")
    setType("singleLineText")
    setConfig({})
  }

  const configIssue = fieldConfigIssue(type, config)
  const canSubmit =
    Boolean(name.trim()) &&
    !configIssue &&
    (type !== "singleSelect" && type !== "multiSelect"
      ? true
      : Boolean(config.options?.length) &&
        (config.options ?? []).every((option) => option.label.trim()))

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed || !canSubmit || creating) return
    setCreating(true)
    try {
      const saved = await onAddField({
        name: trimmed,
        type,
        config,
      })
      if (saved === false) return
      reset()
      setOpen(false)
    } catch {
      const message = "Column could not be created. Your setup is still here."
      toast.error(message)
      onAnnounce(message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (creating) return
        setOpen(nextOpen)
        if (!nextOpen) reset()
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex h-full w-12 shrink-0 items-center justify-center border-l bg-muted/30 text-muted-foreground transition-colors hover:bg-primary/[0.06] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary motion-reduce:transition-none"
            aria-label="Add column"
          />
        }
      >
        <Plus className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        alignOffset={-4}
        className="max-h-[min(78dvh,720px)] w-[min(27rem,calc(100vw-1.5rem))] gap-0 overflow-hidden p-0 shadow-xl motion-reduce:!animate-none motion-reduce:!transition-none"
        side="bottom"
        sideOffset={6}
      >
        <PopoverHeader className="border-b px-4 py-3">
          <PopoverTitle>Customize new column</PopoverTitle>
          <PopoverDescription>
            Choose how this column should collect and validate data.
          </PopoverDescription>
        </PopoverHeader>
        <div className="grid min-h-0 gap-4 overflow-y-auto px-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="field-name">Column name</Label>
            <Input
              id="field-name"
              autoFocus
              value={name}
              placeholder="e.g. Launch owner"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void submit()
                }
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-field-type">Column type</Label>
            <select
              aria-label="Column type"
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
              id="new-field-type"
              onChange={(event) => {
                const nextType = event.target.value as FieldType
                setType(nextType)
                setConfig(defaultNewFieldConfig(nextType))
              }}
              value={type}
            >
              {FIELD_TYPES.filter(
                (fieldType) =>
                  fieldType !== "createdBy" && fieldType !== "createdTime",
              ).map((fieldType) => (
                <option key={fieldType} value={fieldType}>
                  {FIELD_TYPE_LABELS[fieldType]}
                </option>
              ))}
            </select>
          </div>

          <FieldValidationInputs
            config={config}
            idPrefix="new-field"
            onChange={setConfig}
            type={type}
          />

          {type === "singleSelect" || type === "multiSelect" ? (
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Select options</Label>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {config.options?.length ?? 0}/250
                </span>
              </div>
              <div className="grid gap-2">
                {(config.options ?? []).map((option, optionIndex) => (
                  <div
                    className="grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-2"
                    key={option.id}
                  >
                    <input
                      aria-label={`Color for option ${optionIndex + 1}`}
                      className="size-8 cursor-pointer rounded-md border bg-background p-1"
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          options: (current.options ?? []).map((candidate) =>
                            candidate.id === option.id
                              ? { ...candidate, color: event.target.value }
                              : candidate,
                          ),
                        }))
                      }
                      type="color"
                      value={option.color}
                    />
                    <Input
                      aria-label={`Option ${optionIndex + 1} label`}
                      className="h-8"
                      maxLength={120}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          options: (current.options ?? []).map((candidate) =>
                            candidate.id === option.id
                              ? { ...candidate, label: event.target.value }
                              : candidate,
                          ),
                        }))
                      }
                      value={option.label}
                    />
                    <Button
                      aria-label={`Remove option ${optionIndex + 1}`}
                      disabled={(config.options?.length ?? 0) <= 1}
                      onClick={() =>
                        setConfig((current) => ({
                          ...current,
                          options: (current.options ?? []).filter(
                            (candidate) => candidate.id !== option.id,
                          ),
                        }))
                      }
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                className="w-fit"
                disabled={(config.options?.length ?? 0) >= 250}
                onClick={() =>
                  setConfig((current) => {
                    const options = current.options ?? []
                    const optionIndex = options.length
                    return {
                      ...current,
                      options: [
                        ...options,
                        {
                          id: `option_${crypto.randomUUID()}`,
                          label: `Option ${optionIndex + 1}`,
                          color:
                            NEW_FIELD_OPTION_COLORS[
                              optionIndex % NEW_FIELD_OPTION_COLORS.length
                            ]!,
                        },
                      ],
                    }
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus />
                Add option
              </Button>
            </div>
          ) : null}

          {type === "number" ||
          type === "currency" ||
          type === "percent" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="new-field-precision">Decimal places</Label>
                <Input
                  id="new-field-precision"
                  max={12}
                  min={0}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      precision: Math.max(
                        0,
                        Math.min(12, Math.trunc(Number(event.target.value))),
                      ),
                    }))
                  }
                  type="number"
                  value={config.precision ?? 0}
                />
              </div>
              {type === "currency" ? (
                <div className="grid gap-2">
                  <Label htmlFor="new-field-currency">Currency</Label>
                  <select
                    aria-label="Currency"
                    className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                    id="new-field-currency"
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        currency: event.target.value,
                      }))
                    }
                    value={config.currency ?? "USD"}
                  >
                    {CURRENCY_OPTIONS.map((option) => (
                      <option key={option.code} value={option.code}>
                        {currencyOptionLabel(option)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
          ) : null}

          {type === "rating" ? (
            <div className="flex items-center gap-3 rounded-xl border bg-muted/25 p-3">
              <div
                aria-label="Ratings use one to five stars"
                className="flex gap-0.5 text-amber-500"
                role="img"
              >
                {Array.from({ length: 5 }, (_, index) => (
                  <Star
                    className="size-4 fill-current"
                    key={index}
                    strokeWidth={1.5}
                  />
                ))}
              </div>
              <div>
                <p className="text-sm font-medium">One to five stars</p>
                <p className="text-xs text-muted-foreground">
                  People can choose a whole-number rating.
                </p>
              </div>
            </div>
          ) : null}

          {type === "date" ? (
            <div className="grid gap-2">
              <Label htmlFor="new-field-date-style">Date input</Label>
              <select
                aria-label="Date input"
                className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                id="new-field-date-style"
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    dateStyle: event.target.value as "date" | "dateTime",
                  }))
                }
                value={config.dateStyle ?? "date"}
              >
                <option value="date">Date only</option>
                <option value="dateTime">Date and time</option>
              </select>
            </div>
          ) : null}

          {type === "attachment" ? (
            <div className="grid gap-2">
              <Label>Accepted files</Label>
              <div
                aria-label="Accepted files"
                className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/35 p-1"
                role="radiogroup"
              >
                {[
                  { label: "Any", value: "any" },
                  { label: "Images", value: "image" },
                  { label: "Files", value: "file" },
                ].map((option) => {
                  const selected =
                    (config.attachmentKind ?? "any") === option.value
                  return (
                    <button
                      aria-checked={selected}
                      className={cn(
                        "h-7 rounded-md px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                        selected
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-background/65 hover:text-foreground",
                      )}
                      key={option.value}
                      onClick={() =>
                        setConfig((current) => ({
                          ...current,
                          attachmentKind: option.value as
                            | "image"
                            | "file"
                            | "any",
                        }))
                      }
                      role="radio"
                      type="button"
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {(config.attachmentKind ?? "any") === "image"
                  ? "Only image uploads are accepted."
                  : (config.attachmentKind ?? "any") === "file"
                    ? "Images are excluded; other files are accepted."
                    : "Images and other files are accepted."}
              </p>
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t bg-muted/20 px-4 py-3">
          <Button
            disabled={creating}
            onClick={() => setOpen(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={!canSubmit || creating}
            type="button"
          >
            {creating ? (
              <>
                <LoaderCircle className="animate-spin motion-reduce:!animate-none" />
                Creating…
              </>
            ) : (
              "Create column"
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function defaultNewFieldConfig(type: FieldType): FieldConfig {
  if (type === "singleSelect" || type === "multiSelect") {
    return {
      options: [
        { id: "option_1", label: "Option 1", color: "#2563eb" },
        { id: "option_2", label: "Option 2", color: "#0891b2" },
      ],
    }
  }
  if (type === "attachment") return { attachmentKind: "any" }
  if (type === "image") return { attachmentKind: "image" }
  if (type === "date") return { dateStyle: "date" }
  if (type === "currency") return { currency: "USD", precision: 2 }
  if (type === "rating") return { min: 1, max: 5, precision: 0 }
  if (type === "number" || type === "percent") return { precision: 0 }
  return {}
}

export function DataGrid({
  fields: sourceFields,
  records,
  collaborators = [],
  syncing = false,
  connectionHealth,
  canManageSchema = true,
  rowHeight = "medium",
  onUpdateCell,
  onBatchUpdateCells,
  onAddRecord,
  onDeleteRecords,
  onDuplicateRecords,
  onAddField,
  onDeleteField,
  onReorderField,
  onRenameField,
  onResizeField,
  onFreezeField,
  onRowHeightChange,
  onManageFields,
  onManageField,
  onDuplicateField,
  onHideField,
  onUploadAttachments,
  viewControl,
  recordGroupCounts = EMPTY_RECORD_GROUP_COUNTS,
  recordGroupLabels = EMPTY_RECORD_GROUP_LABELS,
  totalRecordCount,
  exportName,
  onActiveCellChange,
  presenceReady = false,
}: DataGridProps) {
  const dataRowHeight = ROW_HEIGHTS[rowHeight]
  const displayedConnectionHealth: ConnectionHealth =
    connectionHealth ??
    (syncing
      ? {
          kind: "saving",
          label: "Saving",
          description: "Saving your latest changes…",
          canStartWrite: true,
        }
      : {
          kind: "live",
          label: "Live",
          description: "All changes are saved.",
          canStartWrite: true,
        })
  const [optimisticFieldOrder, setOptimisticFieldOrder] = useState<
    string[] | undefined
  >()
  const [optimisticFieldNames, setOptimisticFieldNames] = useState<
    Record<string, { previous: string; next: string }>
  >({})
  const [fieldOrderPending, setFieldOrderPending] = useState(false)
  const fields = useMemo(() => {
    const withOptimisticNames = sourceFields.map((field) => {
      const optimistic = optimisticFieldNames[field.id]
      return optimistic && field.name === optimistic.previous
        ? { ...field, name: optimistic.next }
        : field
    })
    if (!optimisticFieldOrder) return withOptimisticNames
    const fieldsById = new Map(
      withOptimisticNames.map((field) => [field.id, field]),
    )
    const ordered = optimisticFieldOrder.flatMap((fieldId) => {
      const field = fieldsById.get(fieldId)
      if (!field) return []
      fieldsById.delete(fieldId)
      return [field]
    })
    return [...ordered, ...fieldsById.values()]
  }, [optimisticFieldNames, optimisticFieldOrder, sourceFields])
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const dragSelectionRef = useRef<{
    anchor: GridCellCoordinate
    pointerId: number
  } | null>(null)
  const headerDragStateRef = useRef<{
    active: boolean
    fieldId: string
    pointerId: number
    startX: number
    startY: number
    originalFieldIds: string[]
    target?: {
      edge: ColumnDropEdge
      fieldId: string
    }
  } | null>(null)
  const finishColumnDragRef = useRef<(pointerId?: number) => void>(() => {})
  const fieldOrderWriteInFlightRef = useRef(false)
  const fieldRenameWriteInFlightRef = useRef<string | undefined>(
    undefined,
  )
  const resizeStateRef = useRef<{
    fieldId: string
    pointerId: number
    startWidth: number
    startX: number
    width: number
  } | null>(null)
  const cellWriteInFlightRef = useRef(false)
  const observedFieldWidthsRef = useRef<Record<string, number>>(
    Object.fromEntries(fields.map((field) => [field.id, field.width])),
  )
  const [query, setQuery] = useState("")
  const [selection, setSelection] = useState<GridSelection>()
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [pendingRecordDeletion, setPendingRecordDeletion] = useState<
    GridRecord[]
  >([])
  const [recordAction, setRecordAction] = useState<
    "duplicate" | "delete"
  >()
  const [renamingFieldId, setRenamingFieldId] = useState<string>()
  const [renameDraft, setRenameDraft] = useState("")
  const [fieldRenamePendingId, setFieldRenamePendingId] =
    useState<string>()
  const [draggedFieldId, setDraggedFieldId] = useState<string>()
  const [dropTarget, setDropTarget] = useState<{
    edge: ColumnDropEdge
    fieldId: string
  }>()
  const [previewWidths, setPreviewWidths] = useState<Record<string, number>>({})
  const [editHistory, setEditHistory] = useState<GridEditHistory>(
    () => EMPTY_GRID_EDIT_HISTORY,
  )
  const [historyAction, setHistoryAction] = useState<
    "undo" | "redo"
  >()
  const [cellWritePending, setCellWritePending] = useState(false)
  const [cellEditorEpoch, setCellEditorEpoch] = useState(0)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  )
  const [horizontalViewport, setHorizontalViewport] = useState({
    scrollLeft: 0,
    width: DEFAULT_GRID_VIEWPORT_WIDTH,
  })
  const announcementSequenceRef = useRef(0)
  const [announcement, setAnnouncement] = useState({
    message: "",
    sequence: 0,
  })
  const gridInstructionsId = useId()

  useEffect(() => {
    if (!optimisticFieldOrder || !fieldOrderPending) return
    const sourceOrder = sourceFields.map((field) => field.id)
    if (
      sourceOrder.length === optimisticFieldOrder.length &&
      sourceOrder.every(
        (fieldId, index) => fieldId === optimisticFieldOrder[index],
      )
    ) {
      setOptimisticFieldOrder(undefined)
      setFieldOrderPending(false)
    }
  }, [fieldOrderPending, optimisticFieldOrder, sourceFields])

  const announce = useCallback((message: string) => {
    announcementSequenceRef.current += 1
    setAnnouncement({
      message,
      sequence: announcementSequenceRef.current,
    })
  }, [])

  const reportGridError = useCallback(
    (title: string, description?: string) => {
      toast.error(title, description ? { description } : undefined)
      announce(description ? `${title}. ${description}` : title)
    },
    [announce],
  )

  useEffect(() => {
    const previousWidths = observedFieldWidthsRef.current
    const currentWidths = Object.fromEntries(
      fields.map((field) => [field.id, field.width]),
    )
    observedFieldWidthsRef.current = currentWidths
    setPreviewWidths((current) => {
      let changed = false
      const next = { ...current }
      for (const fieldId of Object.keys(next)) {
        if (
          currentWidths[fieldId] === undefined ||
          (previousWidths[fieldId] !== undefined &&
            currentWidths[fieldId] !== previousWidths[fieldId])
        ) {
          delete next[fieldId]
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [fields])

  useEffect(
    () => () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    },
    [],
  )

  const measureHorizontalViewport = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    const nextViewport = {
      scrollLeft: Math.max(0, element.scrollLeft),
      width: element.clientWidth || DEFAULT_GRID_VIEWPORT_WIDTH,
    }
    setHorizontalViewport((current) =>
      current.scrollLeft === nextViewport.scrollLeft &&
      current.width === nextViewport.width
        ? current
        : nextViewport,
    )
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    measureHorizontalViewport()
    const observer = new ResizeObserver(measureHorizontalViewport)
    observer.observe(element)
    return () => observer.disconnect()
  }, [measureHorizontalViewport])

  const debouncedQuery = useDebouncedValue(query, 150)
  const searchableTextByRecordId = useMemo(
    () =>
      new Map(
        records.map((record) => [
          record.id,
          searchableRecordText(record, fields),
        ]),
      ),
    [fields, records],
  )
  const filteredRecords = useMemo(() => {
    const normalized = debouncedQuery
      .trim()
      .normalize("NFKC")
      .toLocaleLowerCase()
    if (!normalized) return records
    return records.filter((record) =>
      searchableTextByRecordId.get(record.id)?.includes(normalized),
    )
  }, [debouncedQuery, records, searchableTextByRecordId])
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const record of filteredRecords) {
      const label = recordGroupLabels[record.id]
      if (!label) continue
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    return counts
  }, [filteredRecords, recordGroupLabels])
  const displayedRecords = useMemo(
    () =>
      filteredRecords.filter((record) => {
        const label = recordGroupLabels[record.id]
        return !label || !collapsedGroups.has(label)
      }),
    [collapsedGroups, filteredRecords, recordGroupLabels],
  )
  const visibleRecordIds = useMemo(
    () => displayedRecords.map((record) => record.id),
    [displayedRecords],
  )
  const visibleRecordIdSet = useMemo(
    () => new Set(visibleRecordIds),
    [visibleRecordIds],
  )
  const selectedRecords = useMemo(
    () => selectedVisibleRecords(displayedRecords, selectedRecordIds),
    [displayedRecords, selectedRecordIds],
  )
  const allVisibleRecordsSelected =
    visibleRecordIds.length > 0 &&
    selectedRecords.length === visibleRecordIds.length
  const someVisibleRecordsSelected =
    selectedRecords.length > 0 && !allVisibleRecordsSelected

  useEffect(() => {
    setSelectedRecordIds((current) => {
      const next = pruneRecordSelection(current, visibleRecordIdSet)
      return sameRecordSelection(current, next) ? current : next
    })
  }, [visibleRecordIdSet])

  useEffect(() => {
    setCollapsedGroups((current) => {
      const next = new Set(
        [...current].filter((label) => groupCounts.has(label)),
      )
      return next.size === current.size ? current : next
    })
  }, [groupCounts])

  const applyCellUpdates = useCallback(
    async (
      updates: GridCellBatchUpdate[],
    ): Promise<GridCellApplyOutcome> => {
      if (!updates.length) return { revisions: [] }
      const revisions = new Map<string, number>()
      let savedUpdateCount = 0

      for (const unpreparedChunk of chunkGridCellUpdates(updates)) {
        const chunk = unpreparedChunk.map((update) => {
          const latestRevision = revisions.get(update.recordId)
          return latestRevision === undefined
            ? update
            : { ...update, expectedRevision: latestRevision }
        })
        try {
          let result: GridCellBatchResult
          if (onBatchUpdateCells) {
            const outcome = await onBatchUpdateCells(chunk)
            if (outcome === false) {
              return partialBatchFailure(
                updates.length,
                savedUpdateCount,
                [...revisions].map(([recordId, revision]) => ({
                  recordId,
                  revision,
                })),
              )
            }
            if (isBatchFailure(outcome)) {
              return partialBatchFailure(
                updates.length,
                savedUpdateCount,
                [...revisions].map(([recordId, revision]) => ({
                  recordId,
                  revision,
                })),
                outcome.message,
              )
            }
            result =
              typeof outcome === "object" &&
              outcome !== null &&
              "revisions" in outcome
                ? outcome
                : inferredBatchResult(chunk)
          } else {
            for (const update of chunk) {
              onUpdateCell(
                update.recordId,
                update.fieldId,
                update.value,
                update.expectedRevision,
              )
            }
            result = inferredBatchResult(chunk)
          }
          for (const revision of result.revisions) {
            revisions.set(revision.recordId, revision.revision)
          }
          savedUpdateCount += unpreparedChunk.length
        } catch (error) {
          return partialBatchFailure(
            updates.length,
            savedUpdateCount,
            [...revisions].map(([recordId, revision]) => ({
              recordId,
              revision,
            })),
            publicErrorMessage(error),
          )
        }
      }

      return {
        revisions: [...revisions].map(([recordId, revision]) => ({
          recordId,
          revision,
        })),
      }
    },
    [onBatchUpdateCells, onUpdateCell],
  )

  const commitTrackedCellUpdates = useCallback(
    async (updates: GridCellBatchUpdate[], label: string) => {
      const changedUpdates = changedGridCellUpdates(updates, records)
      if (!changedUpdates.length) {
        return {
          outcome: { revisions: [] } satisfies GridCellBatchResult,
          updates: changedUpdates,
        }
      }
      if (cellWriteInFlightRef.current) {
        return {
          outcome: {
            saved: false,
            message:
              "Another cell change is still saving. Wait a moment and try again.",
          } satisfies GridCellBatchFailure,
          updates: changedUpdates,
        }
      }

      cellWriteInFlightRef.current = true
      setCellWritePending(true)
      try {
        const outcome = await applyCellUpdates(changedUpdates)
        if (isBatchFailure(outcome)) {
          const savedUpdates = changedUpdates.slice(
            0,
            outcome.savedUpdateCount ?? 0,
          )
          const savedLabel = label.startsWith("Paste ")
            ? `Paste ${savedUpdates.length} ${
                savedUpdates.length === 1 ? "cell" : "cells"
              }`
            : `${label} (saved portion)`
          const entry = createGridHistoryEntry(
            savedLabel,
            savedUpdates,
            records,
            outcome.revisions ?? [],
          )
          setEditHistory((current) =>
            entry
              ? recordGridHistory(current, entry)
              : EMPTY_GRID_EDIT_HISTORY,
          )
          return { outcome, updates: changedUpdates }
        }
        const entry = createGridHistoryEntry(
          label,
          changedUpdates,
          records,
          outcome.revisions,
        )
        if (entry) {
          setEditHistory((current) => recordGridHistory(current, entry))
        } else {
          setEditHistory(EMPTY_GRID_EDIT_HISTORY)
        }
        return { outcome, updates: changedUpdates }
      } finally {
        cellWriteInFlightRef.current = false
        setCellWritePending(false)
      }
    },
    [applyCellUpdates, records],
  )

  const commitCellEdit = useCallback(
    async (
      record: GridRecord,
      field: FieldDefinition,
      nextValue: CellValue,
    ) => {
      const result = await commitTrackedCellUpdates(
        [
          {
            recordId: record.id,
            fieldId: field.id,
            value: nextValue,
            expectedRevision: record.revision,
          },
        ],
        `Edit ${field.name}`,
      )
      if (isBatchFailure(result.outcome)) {
        setCellEditorEpoch((epoch) => epoch + 1)
        reportGridError(
          "Change was not saved",
          result.outcome.message ??
            "The cell kept its previous value. Refresh and try again.",
        )
      }
    },
    [commitTrackedCellUpdates, reportGridError],
  )
  const commitCellEditRef = useRef<CommitCellEdit>(commitCellEdit)
  commitCellEditRef.current = commitCellEdit
  const onUploadAttachmentsRef = useRef(onUploadAttachments)
  onUploadAttachmentsRef.current = onUploadAttachments
  const canUploadAttachments = Boolean(onUploadAttachments)

  const columns = useMemo<ColumnDef<GridRecord, CellValue>[]>(
    () =>
      fields.map((field) =>
        columnHelper.accessor((record) => record.values[field.id] ?? null, {
          id: field.id,
          size: previewWidths[field.id] ?? field.width,
          minSize: 100,
          maxSize: 600,
          header: field.name,
          cell: ({ row, getValue }) => {
            const value = getValue()
            return (
              <MemoizedGridCellEditor
                canUploadAttachments={canUploadAttachments}
                cellEditorEpoch={cellEditorEpoch}
                commitCellEditRef={commitCellEditRef}
                field={field}
                value={value}
                onUploadAttachmentsRef={onUploadAttachmentsRef}
                record={row.original}
                rowIndex={row.index}
                valueSignature={cellValueSignature(value)}
              />
            )
          },
        }),
      ),
    [canUploadAttachments, cellEditorEpoch, fields, previewWidths],
  )

  // TanStack Table intentionally returns a mutable table instance; React Compiler
  // correctly leaves this component unmemoized.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: displayedRecords,
    columns,
    getCoreRowModel: getCoreRowModel(),
    defaultColumn: {
      minSize: 100,
      maxSize: 600,
    },
  })

  const rows = table.getRowModel().rows
  const columnLayout = useMemo(
    () =>
      createGridColumnLayout(
        fields.map((field) => ({
          frozen: field.frozen,
          width: previewWidths[field.id] ?? field.width,
        })),
        ROW_NUMBER_WIDTH,
      ),
    [fields, previewWidths],
  )
  const columnWindow = useMemo(
    () =>
      getGridColumnWindow(
        columnLayout,
        horizontalViewport.scrollLeft,
        horizontalViewport.width,
      ),
    [columnLayout, horizontalViewport],
  )
  const renderedColumnIndexes = columnWindow.indexes
  const totalWidth =
    columnLayout.contentWidth + COLUMN_CONTROLS_WIDTH
  const rowsByRecordId = useMemo(
    () => new Map(rows.map((row) => [row.original.id, row])),
    [rows],
  )
  const renderItems = useMemo(() => {
    const items: Array<
      | {
          kind: "group"
          label: string
          count: number
          collapsed: boolean
        }
      | {
          kind: "record"
          row: (typeof rows)[number]
        }
    > = []
    let previousLabel: string | undefined

    for (const record of filteredRecords) {
      const label = recordGroupLabels[record.id]
      if (label && label !== previousLabel) {
        items.push({
          kind: "group",
          label,
          count: recordGroupCounts[label] ?? groupCounts.get(label) ?? 0,
          collapsed: collapsedGroups.has(label),
        })
      }
      previousLabel = label
      if (label && collapsedGroups.has(label)) continue
      const row = rowsByRecordId.get(record.id)
      if (row) items.push({ kind: "record", row })
    }

    return items
  }, [
    collapsedGroups,
    filteredRecords,
    groupCounts,
    recordGroupCounts,
    recordGroupLabels,
    rowsByRecordId,
  ])
  const virtualIndexByRecordRow = useMemo(() => {
    const indexes = new Map<number, number>()
    renderItems.forEach((item, virtualIndex) => {
      if (item.kind === "record") {
        indexes.set(item.row.index, virtualIndex)
      }
    })
    return indexes
  }, [renderItems])
  const renderLayoutKey = useMemo(
    () =>
      renderItems
        .map((item) =>
          item.kind === "group"
            ? `group:${item.label}:${item.collapsed ? "closed" : "open"}`
            : "record",
        )
        .join("|"),
    [renderItems],
  )
  const activeCell = selection?.focus ?? (
    rows.length && fields.length ? { row: 0, column: 0 } : undefined
  )
  const activePresenceRecordId = activeCell
    ? rows[activeCell.row]?.original.id
    : undefined
  const activePresenceFieldId = activeCell
    ? fields[activeCell.column]?.id
    : undefined
  const collaboratorsByCell = useMemo(() => {
    const byCell = new Map<string, GridCollaborator[]>()
    for (const collaborator of collaborators) {
      if (
        !collaborator.online ||
        collaborator.isCurrentUser ||
        !collaborator.recordId ||
        !collaborator.fieldId
      ) {
        continue
      }
      const key = `${collaborator.recordId}:${collaborator.fieldId}`
      const existing = byCell.get(key)
      if (existing) existing.push(collaborator)
      else byCell.set(key, [collaborator])
    }
    return byCell
  }, [collaborators])

  useEffect(() => {
    if (!onActiveCellChange || !presenceReady) return
    const timeout = window.setTimeout(() => {
      onActiveCellChange(
        activePresenceRecordId && activePresenceFieldId
          ? {
              recordId: activePresenceRecordId,
              fieldId: activePresenceFieldId,
            }
          : undefined,
      )
    }, 280)
    return () => window.clearTimeout(timeout)
  }, [
    activePresenceFieldId,
    activePresenceRecordId,
    onActiveCellChange,
    presenceReady,
  ])

  const rowVirtualizer = useVirtualizer({
    count: renderItems.length,
    getScrollElement: () => scrollRef.current,
    initialRect: {
      height: DEFAULT_GRID_VIEWPORT_HEIGHT,
      width: DEFAULT_GRID_VIEWPORT_WIDTH,
    },
    estimateSize: (index) =>
      renderItems[index]?.kind === "group"
        ? GROUP_HEADER_HEIGHT
        : dataRowHeight,
    overscan: 12,
  })
  const rowVirtualizerRef = useRef(rowVirtualizer)
  rowVirtualizerRef.current = rowVirtualizer

  useEffect(() => {
    rowVirtualizerRef.current.measure()
  }, [dataRowHeight, renderLayoutKey])

  useEffect(() => {
    if (!selection) return
    if (!rows.length || !fields.length) {
      setSelection(undefined)
      return
    }
    const anchor = clampGridCell(
      selection.anchor,
      rows.length,
      fields.length,
    )
    const focus = clampGridCell(
      selection.focus,
      rows.length,
      fields.length,
    )
    if (
      anchor.row !== selection.anchor.row ||
      anchor.column !== selection.anchor.column ||
      focus.row !== selection.focus.row ||
      focus.column !== selection.focus.column
    ) {
      setSelection({ anchor, focus })
    }
  }, [fields.length, rows.length, selection])

  useEffect(() => {
    function finishPointerSelection(event: globalThis.PointerEvent) {
      dragSelectionRef.current = null
      finishColumnDragRef.current(event.pointerId)
    }
    function finishMouseColumnDrag() {
      finishColumnDragRef.current()
    }
    window.addEventListener("pointerup", finishPointerSelection)
    window.addEventListener("pointercancel", finishPointerSelection)
    window.addEventListener("mouseup", finishMouseColumnDrag)
    return () => {
      window.removeEventListener("pointerup", finishPointerSelection)
      window.removeEventListener("pointercancel", finishPointerSelection)
      window.removeEventListener("mouseup", finishMouseColumnDrag)
    }
  }, [])

  const focusSelection = useCallback(
    (nextSelection: GridSelection | undefined) => {
      if (!nextSelection) return
      setSelection(nextSelection)
      rowVirtualizer.scrollToIndex(
        virtualIndexByRecordRow.get(nextSelection.focus.row) ??
          nextSelection.focus.row,
        {
        align: "auto",
        },
      )
      const scrollElement = scrollRef.current
      if (scrollElement) {
        const nextScrollLeft = scrollLeftForGridColumn(
          columnLayout,
          nextSelection.focus.column,
          scrollElement.scrollLeft,
          scrollElement.clientWidth || horizontalViewport.width,
          COLUMN_CONTROLS_WIDTH,
        )
        if (nextScrollLeft !== scrollElement.scrollLeft) {
          scrollElement.scrollLeft = nextScrollLeft
          setHorizontalViewport((current) => ({
            ...current,
            scrollLeft: nextScrollLeft,
          }))
        }
      }
      requestAnimationFrame(() => gridRef.current?.focus())
    },
    [
      columnLayout,
      horizontalViewport.width,
      rowVirtualizer,
      virtualIndexByRecordRow,
    ],
  )

  const moveSelection = useCallback(
    (
      delta: GridCellCoordinate,
      extend: boolean,
    ) => {
      focusSelection(
        moveGridSelection(
          selection,
          delta,
          rows.length,
          fields.length,
          extend,
        ),
      )
    },
    [fields.length, focusSelection, rows.length, selection],
  )

  function isEditableTarget(target: EventTarget | null) {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    )
  }

  function currentSelection(): GridSelection | undefined {
    if (selection) return selection
    if (!activeCell) return undefined
    return { anchor: activeCell, focus: activeCell }
  }

  function selectAllVisibleRecords(selected: boolean) {
    setSelectedRecordIds((current) =>
      toggleVisibleRecordSelection(current, visibleRecordIds, selected),
    )
  }

  function selectRecord(recordId: string, selected: boolean) {
    setSelectedRecordIds((current) =>
      toggleRecordSelection(current, recordId, selected),
    )
  }

  async function duplicateRecords(recordsToDuplicate: GridRecord[]) {
    if (!recordsToDuplicate.length || recordAction) return
    setRecordAction("duplicate")
    try {
      await onDuplicateRecords(recordsToDuplicate)
    } catch {
      reportGridError(
        "Records could not be duplicated",
        "The original records are unchanged and remain selected so you can try again.",
      )
    } finally {
      setRecordAction(undefined)
    }
  }

  function requestRecordDeletion(recordsToDelete: GridRecord[]) {
    if (!recordsToDelete.length || recordAction) return
    setPendingRecordDeletion(recordsToDelete)
  }

  async function confirmRecordDeletion() {
    if (!pendingRecordDeletion.length || recordAction) return
    setRecordAction("delete")
    try {
      const removed = await onDeleteRecords(pendingRecordDeletion)
      if (removed === false) return
      const removedRecords =
        typeof removed === "object" && removed !== null
          ? removed.deletedRecords
          : pendingRecordDeletion
      const deletedIds = new Set(
        removedRecords.map((record) => record.id),
      )
      setSelectedRecordIds((current) => {
        const next = new Set(current)
        for (const recordId of deletedIds) next.delete(recordId)
        return next
      })
      setPendingRecordDeletion([])
    } catch {
      reportGridError(
        "Records were not deleted",
        "Nothing was removed. The records remain selected so you can try again.",
      )
    } finally {
      setRecordAction(undefined)
    }
  }

  function handleGridCopy(event: ClipboardEvent<HTMLDivElement>) {
    if (isEditableTarget(event.target)) return
    const selected = currentSelection()
    if (!selected) return
    const range = normalizeGridSelection(selected)
    const selectedRecords = displayedRecords.slice(
      range.firstRow,
      range.lastRow + 1,
    )
    const selectedFields = fields.slice(
      range.firstColumn,
      range.lastColumn + 1,
    )
    if (!selectedRecords.length || !selectedFields.length) return
    event.preventDefault()
    event.clipboardData.setData(
      "text/plain",
      serializeClipboardRectangle(selectedRecords, selectedFields),
    )
    const count = selectedRecords.length * selectedFields.length
    const message = `${count} ${count === 1 ? "cell" : "cells"} copied`
    toast.success(message)
    announce(message)
  }

  async function handleGridPaste(event: ClipboardEvent<HTMLDivElement>) {
    if (isEditableTarget(event.target)) return
    const selected = currentSelection()
    if (!selected) return
    const input = event.clipboardData.getData("text/plain")
    if (!input) return
    event.preventDefault()

    const start = selected.focus
    const destinationFields = fields.slice(start.column)
    const conversion = parseAndConvertClipboard(input, destinationFields)
    const lastTargetRow =
      start.row +
      Math.max(0, conversion.rows.length - 1)
    if (lastTargetRow >= displayedRecords.length) {
      reportGridError(
        "The pasted rows do not fit in the current view",
        "Choose a starting row with enough records below it, then try again.",
      )
      return
    }
    if (conversion.errors.length) {
      reportGridError(
        conversion.summary,
        conversion.errors
          .slice(0, 3)
          .map(
            (error) =>
              `Row ${error.rowNumber}, ${error.columnName}: ${error.message}`,
          )
          .join(" "),
      )
      return
    }

    const updates: GridCellBatchUpdate[] = conversion.cells.flatMap(
      (cell) => {
        const record =
          displayedRecords[start.row + cell.rowNumber - 1]
        return record
          ? [
              {
                recordId: record.id,
                fieldId: cell.fieldId,
                value: cell.value,
                expectedRevision: record.revision,
              },
            ]
          : []
      },
    )
    const changedUpdates = changedGridCellUpdates(updates, records)
    const result = await commitTrackedCellUpdates(
      changedUpdates,
      `Paste ${changedUpdates.length} ${
        changedUpdates.length === 1 ? "cell" : "cells"
      }`,
    )
    if (isBatchFailure(result.outcome)) {
      setCellEditorEpoch((epoch) => epoch + 1)
      const partlySaved = (result.outcome.savedUpdateCount ?? 0) > 0
      reportGridError(
        partlySaved ? "Paste was partly saved" : "Paste was not saved",
        result.outcome.message ??
          "The original cell values were kept. Refresh and try again.",
      )
      return
    }
    const pastedRows = conversion.rows.length
    const pastedColumns = Math.max(
      0,
      ...conversion.rows.map((row) => Object.keys(row).length),
    )
    setSelection({
      anchor: start,
      focus: clampGridCell(
        {
          row: start.row + Math.max(0, pastedRows - 1),
          column: start.column + Math.max(0, pastedColumns - 1),
        },
        displayedRecords.length,
        fields.length,
      ),
    })
    const message = result.updates.length
      ? `${result.updates.length} ${
          result.updates.length === 1 ? "cell" : "cells"
        } pasted`
      : "Paste complete. No cell values changed."
    toast.success(message)
    announce(message)
  }

  async function clearSelectedCells() {
    const selected = currentSelection()
    if (!selected) return
    const updates = selectedGridCells(selected).flatMap((cell) => {
      const record = displayedRecords[cell.row]
      const field = fields[cell.column]
      if (
        !record ||
        !field ||
        field.type === "autoNumber" ||
        field.type === "createdTime" ||
        field.type === "createdBy"
      ) {
        return []
      }
      return [
        {
          recordId: record.id,
          fieldId: field.id,
          value: null,
          expectedRevision: record.revision,
        },
      ]
    })
    const changedUpdates = changedGridCellUpdates(updates, records)
    const result = await commitTrackedCellUpdates(
      changedUpdates,
      `Clear ${changedUpdates.length} ${
        changedUpdates.length === 1 ? "cell" : "cells"
      }`,
    )
    if (isBatchFailure(result.outcome)) {
      setCellEditorEpoch((epoch) => epoch + 1)
      reportGridError(
        "Cells were not cleared",
        result.outcome.message ??
          "The original cell values were kept. Refresh and try again.",
      )
      return
    }
    const message = `${result.updates.length} ${
      result.updates.length === 1 ? "cell" : "cells"
    } cleared`
    toast.success(message)
    announce(message)
  }

  async function applyHistoryAction(direction: "undo" | "redo") {
    if (cellWriteInFlightRef.current || syncing || historyAction) return
    const entry =
      direction === "undo"
        ? editHistory.past.at(-1)
        : editHistory.future.at(-1)
    if (!entry) return
    const updates = gridHistoryUpdates(entry, direction)
    if (!updates?.length) {
      setEditHistory(EMPTY_GRID_EDIT_HISTORY)
      reportGridError(
        "Edit history is no longer available",
        "The table changed shape, so the older change was retired safely.",
      )
      return
    }

    cellWriteInFlightRef.current = true
    setCellWritePending(true)
    setHistoryAction(direction)
    try {
      const outcome = await applyCellUpdates(updates)
      if (isBatchFailure(outcome)) {
        setEditHistory(EMPTY_GRID_EDIT_HISTORY)
        setCellEditorEpoch((epoch) => epoch + 1)
        reportGridError(
          direction === "undo" ? "Undo stopped" : "Redo stopped",
          outcome.message ??
            "A teammate changed one or more cells. Their newer values were kept.",
        )
        return
      }
      setEditHistory((current) =>
        direction === "undo"
          ? completeGridUndo(current, outcome.revisions)
          : completeGridRedo(current, outcome.revisions),
      )
      const message = `${
        direction === "undo" ? "Change undone" : "Change redone"
      }. ${entry.label}`
      toast.success(
        direction === "undo" ? "Change undone" : "Change redone",
        { description: entry.label },
      )
      announce(message)
    } finally {
      cellWriteInFlightRef.current = false
      setCellWritePending(false)
      setHistoryAction(undefined)
    }
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const editing = isEditableTarget(event.target)
    if (editing) {
      if (event.key === "Tab") {
        event.preventDefault()
        ;(event.target as HTMLElement).blur()
        moveSelection(
          { row: 0, column: event.shiftKey ? -1 : 1 },
          false,
        )
      } else if (event.key === "Enter") {
        requestAnimationFrame(() => {
          moveSelection({ row: event.shiftKey ? -1 : 1, column: 0 }, false)
        })
      } else if (event.key === "Escape") {
        requestAnimationFrame(() => gridRef.current?.focus())
      }
      return
    }

    const activeField =
      event.target === event.currentTarget && activeCell
        ? fields[activeCell.column]
        : undefined
    if (
      activeField &&
      canManageSchema &&
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault()
      if (event.shiftKey) {
        if (activeField.isPrimary || fieldOrderPending) return
        const currentIndex = fields.findIndex(
          (field) => field.id === activeField.id,
        )
        const targetIndex = Math.max(
          0,
          Math.min(
            fields.length - 1,
            currentIndex + (event.key === "ArrowLeft" ? -1 : 1),
          ),
        )
        if (targetIndex !== currentIndex) {
          void reorderField(activeField.id, targetIndex)
        }
        return
      }

      const currentWidth =
        previewWidths[activeField.id] ?? activeField.width
      const width = clampColumnWidth(
        currentWidth + (event.key === "ArrowLeft" ? -20 : 20),
      )
      setPreviewWidths((current) => ({
        ...current,
        [activeField.id]: width,
      }))
      onResizeField(activeField.id, width)
      announce(`${activeField.name} width is now ${width} pixels.`)
      return
    }

    const commandKey = event.metaKey || event.ctrlKey
    const key = event.key.toLowerCase()
    const undoShortcut =
      commandKey && !event.altKey && key === "z" && !event.shiftKey
    const redoShortcut =
      (commandKey && !event.altKey && key === "z" && event.shiftKey) ||
      (event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        key === "y")
    if (undoShortcut || redoShortcut) {
      event.preventDefault()
      void applyHistoryAction(undoShortcut ? "undo" : "redo")
      return
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault()
      void clearSelectedCells()
      return
    }

    const movement =
      event.key === "ArrowLeft"
        ? { row: 0, column: -1 }
        : event.key === "ArrowRight"
          ? { row: 0, column: 1 }
          : event.key === "ArrowUp"
            ? { row: -1, column: 0 }
            : event.key === "ArrowDown"
              ? { row: 1, column: 0 }
              : event.key === "Tab"
                ? { row: 0, column: event.shiftKey ? -1 : 1 }
                : event.key === "Enter"
                  ? { row: event.shiftKey ? -1 : 1, column: 0 }
                  : undefined
    if (movement) {
      event.preventDefault()
      moveSelection(movement, event.shiftKey && event.key.startsWith("Arrow"))
      return
    }
    if (event.key === "Escape" && selection) {
      event.preventDefault()
      setSelection({
        anchor: selection.focus,
        focus: selection.focus,
      })
    }
  }

  function startColumnResize(
    event: PointerEvent<HTMLButtonElement>,
    field: FieldDefinition,
  ) {
    if (!canManageSchema) return
    event.preventDefault()
    event.stopPropagation()
    const width = previewWidths[field.id] ?? field.width
    resizeStateRef.current = {
      fieldId: field.id,
      pointerId: event.pointerId,
      startWidth: width,
      startX: event.clientX,
      width,
    }
    setDraggedFieldId(undefined)
    setDropTarget(undefined)
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }

  function updateColumnResize(event: PointerEvent<HTMLButtonElement>) {
    const resize = resizeStateRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    const width = clampColumnWidth(
      resize.startWidth + event.clientX - resize.startX,
    )
    resize.width = width
    setPreviewWidths((current) =>
      current[resize.fieldId] === width
        ? current
        : { ...current, [resize.fieldId]: width },
    )
  }

  function finishColumnResize(event: PointerEvent<HTMLButtonElement>) {
    const resize = resizeStateRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    resizeStateRef.current = null
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
    if (resize.width !== resize.startWidth) {
      onResizeField(resize.fieldId, resize.width)
      const fieldName = fields.find(
        (field) => field.id === resize.fieldId,
      )?.name
      if (fieldName) {
        announce(`${fieldName} width is now ${resize.width} pixels.`)
      }
    }
  }

  function cancelColumnResize(event: PointerEvent<HTMLButtonElement>) {
    const resize = resizeStateRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    resizeStateRef.current = null
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
    const persistedWidth = fields.find(
      (field) => field.id === resize.fieldId,
    )?.width
    setPreviewWidths((current) => {
      if (resize.startWidth !== persistedWidth) {
        return { ...current, [resize.fieldId]: resize.startWidth }
      }
      if (current[resize.fieldId] === undefined) return current
      const next = { ...current }
      delete next[resize.fieldId]
      return next
    })
  }

  function resizeColumnWithKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    field: FieldDefinition,
  ) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    event.stopPropagation()
    const currentWidth = previewWidths[field.id] ?? field.width
    const width = clampColumnWidth(
      currentWidth + (event.key === "ArrowLeft" ? -20 : 20),
    )
    setPreviewWidths((current) => ({ ...current, [field.id]: width }))
    onResizeField(field.id, width)
    announce(`${field.name} width is now ${width} pixels.`)
  }

  function beginFieldRename(field: FieldDefinition) {
    if (
      !canManageSchema ||
      !onRenameField ||
      fieldRenamePendingId === field.id
    ) {
      return
    }
    setRenamingFieldId(field.id)
    setRenameDraft(field.name)
  }

  async function commitFieldRename(field: FieldDefinition) {
    if (
      !onRenameField ||
      fieldRenameWriteInFlightRef.current === field.id
    ) {
      return
    }
    const nextName = renameDraft.trim()
    if (!nextName || nextName.length > 120) {
      reportGridError(
        "Enter a column name",
        "Use between 1 and 120 characters.",
      )
      return
    }
    const normalizedName = nextName.normalize("NFKC").toLocaleLowerCase()
    const duplicate = fields.some(
      (candidate) =>
        candidate.id !== field.id &&
        candidate.name.trim().normalize("NFKC").toLocaleLowerCase() ===
          normalizedName,
    )
    if (duplicate) {
      reportGridError(
        "Column name already used",
        "Choose a different name.",
      )
      return
    }
    if (nextName === field.name) {
      setRenamingFieldId(undefined)
      return
    }

    const previousName =
      sourceFields.find((candidate) => candidate.id === field.id)?.name ??
      field.name
    setOptimisticFieldNames((current) => ({
      ...current,
      [field.id]: { previous: previousName, next: nextName },
    }))
    setRenamingFieldId(undefined)
    setFieldRenamePendingId(field.id)
    fieldRenameWriteInFlightRef.current = field.id
    announce(`${previousName} renamed to ${nextName}.`)

    try {
      const outcome = await onRenameField(field.id, nextName)
      if (outcome === false || isFieldRenameFailure(outcome)) {
        setOptimisticFieldNames((current) => {
          if (current[field.id]?.next !== nextName) return current
          const next = { ...current }
          delete next[field.id]
          return next
        })
        reportGridError(
          "Column name was not saved",
          isFieldRenameFailure(outcome) && outcome.message
            ? outcome.message
            : "The previous name has been restored. Try again.",
        )
      }
    } catch (error) {
      setOptimisticFieldNames((current) => {
        if (current[field.id]?.next !== nextName) return current
        const next = { ...current }
        delete next[field.id]
        return next
      })
      reportGridError(
        "Column name was not saved",
        `The previous name has been restored. ${publicErrorMessage(error)}`,
      )
    } finally {
      if (fieldRenameWriteInFlightRef.current === field.id) {
        fieldRenameWriteInFlightRef.current = undefined
      }
      setFieldRenamePendingId((current) =>
        current === field.id ? undefined : current,
      )
    }
  }

  async function reorderField(
    fieldId: string,
    targetIndex: number,
    originalFieldIds = fields.map((field) => field.id),
  ) {
    if (fieldOrderWriteInFlightRef.current) return
    const fromIndex = originalFieldIds.indexOf(fieldId)
    if (fromIndex < 0 || fromIndex === targetIndex) return
    const nextFieldOrder = moveItemToIndex(
      originalFieldIds,
      fromIndex,
      targetIndex,
    )
    const fieldName = sourceFields.find(
      (field) => field.id === fieldId,
    )?.name

    setOptimisticFieldOrder(nextFieldOrder)
    setFieldOrderPending(true)
    fieldOrderWriteInFlightRef.current = true
    if (fieldName) {
      announce(`${fieldName} moved to column ${targetIndex + 1}.`)
    }

    try {
      const outcome = await onReorderField(fieldId, targetIndex)
      if (outcome === false || isFieldReorderFailure(outcome)) {
        setOptimisticFieldOrder(undefined)
        setFieldOrderPending(false)
        reportGridError(
          "Column order was not saved",
          `${
            fieldName ?? "The column"
          } returned to its previous position. ${
            isFieldReorderFailure(outcome) && outcome.message
              ? outcome.message
              : "Try again."
          }`,
        )
      }
    } catch (error) {
      setOptimisticFieldOrder(undefined)
      setFieldOrderPending(false)
      reportGridError(
        "Column order was not saved",
        `${fieldName ?? "The column"} returned to its previous position. ${publicErrorMessage(
          error,
        )}`,
      )
    } finally {
      fieldOrderWriteInFlightRef.current = false
    }
  }

  function startColumnDrag(
    event: PointerEvent<HTMLDivElement>,
    field: FieldDefinition,
  ) {
    if (
      !canManageSchema ||
      field.isPrimary ||
      fieldOrderPending ||
      event.button !== 0 ||
      (event.target as HTMLElement).closest("button, input")
    ) {
      return
    }
    headerDragStateRef.current = {
      active: false,
      fieldId: field.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originalFieldIds: fields.map((candidate) => candidate.id),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function updateColumnDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = headerDragStateRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    if (
      !drag.active &&
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5
    ) {
      return
    }
    if (!drag.active) {
      drag.active = true
      setDraggedFieldId(drag.fieldId)
      document.body.style.cursor = "grabbing"
      document.body.style.userSelect = "none"
    }

    event.preventDefault()
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-grid-field-id]")
    const targetFieldId = target?.dataset.gridFieldId
    if (!targetFieldId || targetFieldId === drag.fieldId) {
      drag.target = undefined
      setDropTarget(undefined)
      return
    }
    const bounds = target.getBoundingClientRect()
    const edge: ColumnDropEdge =
      event.clientX < bounds.left + bounds.width / 2 ? "before" : "after"
    drag.target = { edge, fieldId: targetFieldId }
    setDropTarget(drag.target)
  }

  function completeColumnDrag(pointerId?: number) {
    const drag = headerDragStateRef.current
    if (!drag || (pointerId !== undefined && drag.pointerId !== pointerId)) {
      return
    }
    headerDragStateRef.current = null
    setDraggedFieldId(undefined)
    setDropTarget(undefined)
    document.body.style.cursor = ""
    document.body.style.userSelect = ""

    if (!drag.active || !drag.target) return
    const targetIndex = columnDropIndex(
      drag.originalFieldIds,
      drag.fieldId,
      drag.target.fieldId,
      drag.target.edge,
    )
    if (targetIndex !== null) {
      void reorderField(drag.fieldId, targetIndex, drag.originalFieldIds)
    } else {
      setOptimisticFieldOrder(undefined)
    }
  }
  finishColumnDragRef.current = completeColumnDrag

  function finishColumnDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = headerDragStateRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    completeColumnDrag(event.pointerId)
  }

  function cancelColumnDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = headerDragStateRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    headerDragStateRef.current = null
    setDraggedFieldId(undefined)
    setDropTarget(undefined)
    setOptimisticFieldOrder(undefined)
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  }

  function exportVisibleRecords() {
    const csv = createRecordsCsv(fields, filteredRecords)
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    )
    const link = document.createElement("a")
    link.href = url
    link.download = csvFileName(exportName)
    link.click()
    URL.revokeObjectURL(url)
    toast.success("CSV downloaded")
    announce("CSV downloaded")
  }

  return (
    <section className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden bg-background motion-reduce:[&_*]:!animate-none motion-reduce:[&_*]:!transition-none">
      <p className="sr-only" id={gridInstructionsId}>
        Use the arrow keys to move between cells. Hold Shift with an arrow key
        to select a range. Use Copy and Paste normally, and press Delete to
        clear selected editable cells. Workspace editors can hold Alt with the
        left or right arrow to resize the active column, or add Shift to move
        that column.
      </p>
      <div
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        data-grid-announcer
        role="status"
      >
        <span key={announcement.sequence}>{announcement.message}</span>
      </div>
      <div className="flex min-h-11 flex-wrap items-center gap-1 border-b px-2 py-1.5">
        {viewControl ?? (
          <div className="flex h-8 items-center gap-2 px-2 text-xs font-medium">
            <Rows3 />
            Grid view
          </div>
        )}
        <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
        {onManageFields ? (
          <Button
            className="hidden sm:inline-flex"
            onClick={onManageFields}
            size="sm"
            variant="ghost"
          >
            <Columns3 />
            Columns
          </Button>
        ) : null}
        {onRowHeightChange ? (
          <Select
            onValueChange={(value) =>
              onRowHeightChange(value as keyof typeof ROW_HEIGHTS)
            }
            value={rowHeight}
          >
            <SelectTrigger
              aria-label="Row height"
              className="hidden h-8 w-[7.75rem] border-0 bg-transparent shadow-none sm:flex"
              size="sm"
            >
              <Rows3 className="size-3.5" />
              <SelectValue>
                {rowHeight === "compact"
                  ? "Compact rows"
                  : rowHeight === "tall"
                    ? "Tall rows"
                    : "Medium rows"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="compact">Compact rows</SelectItem>
              <SelectItem value="medium">Medium rows</SelectItem>
              <SelectItem value="tall">Tall rows</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
        <div
          aria-label="Edit history"
          className="flex items-center rounded-lg border bg-background p-0.5"
          role="group"
        >
          <Button
            aria-label={
              editHistory.past.at(-1)
                ? `Undo ${editHistory.past.at(-1)?.label}`
                : "Undo"
            }
            disabled={
              !editHistory.past.length ||
              Boolean(historyAction) ||
              cellWritePending ||
              syncing
            }
            onClick={() => void applyHistoryAction("undo")}
            size="icon-xs"
            title="Undo (⌘/Ctrl Z)"
            variant="ghost"
          >
            <Undo2 />
          </Button>
          <Button
            aria-label={
              editHistory.future.at(-1)
                ? `Redo ${editHistory.future.at(-1)?.label}`
                : "Redo"
            }
            disabled={
              !editHistory.future.length ||
              Boolean(historyAction) ||
              cellWritePending ||
              syncing
            }
            onClick={() => void applyHistoryAction("redo")}
            size="icon-xs"
            title="Redo (⇧⌘/Ctrl Z or Ctrl Y)"
            variant="ghost"
          >
            <Redo2 />
          </Button>
        </div>
        {selectedRecords.length ? (
          <div
            aria-label="Selected record actions"
            className="flex h-8 items-center gap-0.5 rounded-lg border border-primary/20 bg-primary/[0.045] p-0.5 pl-2 text-xs shadow-sm shadow-primary/5"
            role="toolbar"
          >
            <span className="mr-1 font-medium tabular-nums text-foreground">
              {selectedRecords.length.toLocaleString()} selected
            </span>
            <Button
              aria-label={`Duplicate ${selectedRecords.length} selected ${
                selectedRecords.length === 1 ? "record" : "records"
              }`}
              disabled={Boolean(recordAction) || syncing}
              onClick={() => void duplicateRecords(selectedRecords)}
              size="xs"
              variant="ghost"
            >
              {recordAction === "duplicate" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <CopyPlus />
              )}
              <span className="hidden sm:inline">Duplicate</span>
            </Button>
            <Button
              aria-label={`Delete ${selectedRecords.length} selected ${
                selectedRecords.length === 1 ? "record" : "records"
              }`}
              disabled={Boolean(recordAction) || syncing}
              onClick={() => requestRecordDeletion(selectedRecords)}
              size="xs"
              variant="destructive"
            >
              <Trash2 />
              <span className="hidden sm:inline">Delete</span>
            </Button>
            <Button
              aria-label="Clear record selection"
              disabled={Boolean(recordAction)}
              onClick={() => setSelectedRecordIds(new Set())}
              size="icon-xs"
              variant="ghost"
            >
              <X />
            </Button>
          </div>
        ) : null}
        {totalRecordCount !== undefined ? (
          <span
            aria-label="Record count"
            className="ml-auto hidden text-xs tabular-nums text-muted-foreground md:inline"
          >
            {totalRecordCount.toLocaleString()}{" "}
            {totalRecordCount === 1 ? "record" : "records"}
          </span>
        ) : null}
        <div className="relative ml-auto w-44 sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Find records in view"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find in view…"
            className="h-7 pl-8 text-xs"
          />
        </div>
        <ConnectionStatus
          className="ml-1 hidden sm:inline-flex"
          health={displayedConnectionHealth}
        />
      </div>

      <div
        ref={scrollRef}
        data-grid-scroll-container
        className="relative min-h-0 max-w-full flex-1 overflow-auto bg-white dark:bg-background"
        onScroll={measureHorizontalViewport}
      >
        <div style={{ width: totalWidth, minWidth: "100%" }}>
          <div
            role="grid"
            aria-label="Records grid"
            aria-busy={syncing || cellWritePending}
            aria-activedescendant={
              activeCell
                ? `grid-cell-${activeCell.row}-${activeCell.column}`
                : undefined
            }
            aria-colcount={fields.length + 2}
            aria-describedby={gridInstructionsId}
            aria-multiselectable="true"
            aria-rowcount={renderItems.length + 1}
            className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60"
            onCopy={handleGridCopy}
            onFocus={(event) => {
              if (
                event.target === event.currentTarget &&
                !selection &&
                activeCell
              ) {
                setSelection({
                  anchor: activeCell,
                  focus: activeCell,
                })
              }
            }}
            onKeyDown={handleGridKeyDown}
            onPaste={(event) => void handleGridPaste(event)}
            ref={gridRef}
            tabIndex={0}
          >
            <div
              role="row"
              aria-rowindex={1}
              className="sticky top-0 z-20 flex h-9 border-b bg-muted/85 text-xs font-medium text-muted-foreground backdrop-blur"
              style={{ width: totalWidth }}
            >
              <div
                role="columnheader"
                aria-colindex={1}
                aria-label="Select records"
                className="sticky left-0 z-30 grid shrink-0 place-items-center border-r bg-muted/95"
                style={{ width: ROW_NUMBER_WIDTH }}
              >
                <Checkbox
                  aria-label={
                    visibleRecordIds.length
                      ? `Select all ${visibleRecordIds.length.toLocaleString()} visible ${
                          visibleRecordIds.length === 1
                            ? "record"
                            : "records"
                        }`
                      : "Select visible records"
                  }
                  checked={allVisibleRecordsSelected}
                  disabled={!visibleRecordIds.length}
                  indeterminate={someVisibleRecordsSelected}
                  onCheckedChange={selectAllVisibleRecords}
                />
              </div>
              {renderedColumnIndexes.map((fieldIndex) => {
                const header =
                  table.getHeaderGroups()[0]?.headers[fieldIndex]
                const field = fields[fieldIndex]
                const position = columnLayout.columns[fieldIndex]
                if (!field || !header || !position) return null
                const FieldIcon = FIELD_TYPE_ICONS[field.type]
                const activeDropTarget =
                  dropTarget?.fieldId === field.id ? dropTarget.edge : undefined
                return (
                  <div
                    key={header.id}
                    role="columnheader"
                    aria-label={field.name}
                    aria-colindex={fieldIndex + 2}
                    aria-grabbed={
                      canManageSchema
                        ? draggedFieldId === field.id
                        : undefined
                    }
                    className={cn(
                      "group flex shrink-0 items-center border-r px-2",
                      field.frozen &&
                        "sticky z-20 bg-muted/95 shadow-[2px_0_0_0_var(--border)]",
                      !field.frozen && "absolute inset-y-0",
                      canManageSchema &&
                        !field.isPrimary &&
                        !fieldOrderPending &&
                        "cursor-grab select-none active:cursor-grabbing",
                      fieldOrderPending &&
                        !field.isPrimary &&
                        "cursor-wait",
                      draggedFieldId === field.id && "opacity-55",
                      activeDropTarget === "before" &&
                        "shadow-[-3px_0_0_0_var(--primary)]",
                      activeDropTarget === "after" &&
                        "shadow-[3px_0_0_0_var(--primary)]",
                    )}
                    data-grid-field-id={field.id}
                    onPointerCancel={cancelColumnDrag}
                    onDoubleClick={(event) => {
                      if (
                        (event.target as HTMLElement).closest(
                          "button, input",
                        )
                      ) {
                        return
                      }
                      if (onRenameField) {
                        beginFieldRename(field)
                      } else {
                        onManageField?.(field.id)
                      }
                    }}
                    onPointerDown={(event) =>
                      startColumnDrag(event, field)
                    }
                    onPointerMove={updateColumnDrag}
                    onPointerUp={finishColumnDrag}
                    style={{
                      width: header.getSize(),
                      left: field.frozen
                        ? position.frozenLeft
                        : position.start,
                    }}
                    title={
                      canManageSchema
                        ? field.isPrimary
                          ? "Required column. Drag the right edge to resize."
                          : "Drag to reorder. Drag the right edge to resize."
                        : undefined
                    }
                  >
                    {canManageSchema &&
                    !field.isPrimary &&
                    renamingFieldId !== field.id ? (
                      <GripVertical
                        aria-hidden="true"
                        className="mr-1 size-3 text-muted-foreground/35 transition-colors group-hover:text-muted-foreground"
                      />
                    ) : null}
                    <FieldIcon
                      aria-hidden="true"
                      className="mr-1.5 size-3.5 shrink-0 text-muted-foreground/70"
                      strokeWidth={1.8}
                    />
                    {renamingFieldId === field.id ? (
                      <Input
                        aria-label={`Rename ${field.name} column`}
                        autoFocus
                        className="h-7 min-w-0 flex-1 bg-background px-2 text-xs text-foreground"
                        maxLength={120}
                        onBlur={() => void commitFieldRename(field)}
                        onChange={(event) =>
                          setRenameDraft(event.target.value)
                        }
                        onClick={(event) => event.stopPropagation()}
                        onFocus={(event) => event.currentTarget.select()}
                        onKeyDown={(event) => {
                          event.stopPropagation()
                          if (event.key === "Escape") {
                            event.preventDefault()
                            setRenamingFieldId(undefined)
                          } else if (event.key === "Enter") {
                            event.preventDefault()
                            void commitFieldRename(field)
                          }
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        value={renameDraft}
                      />
                    ) : (
                      <span className="truncate">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </span>
                    )}
                    {field.frozen ? (
                      <Pin
                        aria-label={`${field.name} is frozen`}
                        className="ml-1 size-3 shrink-0 text-primary/70"
                      />
                    ) : null}
                    {fieldRenamePendingId === field.id ? (
                      <LoaderCircle
                        aria-label={`Saving ${field.name} column name`}
                        className="ml-1 size-3 animate-spin"
                      />
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <button
                            type="button"
                            aria-label={`Open ${field.name} menu`}
                            className="ml-auto grid size-6 place-items-center rounded-md opacity-0 hover:bg-background group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
                            draggable={false}
                          />
                        }
                      >
                        <MoreHorizontal className="size-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        {canManageSchema ? (
                          <>
                            {onRenameField ? (
                              <DropdownMenuItem
                                onClick={() => beginFieldRename(field)}
                              >
                                <Columns3 />
                                Rename column
                              </DropdownMenuItem>
                            ) : null}
                            {onManageField ? (
                              <DropdownMenuItem
                                onClick={() => onManageField(field.id)}
                              >
                                <Columns3 />
                                Customize column
                              </DropdownMenuItem>
                            ) : null}
                            {onDuplicateField ? (
                              <DropdownMenuItem
                                onClick={() => onDuplicateField(field.id)}
                              >
                                <Copy />
                                Duplicate column
                              </DropdownMenuItem>
                            ) : null}
                            {onHideField ? (
                              <DropdownMenuItem
                                disabled={field.isPrimary}
                                onClick={() => onHideField(field.id)}
                              >
                                <Rows3 />
                                {field.isPrimary
                                  ? "Required column is always shown"
                                  : "Hide in this view"}
                              </DropdownMenuItem>
                            ) : null}
                            {onFreezeField ? (
                              <DropdownMenuItem
                                disabled={field.isPrimary}
                                onClick={() =>
                                  onFreezeField(field.id, !field.frozen)
                                }
                              >
                                {field.frozen ? <PinOff /> : <Pin />}
                                {field.isPrimary
                                  ? "Required column stays frozen"
                                  : field.frozen
                                    ? "Unfreeze column"
                                    : "Freeze column"}
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              disabled={
                                fieldOrderPending ||
                                field.isPrimary ||
                                fieldIndex === 0
                              }
                              onClick={() => {
                                void reorderField(
                                  field.id,
                                  fieldIndex - 1,
                                )
                              }}
                            >
                              Move left
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={
                                fieldOrderPending ||
                                field.isPrimary ||
                                fieldIndex === fields.length - 1
                              }
                              onClick={() => {
                                void reorderField(
                                  field.id,
                                  fieldIndex + 1,
                                )
                              }}
                            >
                              Move right
                            </DropdownMenuItem>
                          </>
                        ) : null}
                        <DropdownMenuItem
                          onClick={() => {
                            navigator.clipboard.writeText(field.name)
                            toast.success("Column name copied")
                            announce(`${field.name} column name copied`)
                          }}
                        >
                          <Copy />
                          Copy column name
                        </DropdownMenuItem>
                        {canManageSchema ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={field.isPrimary}
                              onClick={() => onDeleteField(field.id)}
                            >
                              <Archive />
                              {field.isPrimary
                                ? "Required column cannot be archived"
                                : "Archive column"}
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {canManageSchema ? (
                      <button
                        aria-label={`Resize ${field.name} column`}
                        aria-valuemax={600}
                        aria-valuemin={100}
                        aria-valuenow={previewWidths[field.id] ?? field.width}
                        aria-valuetext={`${
                          previewWidths[field.id] ?? field.width
                        } pixels`}
                        aria-orientation="vertical"
                        className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-1 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-primary focus-visible:after:bg-primary"
                        draggable={false}
                        onDragStart={(event) => event.preventDefault()}
                        onKeyDown={(event) =>
                          resizeColumnWithKeyboard(event, field)
                        }
                        onLostPointerCapture={cancelColumnResize}
                        onPointerCancel={cancelColumnResize}
                        onPointerDown={(event) =>
                          startColumnResize(event, field)
                        }
                        onPointerMove={updateColumnResize}
                        onPointerUp={finishColumnResize}
                        role="separator"
                        type="button"
                      />
                    ) : null}
                  </div>
                )
              })}
              <div
                role="columnheader"
                aria-colindex={fields.length + 2}
                aria-label="Column controls"
                className="absolute inset-y-0 w-12"
                style={{ left: columnLayout.contentWidth }}
              >
                {canManageSchema ? (
                  <NewFieldDialog
                    onAddField={onAddField}
                    onAnnounce={announce}
                  />
                ) : null}
              </div>
            </div>

            <div
              className="relative"
              style={{
                height: rowVirtualizer.getTotalSize(),
                width: totalWidth,
              }}
              role="rowgroup"
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const item = renderItems[virtualRow.index]
                if (!item) return null
                if (item.kind === "group") {
                  return (
                    <div
                      aria-rowindex={virtualRow.index + 2}
                      className="absolute left-0 flex text-xs"
                      key={`group-${item.label}`}
                      role="row"
                      style={{
                        height: virtualRow.size,
                        width: totalWidth,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <button
                        aria-expanded={!item.collapsed}
                        aria-label={`${
                          item.collapsed ? "Expand" : "Collapse"
                        } group ${item.label}`}
                        className="sticky left-0 flex h-[30px] min-w-0 items-center gap-2 border-b bg-muted/70 px-3 font-medium text-foreground backdrop-blur hover:bg-muted focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                        onClick={() => {
                          setSelection(undefined)
                          setCollapsedGroups((current) => {
                            const next = new Set(current)
                            if (next.has(item.label)) {
                              next.delete(item.label)
                            } else {
                              next.add(item.label)
                            }
                            return next
                          })
                        }}
                        role="rowheader"
                        style={{ width: totalWidth }}
                        type="button"
                      >
                        {item.collapsed ? (
                          <ChevronRight
                            aria-hidden="true"
                            className="size-3.5 text-muted-foreground"
                          />
                        ) : (
                          <ChevronDown
                            aria-hidden="true"
                            className="size-3.5 text-muted-foreground"
                          />
                        )}
                        <Rows3 className="size-3.5 text-muted-foreground" />
                        <span className="truncate">{item.label}</span>
                        <span className="text-[10px] font-normal text-muted-foreground">
                          {item.count.toLocaleString()}{" "}
                          {item.count === 1 ? "record" : "records"}
                        </span>
                      </button>
                    </div>
                  )
                }

                const row = item.row
                const recordRowIndex = row.index
                const rowSelected = selectedRecordIds.has(row.original.id)
                return (
                  <div
                    key={row.id}
                    className="absolute left-0 flex text-xs"
                    style={{
                      height: virtualRow.size,
                      width: totalWidth,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <div
                      role="row"
                      aria-rowindex={virtualRow.index + 2}
                      aria-selected={rowSelected}
                      className={cn(
                        "group relative flex h-full w-full shrink-0 border-b hover:bg-primary/[0.025]",
                        rowSelected &&
                          "bg-primary/[0.045] hover:bg-primary/[0.065] dark:bg-primary/[0.07]",
                      )}
                    >
                      <div
                        role="rowheader"
                        aria-colindex={1}
                        aria-label={`Record ${recordRowIndex + 1}`}
                        className={cn(
                          "sticky left-0 z-20 flex shrink-0 items-center gap-1 border-r bg-muted/95 px-1.5 text-[10px] tabular-nums text-muted-foreground",
                          rowSelected && "bg-primary/[0.07]",
                        )}
                        style={{ width: ROW_NUMBER_WIDTH }}
                      >
                        <Checkbox
                          aria-label={`Select record ${recordRowIndex + 1}`}
                          checked={rowSelected}
                          onCheckedChange={(checked) =>
                            selectRecord(row.original.id, checked)
                          }
                        />
                        <span className="min-w-4 text-center group-hover:hidden">
                          {recordRowIndex + 1}
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <button
                                type="button"
                                className="hidden size-6 place-items-center rounded-md hover:bg-muted group-hover:grid focus-visible:grid data-[popup-open]:grid"
                                aria-label={`Record ${recordRowIndex + 1} actions`}
                              />
                            }
                          >
                            <MoreHorizontal className="size-3.5" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem
                              onClick={() =>
                                void duplicateRecords([row.original])
                              }
                            >
                              <CopyPlus />
                              Duplicate record
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() =>
                                requestRecordDeletion([row.original])
                              }
                            >
                              <Trash2 />
                              Delete record
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {renderedColumnIndexes.map((cellIndex) => {
                        const cell = row.getVisibleCells()[cellIndex]
                        const field = fields[cellIndex]
                        const position = columnLayout.columns[cellIndex]
                        if (!cell || !field || !position) return null
                        const collaboratorsHere =
                          collaboratorsByCell.get(
                            `${row.original.id}:${field.id}`,
                          ) ?? []
                        return (
                        <div
                          key={cell.id}
                          id={`grid-cell-${recordRowIndex}-${cellIndex}`}
                          role="gridcell"
                          aria-selected={isGridCellSelected(selection, {
                            row: recordRowIndex,
                            column: cellIndex,
                          })}
                          aria-colindex={cellIndex + 2}
                          className={cn(
                            "relative shrink-0 border-r focus-within:z-10 focus-within:ring-2 focus-within:ring-inset focus-within:ring-primary",
                            field.frozen &&
                              "sticky z-[15] bg-background shadow-[2px_0_0_0_var(--border)] group-hover:bg-primary/[0.025]",
                            !field.frozen && "absolute inset-y-0",
                            isGridCellSelected(selection, {
                              row: recordRowIndex,
                              column: cellIndex,
                            }) &&
                              "bg-primary/[0.055] ring-1 ring-inset ring-primary/45",
                            selection?.focus.row === recordRowIndex &&
                              selection.focus.column === cellIndex &&
                              "z-10 ring-2 ring-inset ring-primary",
                          )}
                          data-grid-cell
                          data-grid-column={cellIndex}
                          data-grid-row={recordRowIndex}
                          onPointerDownCapture={(event) => {
                            if (event.button !== 0) return
                            const cellCoordinate = {
                              row: recordRowIndex,
                              column: cellIndex,
                            }
                            const anchor =
                              event.shiftKey && selection
                                ? selection.anchor
                                : cellCoordinate
                            setSelection({
                              anchor,
                              focus: cellCoordinate,
                            })
                            dragSelectionRef.current = {
                              anchor,
                              pointerId: event.pointerId,
                            }
                          }}
                          onPointerEnter={(event) => {
                            const drag = dragSelectionRef.current
                            if (
                              !drag ||
                              drag.pointerId !== event.pointerId ||
                              event.buttons !== 1
                            ) {
                              return
                            }
                            setSelection({
                              anchor: drag.anchor,
                              focus: {
                                row: recordRowIndex,
                                column: cellIndex,
                              },
                            })
                          }}
                          style={{
                            width: cell.column.getSize(),
                            left: field.frozen
                              ? position.frozenLeft
                              : position.start,
                          }}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                          {collaboratorsHere.length ? (
                            <span
                              aria-label={`${collaboratorsHere
                                .map((entry) => entry.name)
                                .join(", ")} ${
                                collaboratorsHere.length === 1
                                  ? "is"
                                  : "are"
                              } editing this cell`}
                              className="pointer-events-none absolute inset-0 z-20 ring-2 ring-inset ring-primary/65"
                              role="status"
                              title={collaboratorsHere
                                .map((entry) => entry.name)
                                .join(", ")}
                            >
                              <span className="absolute -top-2 right-1 rounded-sm bg-primary px-1 py-0.5 text-[8px] font-semibold leading-none text-primary-foreground shadow-sm">
                                {collaboratorsHere.length === 1
                                  ? collaboratorsHere[0]?.name
                                      .split(/\s+/)
                                      .slice(0, 2)
                                      .map((part) => part[0]?.toUpperCase())
                                      .join("")
                                  : `+${collaboratorsHere.length}`}
                              </span>
                            </span>
                          ) : null}
                        </div>
                        )
                      })}
                      <div
                        role="gridcell"
                        aria-colindex={fields.length + 2}
                        className="absolute inset-y-0 w-12"
                        style={{ left: columnLayout.contentWidth }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={onAddRecord}
            className="flex h-9 items-center border-b text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            style={{ width: totalWidth }}
          >
            <span
              className="grid h-full shrink-0 place-items-center border-r"
              style={{ width: ROW_NUMBER_WIDTH }}
            >
              <Plus className="size-3.5" />
            </span>
            <span className="px-3">Add record</span>
          </button>
        </div>
      </div>

      <footer className="flex h-8 shrink-0 items-center border-t bg-muted/30 px-3 text-[10px] text-muted-foreground">
        <span>
          {filteredRecords.length.toLocaleString()}{" "}
          {filteredRecords.length === 1 ? "record" : "records"}
        </span>
        <span className="mx-2">·</span>
        <span>Changes save automatically</span>
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto hidden sm:inline-flex"
          disabled={!filteredRecords.length}
          onClick={exportVisibleRecords}
        >
          <ArrowDownToLine />
          Export
        </Button>
      </footer>

      <AlertDialog
        open={pendingRecordDeletion.length > 0}
        onOpenChange={(open) => {
          if (!open && recordAction !== "delete") {
            setPendingRecordDeletion([])
          }
        }}
      >
        <AlertDialogContent
          className="motion-reduce:!animate-none motion-reduce:!transition-none"
          overlayClassName="motion-reduce:!animate-none motion-reduce:!transition-none"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingRecordDeletion.length === 1
                ? "Delete this record?"
                : `Delete ${pendingRecordDeletion.length.toLocaleString()} records?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {recordDeletionDescription(
                pendingRecordDeletion.map(
                  (record) =>
                    recordLabel(
                      record.values[
                        fields.find((field) => field.isPrimary)?.id ?? ""
                      ],
                    ),
                ),
              )}{" "}
              You&apos;ll get an Undo option after deletion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={recordAction === "delete"}>
              Keep records
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={recordAction === "delete"}
              onClick={() => void confirmRecordDeletion()}
              variant="destructive"
            >
              {recordAction === "delete" ? (
                <>
                  <LoaderCircle className="animate-spin" />
                  Deleting…
                </>
              ) : pendingRecordDeletion.length === 1 ? (
                "Delete record"
              ) : (
                `Delete ${pendingRecordDeletion.length.toLocaleString()} records`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
