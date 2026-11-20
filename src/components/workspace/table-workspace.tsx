"use client"

import {
  CalendarDays,
  Columns3,
  GanttChart,
  Loader2,
  Table2,
} from "lucide-react"
import { useSearchParams } from "next/navigation"
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import { toast } from "sonner"

import { AssistantDock } from "@/components/assistant/assistant-dock"
import { AssistantPanel } from "@/components/assistant/assistant-panel"
import { DataGrid } from "@/components/grid/data-grid"
import { Card, CardContent } from "@/components/ui/card"
import { CalendarView } from "@/components/views/calendar-view"
import { DashboardView } from "@/components/views/dashboard-view"
import { GalleryView } from "@/components/views/gallery-view"
import { KanbanView } from "@/components/views/kanban-view"
import { MobileRecordList } from "@/components/views/mobile-record-list"
import { RecordDrawer } from "@/components/views/record-drawer"
import { TimelineView, type TimelineScale } from "@/components/views/timeline-view"
import { ViewControlsBar } from "@/components/workspace/view-controls-bar"
import { WorkspaceHeader } from "@/components/workspace/workspace-header"
import { useTableData } from "@/hooks/use-table-data"
import type {
  CellValue,
  DashboardWidgetConfig,
  FieldDefinition,
} from "@/lib/domain"

const COMPACT_QUERY = "(max-width: 639px)"

function subscribeCompact(onChange: () => void) {
  const media = window.matchMedia(COMPACT_QUERY)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

function compactSnapshot() {
  return window.matchMedia(COMPACT_QUERY).matches
}

function useCompactViewport() {
  return useSyncExternalStore(subscribeCompact, compactSnapshot, () => false)
}

function pickField(
  fields: readonly FieldDefinition[],
  fieldId: unknown,
  predicate: (field: FieldDefinition) => boolean,
): FieldDefinition | undefined {
  const configured =
    typeof fieldId === "string"
      ? fields.find((field) => field.id === fieldId)
      : undefined
  if (configured && predicate(configured)) return configured
  return fields.find(predicate)
}

function gridRowHeight(value: unknown): "compact" | "medium" | "tall" {
  if (value === "compact" || value === "tall") return value
  // Legacy saved views used "short" for the most compact row height.
  if (value === "short") return "compact"
  return "medium"
}

function ViewPlaceholder({
  description,
  icon: Icon,
  title,
}: {
  description: string
  icon: typeof Table2
  title: string
}) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center p-6">
      <Card className="max-w-sm">
        <CardContent className="grid place-items-center gap-2 py-10 text-center">
          <Icon className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </div>
  )
}

