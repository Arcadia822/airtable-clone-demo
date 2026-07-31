"use client"

import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronDown,
  Copy,
  GalleryHorizontal,
  LayoutDashboard,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Rows3,
  Star,
  Trash2,
} from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/searchable-select"
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

export type WorkspaceViewOption = {
  calendarDisplay?: "month" | "agenda"
  gallerySummaryFieldIds?: string[]
  id: string
  isDefault: boolean
  isFavorite?: boolean
  lastOpenedAt?: number
  layoutFieldId?: string
  name: string
  status: "active" | "archived"
  type: "grid" | "kanban" | "calendar" | "gallery"
  kanbanSummaryFieldIds?: string[]
}

export type WorkspaceViewFieldOption = {
  config?: {
    dateStyle?: "date" | "dateTime"
    includeTime?: boolean
  }
  id: string
  isPrimary?: boolean
  name: string
  type: string
}

export type CreateViewOptions = {
  type: WorkspaceViewOption["type"]
  calendarDisplay?: "month" | "agenda"
  calendarDateFieldId?: string
  galleryCoverFieldId?: string
  gallerySummaryFieldIds?: string[]
  kanbanFieldId?: string
  kanbanSummaryFieldIds?: string[]
}

export function ViewSwitcher({
  activeViewId,
  canManage,
  createOpen: controlledCreateOpen,
  initialCreateType = "grid",
  fields = [],
  onArchive,
  onCreate,
  onDelete,
  onDuplicate,
  onMove,
  onRename,
  onRestore,
  onSelect,
  onSetFavorite,
  onSetDefault,
  onUpdateOptions,
  onCreateOpenChange,
  views,
}: {
  activeViewId?: string
  canManage: boolean
  createOpen?: boolean
  initialCreateType?: WorkspaceViewOption["type"]
  fields?: WorkspaceViewFieldOption[]
  onArchive?: (viewId: string) => Promise<boolean | void>
  onCreate: (
    name: string,
    options?: CreateViewOptions,
  ) => Promise<string | false | void>
  onDelete?: (viewId: string) => Promise<boolean | void>
  onDuplicate?: (viewId: string) => Promise<string | false | void>
  onMove?: (
    viewId: string,
    direction: "up" | "down",
  ) => Promise<boolean | void>
  onRename?: (viewId: string, name: string) => Promise<boolean | void>
  onRestore?: (viewId: string) => Promise<boolean | void>
  onSelect: (viewId: string) => void
  onSetFavorite?: (
    viewId: string,
    favorite: boolean,
  ) => Promise<boolean | void>
  onSetDefault?: (viewId: string) => Promise<boolean | void>
  onUpdateOptions?: (
    viewId: string,
    name: string,
    options: CreateViewOptions,
  ) => Promise<boolean | void>
  onCreateOpenChange?: (open: boolean) => void
  views: WorkspaceViewOption[]
}) {
  const [internalCreateOpen, setInternalCreateOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [name, setName] = useState("")
  const [createType, setCreateType] =
    useState<WorkspaceViewOption["type"]>(initialCreateType)
  const [layoutFieldId, setLayoutFieldId] = useState("")
  const [summaryFieldIds, setSummaryFieldIds] = useState<string[]>([])
  const [calendarDisplay, setCalendarDisplay] =
    useState<"month" | "agenda">("month")
  const [creating, setCreating] = useState(false)
  const [manageName, setManageName] = useState("")
  const [manageType, setManageType] =
    useState<WorkspaceViewOption["type"]>("grid")
  const [manageLayoutFieldId, setManageLayoutFieldId] = useState("")
  const [manageSummaryFieldIds, setManageSummaryFieldIds] = useState<
    string[]
  >([])
  const [manageCalendarDisplay, setManageCalendarDisplay] =
    useState<"month" | "agenda">("month")
  const [managing, setManaging] = useState(false)
  const createOpen = controlledCreateOpen ?? internalCreateOpen
  function setCreateOpen(open: boolean) {
    setInternalCreateOpen(open)
    onCreateOpenChange?.(open)
  }
  const activeViews = views.filter((view) => view.status === "active")
  const archivedViews = views.filter((view) => view.status === "archived")
  const favoriteViews = activeViews.filter((view) => view.isFavorite)
  const recentViews = activeViews
    .filter((view) => !view.isFavorite && view.lastOpenedAt)
    .toSorted(
      (left, right) =>
        (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0),
    )
  const otherViews = activeViews.filter(
    (view) => !view.isFavorite && !view.lastOpenedAt,
  )
  const viewSections = [
    { label: "Favorites", views: favoriteViews },
    { label: "Recent", views: recentViews },
    {
      label:
        favoriteViews.length || recentViews.length ? "Other views" : "Views",
      views: otherViews,
    },
  ].filter((section) => section.views.length > 0)
  const active =
    activeViews.find((view) => view.id === activeViewId) ??
    activeViews.find((view) => view.isDefault) ??
    activeViews[0]

  async function submit() {
    const normalized = name.trim()
    if (
      !normalized ||
      creating ||
      ((createType === "kanban" || createType === "calendar") &&
        !layoutFieldId)
    ) {
      return
    }
    setCreating(true)
    try {
      const viewId = await onCreate(normalized, {
        type: createType,
        ...(createType === "kanban"
          ? {
              kanbanFieldId: layoutFieldId,
              kanbanSummaryFieldIds: summaryFieldIds,
            }
          : {}),
        ...(createType === "calendar"
          ? {
              calendarDateFieldId: layoutFieldId,
              calendarDisplay,
            }
          : {}),
        ...(createType === "gallery"
          ? {
              ...(layoutFieldId
                ? { galleryCoverFieldId: layoutFieldId }
                : {}),
              gallerySummaryFieldIds: summaryFieldIds,
            }
          : {}),
      })
      if (viewId === false) return
      setName("")
      setCreateType("grid")
      setLayoutFieldId("")
      setSummaryFieldIds([])
      setCalendarDisplay("month")
      setCreateOpen(false)
      if (typeof viewId === "string") onSelect(viewId)
    } finally {
      setCreating(false)
    }
  }

  function openManage() {
    if (!active) return
    setManageName(active.name)
    setManageType(active.type)
    setManageLayoutFieldId(active.layoutFieldId ?? "")
    setManageSummaryFieldIds(
      active.type === "kanban"
        ? active.kanbanSummaryFieldIds ??
            suggestedSummaryFieldIds(
              fields,
              [active.layoutFieldId],
              3,
            )
        : active.type === "gallery"
          ? active.gallerySummaryFieldIds ??
            suggestedSummaryFieldIds(
              fields,
              [active.layoutFieldId],
              4,
            )
          : [],
    )
    setManageCalendarDisplay(active.calendarDisplay ?? "month")
    setManageOpen(true)
  }

  async function saveOptions() {
    const normalized = manageName.trim()
    if (
      !active ||
      !normalized ||
      managing ||
      ((manageType === "kanban" || manageType === "calendar") &&
        !manageLayoutFieldId)
    ) {
      return
    }
    const options: CreateViewOptions = {
      type: manageType,
      ...(manageType === "kanban"
        ? {
            kanbanFieldId: manageLayoutFieldId,
            kanbanSummaryFieldIds: manageSummaryFieldIds,
          }
        : {}),
      ...(manageType === "calendar"
        ? {
            calendarDateFieldId: manageLayoutFieldId,
            calendarDisplay: manageCalendarDisplay,
          }
        : {}),
      ...(manageType === "gallery"
        ? {
            ...(manageLayoutFieldId
              ? { galleryCoverFieldId: manageLayoutFieldId }
              : {}),
            gallerySummaryFieldIds: manageSummaryFieldIds,
          }
        : {}),
    }
    const layoutChanged =
      manageType !== active.type ||
      manageLayoutFieldId !== (active.layoutFieldId ?? "") ||
      (manageType === "kanban" &&
        JSON.stringify(manageSummaryFieldIds) !==
          JSON.stringify(active.kanbanSummaryFieldIds ?? [])) ||
      (manageType === "gallery" &&
        JSON.stringify(manageSummaryFieldIds) !==
          JSON.stringify(active.gallerySummaryFieldIds ?? [])) ||
      (manageType === "calendar" &&
        manageCalendarDisplay !== (active.calendarDisplay ?? "month"))
    if (normalized === active.name && !layoutChanged) {
      setManageOpen(false)
      return
    }
    setManaging(true)
    try {
      const saved = onUpdateOptions
        ? await onUpdateOptions(active.id, normalized, options)
        : onRename && normalized !== active.name
          ? await onRename(active.id, normalized)
          : false
      if (saved !== false) setManageOpen(false)
    } finally {
      setManaging(false)
    }
  }

  async function makeDefault() {
    if (!active || managing || !onSetDefault) return
    setManaging(true)
    try {
      const saved = await onSetDefault(active.id)
      if (saved !== false) setManageOpen(false)
    } finally {
      setManaging(false)
    }
  }

  async function deleteView() {
    if (!active || managing || !onDelete) return
    setManaging(true)
    try {
      const saved = await onDelete(active.id)
      if (saved !== false) {
        setDeleteOpen(false)
        setManageOpen(false)
      }
    } finally {
      setManaging(false)
    }
  }

  async function archiveView() {
    if (!active || managing || !onArchive) return
    setManaging(true)
    try {
      const saved = await onArchive(active.id)
      if (saved !== false) setManageOpen(false)
    } finally {
      setManaging(false)
    }
  }

  async function duplicateView() {
    if (!active || managing || !onDuplicate) return
    setManaging(true)
    try {
      const viewId = await onDuplicate(active.id)
      if (viewId === false) return
      setManageOpen(false)
      if (typeof viewId === "string") onSelect(viewId)
    } finally {
      setManaging(false)
    }
  }

  async function restoreView(viewId: string) {
    if (managing || !onRestore) return
    setManaging(true)
    try {
      await onRestore(viewId)
    } finally {
      setManaging(false)
    }
  }

  function resetCreateDialog() {
    setName("")
    setCreateType("grid")
    setLayoutFieldId("")
    setSummaryFieldIds([])
    setCalendarDisplay("month")
  }

  const layoutFieldOptions =
    createType === "kanban"
      ? fields
          .filter(
            (field) =>
              field.type === "singleSelect",
          )
          .map((field) => ({
            value: field.id,
            label: field.name,
            description: "Cards will be grouped by this column",
          }))
      : createType === "calendar"
        ? fields
            .filter((field) => field.type === "date")
            .map((field) => ({
              value: field.id,
              label: field.name,
              description:
                field.config?.dateStyle === "dateTime" ||
                field.config?.includeTime
                  ? "Date and time"
                  : "Date only",
            }))
        : fields
            .filter((field) => field.type === "attachment")
            .map((field) => ({
              value: field.id,
              label: field.name,
              description: "The first image becomes the card cover",
            }))
  const manageLayoutFieldOptions =
    manageType === "kanban"
      ? fields
          .filter(
            (field) =>
              field.type === "singleSelect",
          )
          .map((field) => ({
            value: field.id,
            label: field.name,
            description: "Cards will be grouped by this column",
          }))
      : manageType === "calendar"
        ? fields
            .filter((field) => field.type === "date")
            .map((field) => ({
              value: field.id,
              label: field.name,
              description:
                field.config?.dateStyle === "dateTime" ||
                field.config?.includeTime
                  ? "Date and time"
                  : "Date only",
            }))
        : fields
            .filter((field) => field.type === "attachment")
            .map((field) => ({
              value: field.id,
              label: field.name,
              description: "The first image becomes the card cover",
            }))
  const canCreate =
    Boolean(name.trim()) &&
    (createType === "grid" ||
      createType === "gallery" ||
      Boolean(layoutFieldId))

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label="Choose a view"
              className="max-w-52 justify-start px-2"
              size="sm"
              variant="ghost"
            />
          }
        >
          <ViewIcon type={active?.type ?? "grid"} />
          <span className="truncate">{active?.name ?? "Grid view"}</span>
          <ChevronDown className="ml-auto size-3.5 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuRadioGroup
            onValueChange={(viewId) => {
              if (viewId) onSelect(viewId)
            }}
            value={active?.id}
          >
            {viewSections.map((section, sectionIndex) => (
              <DropdownMenuGroup key={section.label}>
                {sectionIndex > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
                {section.views.map((view) => (
                  <DropdownMenuRadioItem
                    closeOnClick
                    key={view.id}
                    value={view.id}
                  >
                    <ViewIcon type={view.type} />
                    <span className="min-w-0 flex-1 truncate">
                      {view.name}
                    </span>
                    {view.isFavorite ? (
                      <Star
                        aria-label="Favorite"
                        className="size-3 fill-current text-amber-500"
                      />
                    ) : view.isDefault ? (
                      <span className="text-[10px] text-muted-foreground">
                        Default
                      </span>
                    ) : null}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuGroup>
            ))}
          </DropdownMenuRadioGroup>
          {active && onSetFavorite ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() =>
                  void onSetFavorite(active.id, !active.isFavorite)
                }
              >
                <Star
                  className={
                    active.isFavorite
                      ? "fill-current text-amber-500"
                      : undefined
                  }
                />
                {active.isFavorite
                  ? `Remove ${active.name} from favorites`
                  : `Add ${active.name} to favorites`}
              </DropdownMenuItem>
            </>
          ) : null}
          {archivedViews.length > 0 && onRestore ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Archived views</DropdownMenuLabel>
                {archivedViews.map((view) => (
                  <DropdownMenuItem
                    disabled={managing}
                    key={view.id}
                    onClick={() => void restoreView(view.id)}
                  >
                    <ArchiveRestore />
                    <span className="min-w-0 flex-1 truncate">
                      Restore {view.name}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </>
          ) : null}
          {canManage ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setCreateOpen(true)}>
                <Plus />
                Create view
              </DropdownMenuItem>
              {active &&
              (onRename ||
                onUpdateOptions ||
                onSetDefault ||
                onDelete) ? (
                <DropdownMenuItem onClick={openManage}>
                  <MoreHorizontal />
                  View options
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (creating) return
          setCreateOpen(open)
          if (!open) resetCreateDialog()
        }}
      >
        <DialogContent className="max-h-[min(760px,calc(100dvh-2rem))] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create a view</DialogTitle>
            <DialogDescription>
              Choose how you want to work with these records. You can change
              the layout later.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 py-2">
            <div className="grid gap-2">
              <Label htmlFor="new-view-name">View name</Label>
              <Input
                autoFocus
                id="new-view-name"
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canCreate) {
                    event.preventDefault()
                    void submit()
                  }
                }}
                placeholder="e.g. Launch schedule"
                value={name}
              />
            </div>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">Layout</legend>
              <div className="grid grid-cols-2 gap-2">
                {VIEW_TYPES.map((option) => {
                  const Icon = option.icon
                  const selected = createType === option.value
                  return (
                    <Button
                      aria-pressed={selected}
                      className="h-auto min-h-16 justify-start gap-3 px-3 py-2 text-left"
                      key={option.value}
                      onClick={() => {
                        setCreateType(option.value)
                        setLayoutFieldId("")
                        setSummaryFieldIds(
                          option.value === "kanban"
                            ? suggestedSummaryFieldIds(fields, [], 3)
                            : option.value === "gallery"
                              ? suggestedSummaryFieldIds(fields, [], 4)
                              : [],
                        )
                        setCalendarDisplay("month")
                      }}
                      type="button"
                      variant={selected ? "secondary" : "outline"}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span>
                        <span className="block text-sm font-medium">
                          {option.label}
                        </span>
                        <span className="block text-xs font-normal text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </Button>
                  )
                })}
              </div>
            </fieldset>
            {createType !== "grid" ? (
              <div className="grid gap-2">
                <Label htmlFor="view-layout-field">
                  {createType === "kanban"
                    ? "Group cards by"
                    : createType === "calendar"
                      ? "Date column"
                      : "Cover image"}
                </Label>
                <SearchableSelect
                  emptyMessage={
                    createType === "kanban"
                      ? "Add a single-choice column before creating a Kanban view."
                      : createType === "calendar"
                        ? "Add a date column before creating a calendar view."
                        : "No image columns are available yet."
                  }
                  id="view-layout-field"
                  onValueChange={(fieldId) => {
                    setLayoutFieldId(fieldId)
                    setSummaryFieldIds((current) =>
                      current.filter(
                        (selectedFieldId) =>
                          selectedFieldId !== fieldId,
                      ),
                    )
                  }}
                  options={layoutFieldOptions}
                  placeholder={
                    createType === "gallery"
                      ? "No cover image"
                      : "Choose a column"
                  }
                  searchPlaceholder="Search columns…"
                  value={layoutFieldId}
                />
                {createType === "gallery" ? (
                  <p className="text-xs text-muted-foreground">
                    A cover is optional. You can add one later.
                  </p>
                ) : null}
              </div>
            ) : null}
            {createType === "calendar" ? (
              <CalendarDisplayPicker
                onChange={setCalendarDisplay}
                value={calendarDisplay}
              />
            ) : null}
            {createType === "kanban" || createType === "gallery" ? (
              <SummaryFieldPicker
                disabled={creating}
                excludedFieldIds={[layoutFieldId]}
                fields={fields}
                limit={createType === "kanban" ? 3 : 4}
                onChange={setSummaryFieldIds}
                selectedFieldIds={summaryFieldIds}
              />
            ) : null}
          </div>
          <DialogFooter>
            <Button
              disabled={creating}
              onClick={() => setCreateOpen(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={!canCreate || creating}
              onClick={() => void submit()}
            >
              {creating ? (
                <>
                  <LoaderCircle className="animate-spin" />
                  Creating…
                </>
              ) : (
                "Create view"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={manageOpen}
        onOpenChange={(open) => {
          if (managing) return
          setManageOpen(open)
          if (!open) {
            setManageName("")
            setManageType("grid")
            setManageLayoutFieldId("")
            setManageSummaryFieldIds([])
            setManageCalendarDisplay("month")
          }
        }}
      >
        <DialogContent className="max-h-[min(760px,calc(100dvh-2rem))] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>View options</DialogTitle>
            <DialogDescription>
              Give this view a clear name or choose how teammates open it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 py-2">
            <div className="grid gap-2">
              <Label htmlFor="manage-view-name">View name</Label>
              <Input
                autoFocus
                disabled={managing || (!onRename && !onUpdateOptions)}
                id="manage-view-name"
                maxLength={120}
                onChange={(event) => setManageName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void saveOptions()
                  }
                }}
                value={manageName}
              />
            </div>
            {onUpdateOptions ? (
              <>
                <fieldset className="grid gap-2">
                  <legend className="text-sm font-medium">Layout</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {VIEW_TYPES.map((option) => {
                      const Icon = option.icon
                      const selected = manageType === option.value
                      return (
                        <Button
                          aria-pressed={selected}
                          className="h-auto min-h-14 justify-start gap-2 px-3 py-2 text-left"
                          disabled={managing}
                          key={option.value}
                          onClick={() => {
                            setManageType(option.value)
                            setManageLayoutFieldId("")
                            setManageSummaryFieldIds(
                              option.value === "kanban"
                                ? suggestedSummaryFieldIds(fields, [], 3)
                                : option.value === "gallery"
                                  ? suggestedSummaryFieldIds(fields, [], 4)
                                  : [],
                            )
                            setManageCalendarDisplay("month")
                          }}
                          type="button"
                          variant={selected ? "secondary" : "outline"}
                        >
                          <Icon className="size-4 shrink-0" />
                          <span className="text-sm font-medium">
                            {option.label}
                          </span>
                        </Button>
                      )
                    })}
                  </div>
                </fieldset>
                {manageType !== "grid" ? (
                  <div className="grid gap-2">
                    <Label htmlFor="manage-view-layout-column">
                      {manageType === "kanban"
                        ? "Group cards by"
                        : manageType === "calendar"
                          ? "Date column"
                          : "Cover image"}
                    </Label>
                    <SearchableSelect
                      emptyMessage={
                        manageType === "kanban"
                          ? "Add a single-choice column before using a Kanban layout."
                          : manageType === "calendar"
                            ? "Add a date column before using a calendar layout."
                            : "No image columns are available yet."
                      }
                      id="manage-view-layout-column"
                      onValueChange={(fieldId) => {
                        setManageLayoutFieldId(fieldId)
                        setManageSummaryFieldIds((current) =>
                          current.filter(
                            (selectedFieldId) =>
                              selectedFieldId !== fieldId,
                          ),
                        )
                      }}
                      options={manageLayoutFieldOptions}
                      placeholder={
                        manageType === "gallery"
                          ? "No cover image"
                          : "Choose a column"
                      }
                      searchPlaceholder="Search columns…"
                      value={manageLayoutFieldId}
                    />
                  </div>
                ) : null}
                {manageType === "calendar" ? (
                  <CalendarDisplayPicker
                    disabled={managing}
                    onChange={setManageCalendarDisplay}
                    value={manageCalendarDisplay}
                  />
                ) : null}
                {manageType === "kanban" ||
                manageType === "gallery" ? (
                  <SummaryFieldPicker
                    disabled={managing}
                    excludedFieldIds={[manageLayoutFieldId]}
                    fields={fields}
                    limit={manageType === "kanban" ? 3 : 4}
                    onChange={setManageSummaryFieldIds}
                    selectedFieldIds={manageSummaryFieldIds}
                  />
                ) : null}
              </>
            ) : null}
          </div>
          <DialogFooter className="sm:justify-between">
            <div className="flex gap-2">
              {onDuplicate ? (
                <Button
                  disabled={managing}
                  onClick={() => void duplicateView()}
                  variant="outline"
                >
                  <Copy />
                  Duplicate
                </Button>
              ) : null}
              {onMove ? (
                <>
                  <Button
                    aria-label={`Move ${active?.name ?? "view"} up`}
                    disabled={
                      managing ||
                      !active ||
                      activeViews.findIndex(
                        (view) => view.id === active.id,
                      ) <= 0
                    }
                    onClick={() => {
                      if (active) void onMove(active.id, "up")
                    }}
                    size="icon"
                    variant="outline"
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    aria-label={`Move ${active?.name ?? "view"} down`}
                    disabled={
                      managing ||
                      !active ||
                      activeViews.findIndex(
                        (view) => view.id === active.id,
                      ) >=
                        activeViews.length - 1
                    }
                    onClick={() => {
                      if (active) void onMove(active.id, "down")
                    }}
                    size="icon"
                    variant="outline"
                  >
                    <ArrowDown />
                  </Button>
                </>
              ) : null}
              {onArchive && !active?.isDefault ? (
                <Button
                  disabled={managing || activeViews.length <= 1}
                  onClick={() => void archiveView()}
                  variant="outline"
                >
                  <Archive />
                  Archive
                </Button>
              ) : null}
              {onDelete ? (
                <Button
                  disabled={managing || activeViews.length <= 1}
                  onClick={() => setDeleteOpen(true)}
                  variant="destructive"
                >
                  <Trash2 />
                  Delete
                </Button>
              ) : null}
              {onSetDefault && !active?.isDefault ? (
                <Button
                  disabled={managing}
                  onClick={() => void makeDefault()}
                  variant="outline"
                >
                  <Star />
                  Make default
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button
                disabled={managing}
                onClick={() => setManageOpen(false)}
                variant="outline"
              >
                Cancel
              </Button>
              {onRename || onUpdateOptions ? (
                <Button
                  disabled={
                    !manageName.trim() ||
                    managing ||
                    ((manageType === "kanban" ||
                      manageType === "calendar") &&
                      !manageLayoutFieldId)
                  }
                  onClick={() => void saveOptions()}
                >
                  {managing ? (
                    <>
                      <LoaderCircle className="animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save changes"
                  )}
                </Button>
              ) : null}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {active?.name ?? "this view"}?</AlertDialogTitle>
            <AlertDialogDescription>
              The records stay in the table. Only this saved arrangement and
              its filters will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={managing}>Keep view</AlertDialogCancel>
            <AlertDialogAction
              disabled={managing}
              onClick={(event) => {
                event.preventDefault()
                void deleteView()
              }}
              variant="destructive"
            >
              {managing ? "Deleting…" : "Delete view"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ViewIcon({ type }: { type: WorkspaceViewOption["type"] }) {
  switch (type) {
    case "calendar":
      return <CalendarDays />
    case "gallery":
      return <GalleryHorizontal />
    case "kanban":
      return <LayoutDashboard />
    default:
      return <Rows3 />
  }
}

function suggestedSummaryFieldIds(
  fields: readonly WorkspaceViewFieldOption[],
  excludedFieldIds: readonly (string | undefined)[],
  limit: number,
) {
  const excluded = new Set(excludedFieldIds.filter(Boolean))
  return fields
    .filter((field) => !field.isPrimary && !excluded.has(field.id))
    .slice(0, limit)
    .map((field) => field.id)
}

function CalendarDisplayPicker({
  disabled,
  onChange,
  value,
}: {
  disabled?: boolean
  onChange: (value: "month" | "agenda") => void
  value: "month" | "agenda"
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">Open calendar as</legend>
      <div className="grid grid-cols-2 gap-2">
        <Button
          aria-pressed={value === "month"}
          disabled={disabled}
          onClick={() => onChange("month")}
          type="button"
          variant={value === "month" ? "secondary" : "outline"}
        >
          <CalendarDays />
          Month
        </Button>
        <Button
          aria-pressed={value === "agenda"}
          disabled={disabled}
          onClick={() => onChange("agenda")}
          type="button"
          variant={value === "agenda" ? "secondary" : "outline"}
        >
          <Rows3 />
          Agenda
        </Button>
      </div>
    </fieldset>
  )
}

function SummaryFieldPicker({
  disabled,
  excludedFieldIds,
  fields,
  limit,
  onChange,
  selectedFieldIds,
}: {
  disabled?: boolean
  excludedFieldIds: readonly string[]
  fields: readonly WorkspaceViewFieldOption[]
  limit: number
  onChange: (fieldIds: string[]) => void
  selectedFieldIds: readonly string[]
}) {
  const excluded = new Set(excludedFieldIds.filter(Boolean))
  const availableFields = fields.filter(
    (field) => !field.isPrimary && !excluded.has(field.id),
  )

  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">Show on cards</legend>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          The main column is always used as the card title.
        </p>
        <span className="text-xs text-muted-foreground">
          {selectedFieldIds.length} of {limit} selected
        </span>
      </div>
      {availableFields.length > 0 ? (
        <div className="grid max-h-44 gap-1 overflow-y-auto rounded-lg border p-2">
          {availableFields.map((field) => {
            const checked = selectedFieldIds.includes(field.id)
            const checkboxId = `card-summary-${field.id}`
            return (
              <label
                className="flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-muted/60 has-disabled:cursor-not-allowed has-disabled:opacity-55"
                htmlFor={checkboxId}
                key={field.id}
              >
                <Checkbox
                  checked={checked}
                  disabled={
                    disabled ||
                    (!checked && selectedFieldIds.length >= limit)
                  }
                  id={checkboxId}
                  onCheckedChange={(nextChecked) => {
                    onChange(
                      nextChecked === true
                        ? [...selectedFieldIds, field.id]
                        : selectedFieldIds.filter(
                            (fieldId) => fieldId !== field.id,
                          ),
                    )
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{field.name}</span>
              </label>
            )
          })}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          Add another column to show more information on each card.
        </p>
      )}
    </fieldset>
  )
}

const VIEW_TYPES = [
  {
    value: "grid",
    label: "Grid",
    description: "Spreadsheet",
    icon: Rows3,
  },
  {
    value: "kanban",
    label: "Kanban",
    description: "Cards by status",
    icon: LayoutDashboard,
  },
  {
    value: "calendar",
    label: "Calendar",
    description: "Records by date",
    icon: CalendarDays,
  },
  {
    value: "gallery",
    label: "Gallery",
    description: "Visual cards",
    icon: GalleryHorizontal,
  },
] satisfies ReadonlyArray<{
  value: WorkspaceViewOption["type"]
  label: string
  description: string
  icon: typeof Rows3
}>
