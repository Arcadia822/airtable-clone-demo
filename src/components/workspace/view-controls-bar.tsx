"use client"

import { useMemo, useState, type ReactNode } from "react"
import {
  CalendarDays,
  ChartColumn,
  Columns3,
  Command,
  GanttChart,
  LayoutGrid,
  Pencil,
  Plus,
  Search,
  Table2,
  Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  ViewControls,
  type ViewControlsField,
  type ViewControlsValue,
} from "@/components/workspace/view-controls"
import type { ViewType } from "@/lib/domain"
import { cn } from "@/lib/utils"

export type WorkspaceView = {
  id: string
  name: string
  type: ViewType
}

export const VIEW_TYPE_LABELS: Record<ViewType, string> = {
  grid: "Grid",
  kanban: "Kanban",
  timeline: "Timeline",
  calendar: "Calendar",
  gallery: "Gallery",
  dashboard: "Dashboard",
}

const VIEW_TYPE_ORDER: readonly ViewType[] = [
  "grid",
  "kanban",
  "timeline",
  "calendar",
  "gallery",
  "dashboard",
]

const VIEW_TYPE_ICONS: Record<ViewType, typeof Table2> = {
  grid: Table2,
  kanban: Columns3,
  timeline: GanttChart,
  calendar: CalendarDays,
  gallery: LayoutGrid,
  dashboard: ChartColumn,
}

const VIEW_TYPE_DESCRIPTIONS: Record<ViewType, string> = {
  grid: "Spreadsheet rows and columns for bulk editing.",
  kanban: "Cards grouped into lanes you can drag between.",
  timeline: "Scheduled bars on a day, week or month ruler.",
  calendar: "Records on a month grid or agenda list.",
  gallery: "Image-forward cards for visual records.",
  dashboard: "Metric cards and charts summarising this table.",
}

const EMPTY_CONTROLS: ViewControlsValue = {
  filterConjunction: "and",
  filters: [],
  sorts: [],
  groups: [],
}