export function TableWorkspace({
  baseId,
  baseName,
  tableId,
}: {
  baseId: string
  baseName: string
  tableId: string
}) {
  const data = useTableData(tableId)
  const compact = useCompactViewport()
  const searchParams = useSearchParams()
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [searchDraft, setSearchDraft] = useState("")
  const [deepLinkRecordId, setDeepLinkRecordId] = useState<string>()

  const {
    activeView,
    applySearch,
    clearError,
    controls,
    error,
    fields,
    groupCounts,
    groupLabels,
    loading,
    records,
    search,
    syncing,
    table,
    totalRecordCount,
    views,
  } = data

  // Table search is debounced so typing does not fire a query per keystroke.
  useEffect(() => {
    const trimmed = searchDraft.trim()
    if (trimmed === search) return
    const handle = window.setTimeout(() => {
      void applySearch(trimmed)
    }, 250)
    return () => window.clearTimeout(handle)
  }, [applySearch, search, searchDraft])

  useEffect(() => {
    if (error) {
      toast.error(error)
      clearError()
    }
  }, [clearError, error])

  useEffect(() => {
    // Read the deep link after paint so the drawer opens against loaded rows.
    const handle = window.setTimeout(() => {
      const recordId = searchParams.get("record")
      if (recordId) setDeepLinkRecordId(recordId)
    }, 0)
    return () => window.clearTimeout(handle)
  }, [searchParams])

  const openAssistant = useCallback(() => setAssistantOpen(true), [])

  const assistantContext = useMemo(
    () => ({
      base: { id: baseId, name: baseName },
      table: { id: tableId, name: table?.name },
      ...(activeView ? { view: { id: activeView.id, name: activeView.name } } : {}),
    }),
    [activeView, baseId, baseName, table?.name, tableId],
  )

  const handleDataMutated = useCallback(() => {
    void data.refresh(data.activeViewId)
  }, [data])

  const updateCell = useCallback(
    (recordId: string, fieldId: string, value: CellValue, expectedRevision: number) => {
      data.updateCell(recordId, fieldId, value, expectedRevision)
    },
    [data],
  )

  const uploadAttachments = useCallback(
    (recordId: string, fieldId: string, files: File[]) =>
      data.uploadAttachments({ recordId, fieldId }, files),
    [data],
  )

  const configuration = activeView?.configuration ?? {}
  const viewType = activeView?.type ?? "grid"

  const kanbanField = useMemo(
    () =>
      pickField(
        fields,
        configuration.kanbanFieldId,
        (field) => field.type === "singleSelect" || field.type === "multiSelect",
      ),
    [configuration.kanbanFieldId, fields],
  )
  const timelineStartField = useMemo(
    () =>
      pickField(
        fields,
        configuration.timelineStartFieldId,
        (field) => field.type === "date" || field.type === "createdTime",
      ),
    [configuration.timelineStartFieldId, fields],
  )
  const timelineEndField = useMemo(
    () => fields.find((field) => field.id === configuration.timelineEndFieldId),
    [configuration.timelineEndFieldId, fields],
  )
  const timelineGroupField = useMemo(
    () => fields.find((field) => field.id === configuration.timelineGroupFieldId),
    [configuration.timelineGroupFieldId, fields],
  )
  const calendarField = useMemo(
    () =>
      pickField(
        fields,
        configuration.calendarDateFieldId,
        (field) => field.type === "date" || field.type === "createdTime",
      ),
    [configuration.calendarDateFieldId, fields],
  )
  const galleryCoverField = useMemo(() => {
    const configured = fields.find(
      (field) => field.id === configuration.galleryCoverFieldId,
    )
    return (
      configured ??
      fields.find((field) => field.type === "image") ??
      fields.find((field) => field.type === "attachment")
    )
  }, [configuration.galleryCoverFieldId, fields])
  const dashboardWidgets = useMemo(
    () =>
      Array.isArray(configuration.dashboardWidgets)
        ? (configuration.dashboardWidgets as DashboardWidgetConfig[])
        : [],
    [configuration.dashboardWidgets],
  )

  const deepLinkRecord = records.find((record) => record.id === deepLinkRecordId)

  function renderView() {
    if (loading) {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading records…
        </div>
      )
    }

    if (compact && viewType === "grid") {
      return (
        <MobileRecordList
          className="min-h-0 flex-1"
          emptyMessage="No records yet. Add the first one."
          fields={fields}
          onAddRecord={() => void data.addRecord()}
          onUpdateCell={updateCell}
          onUploadAttachments={uploadAttachments}
          records={records}
        />
      )
    }

    switch (viewType) {
      case "kanban":
        if (!kanbanField) {
          return (
            <ViewPlaceholder
              description="Add a single-select column so cards can be grouped into lanes."
              icon={Columns3}
              title="Kanban needs a grouping column"
            />
          )
        }
        return (
          <KanbanView
            fields={fields}
            groupField={kanbanField}
            onUpdateCell={updateCell}
            onUploadAttachments={uploadAttachments}
            records={records}
            summaryFields={
              Array.isArray(configuration.kanbanSummaryFieldIds)
                ? fields.filter((field) =>
                    (configuration.kanbanSummaryFieldIds as string[]).includes(
                      field.id,
                    ),
                  )
                : fields.slice(0, 3)
            }
          />
        )
      case "timeline":
        if (!timelineStartField) {
          return (
            <ViewPlaceholder
              description="Add a date column so records can be placed on the ruler."
              icon={GanttChart}
              title="Timeline needs a start date"
            />
          )
        }
        return (
          <TimelineView
            endField={timelineEndField}
            fields={fields}
            groupField={timelineGroupField}
            onAddRecord={() => void data.addRecord()}
            onScaleChange={(scale: TimelineScale) =>
              void data.updateViewConfiguration({ timelineScale: scale })
            }
            onSelectDateFields={(startFieldId, endFieldId) =>
              void data.updateViewConfiguration({
                timelineStartFieldId: startFieldId,
                timelineEndFieldId: endFieldId,
              })
            }
            onUpdateCell={updateCell}
            onUploadAttachments={uploadAttachments}
            records={records}
            scale={(configuration.timelineScale as TimelineScale) ?? "week"}
            startField={timelineStartField}
          />
        )
      case "calendar":
        if (!calendarField) {
          return (
            <ViewPlaceholder
              description="Add a date column so records can be scheduled."
              icon={CalendarDays}
              title="Calendar needs a date column"
            />
          )
        }
        return (
          <CalendarView
            dateField={calendarField}
            fields={fields}
            initialDisplay={
              configuration.calendarDisplay === "agenda" ? "agenda" : "month"
            }
            onDisplayChange={(display) =>
              void data.updateViewConfiguration({ calendarDisplay: display })
            }
            onUpdateCell={updateCell}
            onUploadAttachments={uploadAttachments}
            records={records}
          />
        )
      case "gallery":
        return (
          <GalleryView
            coverField={galleryCoverField}
            fields={fields}
            onUpdateCell={updateCell}
            onUploadAttachments={uploadAttachments}
            records={records}
          />
        )
      case "dashboard":
        return (
          <DashboardView
            fields={fields}
            onUpdateWidgets={data.updateWidgets}
            records={records}
            widgets={dashboardWidgets}
          />
        )
      default:
        return (
          <DataGrid
            canManageSchema
            exportName={table?.name ?? "records"}
            fields={fields}
            onAddField={data.addField}
            onAddRecord={() => void data.addRecord()}
            onBatchUpdateCells={data.batchUpdateCells}
            onDeleteField={data.deleteField}
            onDeleteRecords={data.deleteRecords}
            onDuplicateField={data.duplicateField}
            onDuplicateRecords={data.duplicateRecords}
            onFreezeField={data.freezeField}
            onRenameField={data.renameField}
            onReorderField={data.reorderField}
            onResizeField={data.resizeField}
            onUpdateCell={updateCell}
            onUploadAttachments={uploadAttachments}
            recordGroupCounts={groupCounts}
            recordGroupLabels={groupLabels}
            records={records}
            rowHeight={gridRowHeight(configuration.rowHeight)}
            syncing={syncing}
            totalRecordCount={totalRecordCount}
          />
        )
    }
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <WorkspaceHeader
        assistantOpen={assistantOpen}
        baseId={baseId}
        baseName={baseName}
        onOpenAssistant={openAssistant}
        tableName={table?.name}
      />

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeView ? (
          <ViewControlsBar
            activeViewId={activeView.id}
            canDeleteView={views.length > 1}
            disabled={syncing}
            fields={fields}
            onControlsChange={data.updateControls}
            onCreateView={data.createView}
            onDeleteView={data.deleteView}
            onRenameView={data.renameView}
            onSearchChange={setSearchDraft}
            onSelectView={(viewId) => void data.selectView(viewId)}
            searchValue={searchDraft}
            trailing={
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {totalRecordCount} {totalRecordCount === 1 ? "record" : "records"}
              </span>
            }
            viewControlsValue={controls}
            views={views}
          />
        ) : null}

        {renderView()}
      </main>

      <AssistantDock
        label="AI workspace assistant"
        onOpenChange={setAssistantOpen}
        open={assistantOpen}
      >
        <AssistantPanel
          context={assistantContext}
          onDataMutated={handleDataMutated}
        />
      </AssistantDock>

      <RecordDrawer
        fields={fields}
        onOpenChange={(open) => {
          if (!open) setDeepLinkRecordId(undefined)
        }}
        onUpdateCell={updateCell}
        onUploadAttachments={uploadAttachments}
        open={Boolean(deepLinkRecord)}
        record={deepLinkRecord}
      />
    </div>
  )
}