export function ViewControlsBar({
  activeViewId,
  canDeleteView,
  className,
  controlsDisabled = false,
  disabled = false,
  fields,
  onControlsChange,
  onCreateView,
  onDeleteView,
  onOpenGlobalSearch,
  onRenameView,
  onSearchChange,
  onSelectView,
  searchPlaceholder = "Search this table",
  searchValue = "",
  trailing,
  viewConfigControls,
  viewControlsValue,
  views,
}: {
  activeViewId: string
  canDeleteView?: boolean
  className?: string
  controlsDisabled?: boolean
  disabled?: boolean
  fields?: ViewControlsField[]
  onControlsChange?: (
    next: ViewControlsValue,
  ) => boolean | void | Promise<boolean | void>
  onCreateView?: (type: ViewType) => void | Promise<void>
  onDeleteView?: (viewId: string) => void | Promise<void>
  onOpenGlobalSearch?: () => void
  onRenameView?: (
    viewId: string,
    name: string,
  ) => void | Promise<void>
  onSearchChange?: (value: string) => void
  onSelectView: (viewId: string) => void
  searchPlaceholder?: string
  searchValue?: string
  trailing?: ReactNode
  viewConfigControls?: ReactNode
  viewControlsValue?: ViewControlsValue
  views: readonly WorkspaceView[]
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState("")

  const activeView = views.find((view) => view.id === activeViewId)
  const controlsValue = viewControlsValue ?? EMPTY_CONTROLS
  const deleteAllowed = canDeleteView ?? views.length > 1
  const showControls = Boolean(fields && onControlsChange)

  const viewTabs = useMemo(
    () =>
      views.map((view) => ({
        ...view,
        icon: VIEW_TYPE_ICONS[view.type],
        typeLabel: VIEW_TYPE_LABELS[view.type],
      })),
    [views],
  )

  function openRename() {
    if (!activeView) return
    setRenameDraft(activeView.name)
    setRenameOpen(true)
  }

  function submitRename() {
    const name = renameDraft.trim()
    if (!activeView || !name || name === activeView.name) {
      setRenameOpen(false)
      return
    }
    void Promise.resolve(onRenameView?.(activeView.id, name)).catch(
      () => undefined,
    )
    setRenameOpen(false)
  }

  function createView(type: ViewType) {
    void Promise.resolve(onCreateView?.(type)).catch(() => undefined)
    setCreateOpen(false)
  }

  function confirmDelete() {
    if (!activeView) return
    void Promise.resolve(onDeleteView?.(activeView.id)).catch(
      () => undefined,
    )
    setDeleteOpen(false)
  }

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5 border-b bg-background px-2 py-1.5 sm:px-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <div
          aria-label="Views"
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
        >
          {viewTabs.map((view) => {
            const Icon = view.icon
            const selected = view.id === activeViewId
            return (
              <button
                aria-selected={selected}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                  selected &&
                    "bg-muted text-foreground shadow-xs hover:bg-muted",
                )}
                key={view.id}
                onClick={() => onSelectView(view.id)}
                role="tab"
                title={`${view.typeLabel} view`}
                type="button"
              >
                <Icon className="size-3.5" />
                <span className="max-w-[7.5rem] truncate">{view.name}</span>
              </button>
            )
          })}
          {viewTabs.length === 0 ? (
            <span className="px-2 text-xs text-muted-foreground">
              No views yet
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {onCreateView ? (
            <Button
              aria-label="New view"
              className="size-8"
              disabled={disabled}
              onClick={() => setCreateOpen(true)}
              size="icon-sm"
              title="New view"
              type="button"
              variant="ghost"
            >
              <Plus />
            </Button>
          ) : null}
          {onRenameView && activeView ? (
            <Button
              aria-label="Rename view"
              className="size-8"
              disabled={disabled}
              onClick={openRename}
              size="icon-sm"
              title={`Rename ${activeView.name}`}
              type="button"
              variant="ghost"
            >
              <Pencil />
            </Button>
          ) : null}
          {onDeleteView && deleteAllowed && activeView ? (
            <Button
              aria-label="Delete current view"
              className="size-8 text-muted-foreground hover:text-destructive"
              disabled={disabled}
              onClick={() => setDeleteOpen(true)}
              size="icon-sm"
              title={`Delete ${activeView.name}`}
              type="button"
              variant="ghost"
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <div className="relative w-full min-w-0 sm:w-52">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search this table"
            className="h-8 pl-7 text-xs"
            onChange={(event) => onSearchChange?.(event.target.value)}
            placeholder={searchPlaceholder}
            type="search"
            value={searchValue}
          />
        </div>

        {onOpenGlobalSearch ? (
          <Button
            aria-label="Open global search"
            className="h-8 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={onOpenGlobalSearch}
            type="button"
            variant="outline"
          >
            <Search className="size-3.5" />
            <span className="hidden items-center gap-0.5 sm:inline-flex">
              <Command className="size-3" />
              <kbd className="font-sans text-[10px]">K</kbd>
            </span>
          </Button>
        ) : null}

        {showControls ? (
          <ViewControls
            className="min-w-0"
            disabled={controlsDisabled || disabled}
            fields={fields ?? []}
            onChange={onControlsChange!}
            value={controlsValue}
          />
        ) : null}

        {viewConfigControls ? (
          <div className="flex min-w-0 items-center gap-1">
            {viewConfigControls}
          </div>
        ) : null}

        {trailing ? (
          <div className="flex shrink-0 items-center gap-1 sm:ml-auto">
            {trailing}
          </div>
        ) : null}
      </div>

      <Dialog onOpenChange={setCreateOpen} open={createOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New view</DialogTitle>
            <DialogDescription>
              Pick how this table&apos;s records should be laid out.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            {VIEW_TYPE_ORDER.map((type) => {
              const Icon = VIEW_TYPE_ICONS[type]
              return (
                <button
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg border bg-background px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
                  key={type}
                  onClick={() => createView(type)}
                  type="button"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {VIEW_TYPE_LABELS[type]}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {VIEW_TYPE_DESCRIPTIONS[type]}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
          <DialogFooter>
            <Button
              onClick={() => setCreateOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setRenameOpen} open={renameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename view</DialogTitle>
            <DialogDescription>
              Give “{activeView?.name}” a shorter, clearer name.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor="view-name-input"
            >
              View name
            </label>
            <Input
              autoFocus
              id="view-name-input"
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitRename()
              }}
              value={renameDraft}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => setRenameOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button onClick={submitRename} type="button">
              Save name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete view</DialogTitle>
            <DialogDescription>
              “{activeView?.name}” and its filters, sorts and widgets will be
              removed. Records stay in the table.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => setDeleteOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button onClick={confirmDelete} type="button" variant="destructive">
              Delete view
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
