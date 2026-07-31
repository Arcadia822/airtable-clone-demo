"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react"
import { generateKeyBetween } from "jittered-fractional-indexing"
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  Columns3,
  FileText,
  GalleryHorizontal,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  Rows3,
  Star,
  Table2,
  Trash2,
  UploadCloud,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { ComponentErrorBoundary } from "@/components/component-error-boundary"
import { CurrencySelect } from "@/components/currency-select"
import { FieldValidationInputs } from "@/components/field-validation-inputs"
import { SearchableSelect } from "@/components/searchable-select"
import { FloatingAssistantLauncher } from "@/components/assistant/floating-assistant-launcher"
import { ConnectedAssistantSheet } from "@/components/connected/assistant-sheet"
import { FormBreadcrumbs } from "@/components/connected/form-breadcrumbs"
import {
  ConnectedTablePresence,
  type WorkspacePresenceEntry,
} from "@/components/connected/table-presence"
import {
  ViewSwitcher,
  type CreateViewOptions,
  type WorkspaceViewOption,
} from "@/components/connected/view-switcher"
import {
  ViewControls,
  type ViewControlsValue,
} from "@/components/connected/view-controls"
import { FieldConversionDialog } from "@/components/connected/field-conversion-dialog"
import {
  FieldArchiveImpact,
  fieldArchiveDescription,
  fieldArchiveSuccessMessage,
  type FieldArchiveImpactData,
} from "@/components/connected/field-archive-impact"
import { RecordsPageFooter } from "@/components/connected/records-page-footer"
import {
  fieldConfigForMutation,
  toGridField,
  toGridRecord,
  type AttachmentMetadata,
} from "@/components/connected/adapters"
import {
  ConnectedLoading,
  ConnectedTopBar,
} from "@/components/connected/org-states"
import { OrganizationAuthGate } from "@/components/connected/organization-auth-gate"
import { useLiveConnectionHealth } from "@/components/connected/connection-status"
import {
  DataGrid,
  type GridCellBatchFailure,
  type GridCellBatchResult,
  type GridCellBatchUpdate,
  type GridFieldReorderFailure,
} from "@/components/grid/data-grid"
import { CalendarView } from "@/components/views/calendar-view"
import { GalleryView } from "@/components/views/gallery-view"
import { KanbanView } from "@/components/views/kanban-view"
import { UrlRecordDrawer } from "@/components/connected/url-record-drawer"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type {
  AttachmentValue,
  CellValue,
  FieldConfig,
  FieldDefinition,
  FieldType,
  GridRecord,
} from "@/lib/domain"
import {
  attachmentAccept,
  attachmentKindErrorMessage,
} from "@/lib/file-selection"
import { moveItemToIndex } from "@/lib/column-interactions"
import { getFieldTypeLabel } from "@/lib/field-type-meta"
import { fieldConfigIssue } from "@/lib/field-config-validation"
import {
  CONVERTIBLE_FIELD_TYPES,
  conversionConfigForTarget,
  fieldConversionConfigIssue,
  isConvertibleFieldType,
  type ConvertibleFieldType,
  type FieldConversionJobProgress,
  type FieldConversionPreview,
} from "@/lib/field-conversion"
import { MAX_FILE_BYTES } from "@/lib/plans"
import { publicErrorMessage } from "@/lib/public-errors"
import { compareRanks } from "@/lib/rank"
import { useUrlAction } from "@/lib/use-url-action"
import { viewSelectionHref } from "@/lib/view-navigation"
import {
  chunkBulkRecords,
  duplicateRecordValues,
} from "@/lib/record-workflows"
import {
  flattenSavedViewGroups,
  processSavedView,
} from "@/lib/view-processing"

const SELECT_OPTION_COLORS = [
  "#2563eb",
  "#0891b2",
  "#ea580c",
  "#64748b",
  "#2563eb",
  "#65a30d",
  "#ca8a04",
  "#475569",
] as const

const VIEW_TYPE_TABS = [
  { type: "grid", label: "Grid", icon: Rows3 },
  { type: "kanban", label: "Kanban", icon: LayoutDashboard },
  { type: "calendar", label: "Calendar", icon: CalendarDays },
  { type: "gallery", label: "Gallery", icon: GalleryHorizontal },
] as const

type PendingDeletion =
  | { kind: "field"; id: string; label: string }
  | { kind: "attachment"; id: string; label: string }

type FieldDraft = {
  name: string
  type: FieldType
  config: FieldConfig
}

type PendingFieldConversion = {
  fieldId: string
  columnName: string
  targetType: ConvertibleFieldType
  targetConfig: FieldConfig
}

export function ConnectedWorkspace({
  baseId,
  tableId,
}: {
  baseId: string
  tableId: string
}) {
  return (
    <OrganizationAuthGate>
      {({ auth }) => (
        <WorkspaceData
          baseId={baseId as Id<"bases">}
          canManageSchema={
            auth.orgRole?.replace(/^org:/, "") === "admin"
          }
          canUseAi={auth.has({ feature: "ai_assistant" })}
          tableId={tableId as Id<"tables">}
        />
      )}
    </OrganizationAuthGate>
  )
}

function WorkspaceData({
  baseId,
  tableId,
  canManageSchema,
  canUseAi,
}: {
  baseId: Id<"bases">
  tableId: Id<"tables">
  canManageSchema: boolean
  canUseAi: boolean
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const base = useQuery(api.bases.get, { baseId }) as
    | Doc<"bases">
    | undefined
  const tables = useQuery(api.tables.list, { baseId }) as
    | Doc<"tables">[]
    | undefined
  const fieldDocs = useQuery(api.fields.list, { tableId }) as
    | Doc<"fields">[]
    | undefined
  const viewDocs = useQuery(api.views.list, {
    tableId,
    includeArchived: true,
  }) as
    | Doc<"views">[]
    | undefined
  const viewPreferences = useQuery(api.views.listPreferences, {
    tableId,
  }) as
    | {
        viewId: Id<"views">
        isFavorite: boolean
        lastOpenedAt?: number
      }[]
    | undefined
  const requestedViewId = searchParams.get("view")
  const selectedViewId =
    requestedViewId &&
    viewDocs?.some(
      (view) =>
        view._id === requestedViewId && view.status === "active",
    )
      ? (requestedViewId as Id<"views">)
      : undefined
  const viewData = useQuery(api.views.get, {
    tableId,
    ...(selectedViewId ? { viewId: selectedViewId } : {}),
  }) as
    | {
        view: Doc<"views">
        fieldConfigs: Doc<"viewFieldConfigs">[]
      }
    | null
    | undefined
  const viewMaterialization = useQuery(
    api.viewMaterializations.status,
    viewData?.view ? { viewId: viewData.view._id } : "skip",
  ) as
    | {
        mode: "direct" | "building" | "ready"
        materializationId: Id<"viewMaterializations"> | null
        matchedCount: number | null
        message: string | null
      }
    | undefined
  const directRecordsQuery = usePaginatedQuery(
    api.records.listPage,
    viewMaterialization?.mode === "direct" ? { tableId } : "skip",
    { initialNumItems: 100 },
  )
  const materializedRecordsQuery = usePaginatedQuery(
    api.viewMaterializations.listPage,
    viewData?.view &&
      viewMaterialization?.mode === "ready" &&
      viewMaterialization.materializationId
      ? {
          viewId: viewData.view._id,
          materializationId: viewMaterialization.materializationId,
        }
      : "skip",
    { initialNumItems: 100 },
  )
  const recordsQuery =
    viewMaterialization?.mode === "ready"
      ? materializedRecordsQuery
      : directRecordsQuery
  const recordsPreparing =
    Boolean(viewData?.view) &&
    viewMaterialization?.mode === "building"
  const tableRecordTotal = useQuery(api.records.count, { tableId })

  const createTable = useMutation(api.tables.create)
  const createField = useMutation(api.fields.create)
  const updateField = useMutation(api.fields.update)
  const ensureViewMaterialization = useMutation(
    api.viewMaterializations.ensure,
  )
  const startTypeConversionJob = useMutation(
    api.fields.startTypeConversionJob,
  )
  const stageTypeConversionBatch = useMutation(
    api.fields.stageTypeConversionBatch,
  )
  const beginTypeConversionApply = useMutation(
    api.fields.beginTypeConversionApply,
  )
  const applyTypeConversionBatch = useMutation(
    api.fields.applyTypeConversionBatch,
  )
  const requestTypeConversionCancel = useMutation(
    api.fields.requestTypeConversionCancel,
  )
  const cancelTypeConversionBatch = useMutation(
    api.fields.cancelTypeConversionBatch,
  )
  const retryTypeConversionJob = useMutation(
    api.fields.retryTypeConversionJob,
  )
  const archiveFieldMutation = useMutation(api.fields.archive)
  const restoreFieldMutation = useMutation(api.fields.restore)
  const createRecord = useMutation(api.records.create)
  const updateCellMutation = useMutation(api.records.updateCell)
  const batchUpdateCellsMutation = useMutation(api.records.batchUpdateCells)
  const bulkRemoveRecordsMutation = useMutation(api.records.bulkRemove)
  const restoreRecordMutation = useMutation(api.records.restore)
  const moveRecordMutation = useMutation(api.records.move)
  const createUploadSession = useMutation(api.attachments.createUploadSession)
  const finalizeUploadSession = useMutation(api.attachments.finalizeUploadSession)
  const removeAttachment = useMutation(api.attachments.remove)
  const createView = useMutation(api.views.create)
  const duplicateViewMutation = useMutation(api.views.duplicate)
  const reorderViewMutation = useMutation(api.views.reorder)
  const updateView = useMutation(api.views.update)
  const removeViewMutation = useMutation(api.views.remove)
  const setDefaultViewMutation = useMutation(api.views.setDefault)
  const setFavoriteViewMutation = useMutation(api.views.setFavorite)
  const recordViewOpenedMutation = useMutation(api.views.recordOpened)
  const reorderViewField = useMutation(api.views.reorderField)
  const updateViewFieldConfig = useMutation(api.views.updateFieldConfig)
  const updatePresenceLocationMutation = useMutation(
    api.presence.updateLocation,
  )

  const [pendingWrites, setPendingWrites] = useState(0)
  const connectionHealth = useLiveConnectionHealth(pendingWrites)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [collaborators, setCollaborators] = useState<
    WorkspacePresenceEntry[]
  >([])
  const [presenceReady, setPresenceReady] = useState(false)
  const [tableDialogOpen, setTableDialogOpen] =
    useUrlAction("new-table")
  const [newViewOpen, setNewViewOpen] = useUrlAction("new-view")
  const [requestedViewType, setRequestedViewType] =
    useState<WorkspaceViewOption["type"]>("grid")
  const [newRecordRequested, setNewRecordRequested] =
    useUrlAction("new-record")
  const newRecordHandledRef = useRef(false)
  const [tableName, setTableName] = useState("")
  const [creatingTable, setCreatingTable] = useState(false)
  const [recordOrderOpen, setRecordOrderOpen] = useState(false)
  const [gridEpoch, setGridEpoch] = useState(0)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadRecordId, setUploadRecordId] = useState("")
  const [uploadFieldId, setUploadFieldId] = useState("")
  const [uploadFile, setUploadFile] = useState<File>()
  const [uploading, setUploading] = useState(false)
  const [pendingDeletion, setPendingDeletion] =
    useState<PendingDeletion | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [fieldManagerOpen, setFieldManagerOpen] = useState(false)
  const [archivedColumnsOpen, setArchivedColumnsOpen] = useState(false)
  const [restoringFieldId, setRestoringFieldId] = useState<string>()
  const [focusedFieldId, setFocusedFieldId] = useState<string>()
  const [fieldDrafts, setFieldDrafts] = useState<
    Record<string, FieldDraft>
  >({})
  const [pendingFieldConversion, setPendingFieldConversion] =
    useState<PendingFieldConversion>()
  const [conversionAcknowledged, setConversionAcknowledged] =
    useState(false)
  const [conversionApplying, setConversionApplying] = useState(false)
  const [conversionStepError, setConversionStepError] = useState<string>()
  const conversionStepInFlightRef = useRef(false)
  const exactConfirmationJobRef = useRef<string | undefined>(undefined)
  const [fieldVisibilityDrafts, setFieldVisibilityDrafts] = useState<
    Record<string, boolean>
  >({})
  const activeViewRevisionRef = useRef(1)
  const activeViewIdRef = useRef<Id<"views"> | undefined>(undefined)
  const ensuredMaterializationKeyRef = useRef<string | undefined>(
    undefined,
  )
  const archiveImpact = useQuery(
    api.fields.getArchiveImpact,
    pendingDeletion?.kind === "field"
      ? { fieldId: pendingDeletion.id as Id<"fields"> }
      : "skip",
  ) as FieldArchiveImpactData | undefined
  const activeConversionJob = useQuery(
    api.fields.getActiveTypeConversionJob,
    { tableId },
  ) as FieldConversionJobProgress | null | undefined
  const displayedConversionJob = activeConversionJob
    ? conversionStepError
      ? {
          ...activeConversionJob,
          status: "failed" as const,
          failureMessage: conversionStepError,
        }
      : activeConversionJob
    : null
  const conversionBusy =
    conversionApplying ||
    Boolean(
      displayedConversionJob &&
        (displayedConversionJob.status === "staging" ||
          displayedConversionJob.status === "applying" ||
          displayedConversionJob.status === "cancelling"),
    )
  const conversionConfigIssue = pendingFieldConversion
    ? fieldConversionConfigIssue(
        pendingFieldConversion.targetType,
        pendingFieldConversion.targetConfig,
      )
    : null
  const fieldConversionPreview = useQuery(
    api.fields.previewTypeConversion,
    pendingFieldConversion &&
      activeConversionJob === null &&
      !conversionConfigIssue
      ? {
          fieldId: pendingFieldConversion.fieldId as Id<"fields">,
          newType: pendingFieldConversion.targetType,
          newConfig: fieldConfigForMutation(
            pendingFieldConversion.targetConfig,
          ),
        }
      : "skip",
  ) as FieldConversionPreview | undefined
  const archivedColumns = useQuery(
    api.fields.listArchived,
    canManageSchema && archivedColumnsOpen ? { tableId } : "skip",
  ) as
    | Array<{
        fieldId: Id<"fields">
        name: string
        archivedAt: number
      }>
    | undefined

  useEffect(() => {
    if (!viewData?.view) {
      activeViewIdRef.current = undefined
      return
    }
    activeViewIdRef.current = viewData.view._id
    activeViewRevisionRef.current = viewData.view.revision
  }, [viewData?.view])

  useEffect(() => {
    const view = viewData?.view
    if (!view || viewMaterialization?.mode !== "building") {
      ensuredMaterializationKeyRef.current = undefined
      return
    }
    const key = `${view._id}:${view.revision}`
    if (ensuredMaterializationKeyRef.current === key) return
    ensuredMaterializationKeyRef.current = key
    void ensureViewMaterialization({ viewId: view._id }).catch(() => {
      ensuredMaterializationKeyRef.current = undefined
    })
  }, [
    ensureViewMaterialization,
    viewData?.view,
    viewMaterialization?.mode,
  ])

  useEffect(() => {
    if (!activeConversionJob) return
    const shouldResetAcknowledgement =
      activeConversionJob.status === "ready" &&
      exactConfirmationJobRef.current !== activeConversionJob.jobId
    if (shouldResetAcknowledgement) {
      exactConfirmationJobRef.current = activeConversionJob.jobId
    }
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      if (shouldResetAcknowledgement) {
        setConversionAcknowledged(false)
      }
      setPendingFieldConversion((current) =>
        current?.fieldId === activeConversionJob.fieldId
          ? current
          : {
              fieldId: activeConversionJob.fieldId,
              columnName: activeConversionJob.columnName,
              targetType: activeConversionJob.targetType,
              targetConfig: activeConversionJob.targetConfig,
            },
      )
    })
    return () => {
      cancelled = true
    }
  }, [activeConversionJob])

  useEffect(() => {
    const job = activeConversionJob
    if (
      !job ||
      job.status === "failed" ||
      job.status === "ready" ||
      job.status === "completed" ||
      job.status === "cancelled" ||
      conversionStepError ||
      conversionStepInFlightRef.current
    ) {
      return
    }

    conversionStepInFlightRef.current = true
    setPendingWrites((count) => count + 1)
    void (async () => {
      try {
        const result =
          job.status === "staging"
            ? await stageTypeConversionBatch({
                jobId: job.jobId as Id<"fieldConversionJobs">,
              })
            : job.status === "cancelling"
              ? await cancelTypeConversionBatch({
                  jobId: job.jobId as Id<"fieldConversionJobs">,
                })
              : await applyTypeConversionBatch({
                  jobId: job.jobId as Id<"fieldConversionJobs">,
                })
        if (result.status === "cancelled") {
          setPendingFieldConversion(undefined)
          setConversionAcknowledged(false)
          setConversionStepError(undefined)
          toast.success("Column change cancelled")
          return
        }
        if (result.status !== "completed") return
        setFieldDrafts((current) => {
          const draft = current[result.fieldId]
          if (!draft) return current
          return {
            ...current,
            [result.fieldId]: {
              ...draft,
              type: result.targetType,
              config: result.targetConfig,
            },
          }
        })
        setPendingFieldConversion(undefined)
        setConversionAcknowledged(false)
        setConversionStepError(undefined)
        toast.success(
          `${result.columnName} changed to ${getFieldTypeLabel(
            result.targetType,
          )}`,
        )
      } catch (error) {
        setConversionStepError(publicErrorMessage(error))
      } finally {
        conversionStepInFlightRef.current = false
        setPendingWrites((count) => Math.max(0, count - 1))
      }
    })()
  }, [
    activeConversionJob,
    applyTypeConversionBatch,
    cancelTypeConversionBatch,
    conversionStepError,
    stageTypeConversionBatch,
  ])

  const viewFieldConfigById = useMemo(
    () =>
      new Map<string, Doc<"viewFieldConfigs">>(
        (viewData?.fieldConfigs ?? []).map((config) => [
          config.fieldId,
          config,
        ]),
      ),
    [viewData?.fieldConfigs],
  )
  const allFields = useMemo(
    () =>
      (fieldDocs ?? [])
        .map((field) => {
          const definition = toGridField(field)
          const viewConfig = viewFieldConfigById.get(field._id)
          return viewConfig
            ? {
                ...definition,
                rank: viewConfig.rank,
                width: viewConfig.width,
                frozen: viewConfig.frozen,
              }
            : { ...definition, frozen: definition.isPrimary }
        })
        .sort(compareRanks),
    [fieldDocs, viewFieldConfigById],
  )
  const fields = useMemo(
    () =>
      allFields.filter(
        (field) => !viewFieldConfigById.get(field.id)?.hidden,
      ),
    [allFields, viewFieldConfigById],
  )
  const attachmentIds = useMemo(() => {
    if (!fieldDocs) return []
    const attachmentFieldIds = new Set(
      fieldDocs
        .filter((field) => field.type === "attachment")
        .map((field) => field._id),
    )
    const ids = new Set<Id<"attachments">>()
    for (const record of recordsQuery.results as Doc<"records">[]) {
      for (const fieldId of attachmentFieldIds) {
        const value = record.values[fieldId]
        if (!Array.isArray(value)) continue
        for (const attachmentId of value) {
          if (typeof attachmentId === "string") {
            ids.add(attachmentId as Id<"attachments">)
            if (ids.size === 1_000) return [...ids]
          }
        }
      }
    }
    return [...ids]
  }, [fieldDocs, recordsQuery.results])
  const attachmentMetadata = useQuery(
    api.attachments.resolveMetadata,
    attachmentIds.length ? { tableId, attachmentIds } : "skip",
  ) as
    | Array<{
        id: Id<"attachments">
        recordId: Id<"records">
        fieldId: Id<"fields">
        name: string
        mimeType: string
        size: number
        url: string | null
      }>
    | undefined
  const attachmentMetadataById = useMemo(
    () =>
      new Map<string, AttachmentMetadata>(
        (attachmentMetadata ?? []).map((attachment) => [
          attachment.id,
          attachment,
        ]),
      ),
    [attachmentMetadata],
  )
  const records = useMemo(
    () =>
      (
        recordsQuery.results as Array<
          Doc<"records"> & {
            viewGroupCount?: number
            viewGroupLabel?: string
          }
        >
      ).map((record) =>
        toGridRecord(record, fieldDocs ?? [], attachmentMetadataById),
      ),
    [attachmentMetadataById, fieldDocs, recordsQuery.results],
  )
  const materializedGroupLabels = useMemo(
    () =>
      Object.fromEntries(
        (
          recordsQuery.results as Array<
            Doc<"records"> & {
              viewGroupCount?: number
              viewGroupLabel?: string
            }
          >
        ).flatMap((record) =>
          record.viewGroupLabel
            ? [[record._id, record.viewGroupLabel] as const]
            : [],
        ),
      ),
    [recordsQuery.results],
  )
  const materializedGroupCounts = useMemo(
    () =>
      Object.fromEntries(
        (
          recordsQuery.results as Array<
            Doc<"records"> & {
              viewGroupCount?: number
              viewGroupLabel?: string
            }
          >
        ).flatMap((record) =>
          record.viewGroupLabel &&
          typeof record.viewGroupCount === "number"
            ? [[record.viewGroupLabel, record.viewGroupCount] as const]
            : [],
        ),
      ),
    [recordsQuery.results],
  )
  const viewControlsValue = useMemo<ViewControlsValue>(
    () => ({
      filterConjunction: viewData?.view.filterConjunction ?? "and",
      filters: (viewData?.view.filters ?? []).map((filter) => ({
        id: filter.id,
        fieldId: filter.fieldId,
        operator: filter.operator,
        ...(filter.value === undefined ? {} : { value: filter.value }),
      })),
      sorts: (viewData?.view.sorts ?? []).map((sort) => ({
        id: sort.id,
        fieldId: sort.fieldId,
        direction: sort.direction,
        rank: sort.rank,
      })),
      groups: (viewData?.view.groups ?? []).map((group) => ({
        id: group.id,
        fieldId: group.fieldId,
        direction: group.direction,
        rank: group.rank,
      })),
    }),
    [viewData?.view],
  )
  const processedView = useMemo(
    () =>
      viewMaterialization?.mode === "ready"
        ? { records, groups: [] }
        : processSavedView(records, allFields, viewControlsValue),
    [allFields, records, viewControlsValue, viewMaterialization?.mode],
  )
  const groupedView = useMemo(
    () =>
      viewMaterialization?.mode === "ready"
        ? {
            records: processedView.records,
            labelsByRecordId: materializedGroupLabels,
          }
        : processedView.groups.length
        ? flattenSavedViewGroups(processedView.groups)
        : {
            records: processedView.records,
            labelsByRecordId: {},
          },
    [materializedGroupLabels, processedView, viewMaterialization?.mode],
  )
  const activeTable = tables?.find((table) => table._id === tableId)

  const runWrite = useCallback(
    async (work: () => Promise<unknown>, success?: string) => {
      if (!connectionHealth.canStartWrite) {
        toast.error(
          connectionHealth.kind === "offline"
            ? "You’re offline"
            : connectionHealth.kind === "failed"
              ? "Connection problem"
              : "Workspace is reconnecting",
          {
            description:
              connectionHealth.kind === "offline"
                ? "Reconnect before making another change."
                : connectionHealth.kind === "failed"
                  ? "Reload the page, then try again."
                  : "Wait for the live connection before trying again.",
          },
        )
        return false
      }
      setPendingWrites((count) => count + 1)
      try {
        await work()
        if (success) toast.success(success)
        return true
      } catch (error) {
        setGridEpoch((epoch) => epoch + 1)
        toast.error("Change was not saved", {
          description: publicErrorMessage(error),
        })
        return false
      } finally {
        setPendingWrites((count) => Math.max(0, count - 1))
      }
    },
    [connectionHealth.canStartWrite, connectionHealth.kind],
  )

  const runViewWrite = useCallback(
    async (
      work: (
        viewId: Id<"views">,
        expectedRevision: number,
      ) => Promise<{ revision: number }>,
      success?: string,
    ) => {
      if (!connectionHealth.canStartWrite) {
        toast.error(
          connectionHealth.kind === "offline"
            ? "You’re offline"
            : connectionHealth.kind === "failed"
              ? "Connection problem"
              : "Workspace is reconnecting",
          {
            description:
              connectionHealth.kind === "offline"
                ? "Reconnect before changing this view."
                : connectionHealth.kind === "failed"
                  ? "Reload the page, then try again."
                  : "Wait for the live connection before trying again.",
          },
        )
        return false
      }
      const viewId = activeViewIdRef.current
      if (!viewId) {
        toast.error("This view is still loading. Try again in a moment.")
        return false
      }
      setPendingWrites((count) => count + 1)
      try {
        const result = await work(
          viewId,
          activeViewRevisionRef.current,
        )
        activeViewRevisionRef.current = result.revision
        if (success) toast.success(success)
        return true
      } catch (error) {
        setGridEpoch((epoch) => epoch + 1)
        toast.error("View change was not saved", {
          description: publicErrorMessage(error),
        })
        return false
      } finally {
        setPendingWrites((count) => Math.max(0, count - 1))
      }
    },
    [connectionHealth.canStartWrite, connectionHealth.kind],
  )

  const runNamedViewWrite = useCallback(
    async (
      viewId: string,
      work: (
        view: Doc<"views">,
      ) => Promise<{ revision: number }>,
      success?: string,
    ) => {
      if (!connectionHealth.canStartWrite) {
        toast.error(
          connectionHealth.kind === "offline"
            ? "You’re offline"
            : connectionHealth.kind === "failed"
              ? "Connection problem"
              : "Workspace is reconnecting",
          {
            description:
              connectionHealth.kind === "offline"
                ? "Reconnect before changing this view."
                : connectionHealth.kind === "failed"
                  ? "Reload the page, then try again."
                  : "Wait for the live connection before trying again.",
          },
        )
        return false
      }
      const view = viewDocs?.find((candidate) => candidate._id === viewId)
      if (!view) {
        toast.error("That saved view is no longer available.")
        return false
      }
      setPendingWrites((count) => count + 1)
      try {
        const result = await work(view)
        if (activeViewIdRef.current === view._id) {
          activeViewRevisionRef.current = result.revision
        }
        if (success) toast.success(success)
        return true
      } catch (error) {
        setGridEpoch((epoch) => epoch + 1)
        toast.error("View change was not saved", {
          description: publicErrorMessage(error),
        })
        return false
      } finally {
        setPendingWrites((count) => Math.max(0, count - 1))
      }
    },
    [
      connectionHealth.canStartWrite,
      connectionHealth.kind,
      viewDocs,
    ],
  )

  const selectView = useCallback(
    (viewId: string) => {
      router.replace(
        viewSelectionHref({ pathname, searchParams, viewId }),
        { scroll: false },
      )
    },
    [pathname, router, searchParams],
  )

  const recordedViewIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const viewId = viewData?.view._id
    if (!viewId || recordedViewIdRef.current === viewId) return
    recordedViewIdRef.current = viewId
    void recordViewOpenedMutation({ viewId }).catch(() => {
      recordedViewIdRef.current = undefined
    })
  }, [recordViewOpenedMutation, viewData?.view._id])

  const setViewFavorite = useCallback(
    async (viewId: string, favorite: boolean) =>
      await runWrite(
        () =>
          setFavoriteViewMutation({
            viewId: viewId as Id<"views">,
            favorite,
          }),
        favorite ? "View added to favorites" : "View removed from favorites",
      ),
    [runWrite, setFavoriteViewMutation],
  )

  const addView = useCallback(
    async (name: string, options?: CreateViewOptions) => {
      if (!canManageSchema) {
        toast.error("Only organization admins can create shared views.")
        return false
      }
      if (!connectionHealth.canStartWrite) {
        toast.error(
          connectionHealth.kind === "offline"
            ? "You’re offline"
            : connectionHealth.kind === "failed"
              ? "Connection problem"
              : "Workspace is reconnecting",
          {
            description:
              connectionHealth.kind === "offline"
                ? "Reconnect before creating a view."
                : connectionHealth.kind === "failed"
                  ? "Reload the page, then try again."
                  : "Wait for the live connection before trying again.",
          },
        )
        return false
      }
      setPendingWrites((count) => count + 1)
      try {
        const type = options?.type ?? "grid"
        const result = await createView({
          tableId,
          name,
          type,
          visibility: "collaborators",
          configuration: {
            rowHeight: "medium",
            ...(options?.kanbanFieldId
              ? {
                  kanbanFieldId:
                    options.kanbanFieldId as Id<"fields">,
                }
              : {}),
            ...(options?.kanbanSummaryFieldIds
              ? {
                  kanbanSummaryFieldIds:
                    options.kanbanSummaryFieldIds as Id<"fields">[],
                }
              : {}),
            ...(options?.calendarDateFieldId
              ? {
                  calendarDateFieldId:
                    options.calendarDateFieldId as Id<"fields">,
                }
              : {}),
            ...(options?.calendarDisplay
              ? { calendarDisplay: options.calendarDisplay }
              : {}),
            ...(options?.galleryCoverFieldId
              ? {
                  galleryCoverFieldId:
                    options.galleryCoverFieldId as Id<"fields">,
                }
              : {}),
            ...(options?.gallerySummaryFieldIds
              ? {
                  gallerySummaryFieldIds:
                    options.gallerySummaryFieldIds as Id<"fields">[],
                }
              : {}),
          },
          afterViewId: viewDocs
            ?.filter((view) => view.status === "active")
            .at(-1)?._id,
        })
        toast.success(`${name} view created`)
        return result.viewId
      } catch (error) {
        toast.error("View could not be created", {
          description: publicErrorMessage(error),
        })
        return false
      } finally {
        setPendingWrites((count) => Math.max(0, count - 1))
      }
    },
    [
      canManageSchema,
      connectionHealth.canStartWrite,
      connectionHealth.kind,
      createView,
      tableId,
      viewDocs,
    ],
  )

  const saveViewControls = useCallback(
    async (nextValue: ViewControlsValue) => {
      if (!canManageSchema) {
        toast.error("Only organization admins can change shared views.")
        return false
      }
      return await runViewWrite((viewId, expectedRevision) =>
        updateView({
          viewId,
          expectedRevision,
          filterConjunction: nextValue.filterConjunction,
          filters: nextValue.filters.map((filter) => ({
            id: filter.id,
            fieldId: filter.fieldId as Id<"fields">,
            operator: filter.operator,
            ...(filter.value === undefined ? {} : { value: filter.value }),
          })),
          sorts: nextValue.sorts.map((sort) => ({
            id: sort.id,
            fieldId: sort.fieldId as Id<"fields">,
            direction: sort.direction,
            rank: sort.rank,
          })),
          groups: nextValue.groups.map((group) => ({
            id: group.id,
            fieldId: group.fieldId as Id<"fields">,
            direction: group.direction,
            rank: group.rank,
          })),
        }),
      )
    },
    [canManageSchema, runViewWrite, updateView],
  )

  const renameView = useCallback(
    async (viewId: string, name: string) => {
      if (
        !canManageSchema ||
        activeViewIdRef.current !== viewId ||
        !name.trim()
      ) {
        return false
      }
      return await runViewWrite(
        (activeViewId, expectedRevision) =>
          updateView({
            viewId: activeViewId,
            expectedRevision,
            name: name.trim(),
          }),
        "View renamed",
      )
    },
    [canManageSchema, runViewWrite, updateView],
  )

  const updateViewOptions = useCallback(
    async (
      viewId: string,
      name: string,
      options: CreateViewOptions,
    ) => {
      if (!canManageSchema) return false
      return await runNamedViewWrite(
        viewId,
        (view) =>
          updateView({
            viewId: view._id,
            expectedRevision: view.revision,
            name: name.trim(),
            type: options.type,
            configuration: {
              rowHeight: view.configuration.rowHeight ?? "medium",
              ...(options.kanbanFieldId
                ? {
                    kanbanFieldId:
                      options.kanbanFieldId as Id<"fields">,
                  }
                : {}),
              ...(options.kanbanSummaryFieldIds
                ? {
                    kanbanSummaryFieldIds:
                      options.kanbanSummaryFieldIds as Id<"fields">[],
                  }
                : {}),
              ...(options.calendarDateFieldId
                ? {
                    calendarDateFieldId:
                      options.calendarDateFieldId as Id<"fields">,
                  }
                : {}),
              ...(options.calendarDisplay
                ? { calendarDisplay: options.calendarDisplay }
                : {}),
              ...(options.galleryCoverFieldId
                ? {
                    galleryCoverFieldId:
                      options.galleryCoverFieldId as Id<"fields">,
                  }
                : {}),
              ...(options.gallerySummaryFieldIds
                ? {
                    gallerySummaryFieldIds:
                      options.gallerySummaryFieldIds as Id<"fields">[],
                  }
                : {}),
            },
          }),
        "View updated",
      )
    },
    [canManageSchema, runNamedViewWrite, updateView],
  )

  const updateCalendarDisplay = useCallback(
    (display: "month" | "agenda") => {
      const activeView = viewData?.view
      if (
        !canManageSchema ||
        !activeView ||
        activeView.type !== "calendar" ||
        activeView.configuration.calendarDisplay === display
      ) {
        return
      }
      void runViewWrite((viewId, expectedRevision) =>
        updateView({
          viewId,
          expectedRevision,
          configuration: {
            ...activeView.configuration,
            calendarDisplay: display,
          },
        }),
      )
    },
    [canManageSchema, runViewWrite, updateView, viewData?.view],
  )

  const makeViewDefault = useCallback(
    async (viewId: string) => {
      if (!canManageSchema || activeViewIdRef.current !== viewId) {
        return false
      }
      return await runViewWrite(
        (activeViewId, expectedRevision) =>
          setDefaultViewMutation({
            viewId: activeViewId,
            expectedRevision,
          }),
        "Default view updated",
      )
    },
    [canManageSchema, runViewWrite, setDefaultViewMutation],
  )

  const duplicateView = useCallback(
    async (viewId: string) => {
      if (!canManageSchema) return false
      if (!connectionHealth.canStartWrite) {
        toast.error(
          connectionHealth.kind === "offline"
            ? "You’re offline"
            : connectionHealth.kind === "failed"
              ? "Connection problem"
              : "Workspace is reconnecting",
          {
            description:
              connectionHealth.kind === "offline"
                ? "Reconnect before duplicating a view."
                : connectionHealth.kind === "failed"
                  ? "Reload the page, then try again."
                  : "Wait for the live connection before trying again.",
          },
        )
        return false
      }
      const source = viewDocs?.find((view) => view._id === viewId)
      if (!source || source.status !== "active") return false
      setPendingWrites((count) => count + 1)
      try {
        const result = await duplicateViewMutation({
          sourceViewId: source._id,
          expectedRevision: source.revision,
          name: `${source.name} copy`,
          afterViewId: source._id,
        })
        toast.success(`${source.name} duplicated`)
        return result.viewId
      } catch (error) {
        toast.error("View could not be duplicated", {
          description: publicErrorMessage(error),
        })
        return false
      } finally {
        setPendingWrites((count) => Math.max(0, count - 1))
      }
    },
    [
      canManageSchema,
      connectionHealth.canStartWrite,
      connectionHealth.kind,
      duplicateViewMutation,
      viewDocs,
    ],
  )

  const archiveView = useCallback(
    async (viewId: string) => {
      if (!canManageSchema) return false
      const archived = await runNamedViewWrite(
        viewId,
        (view) =>
          updateView({
            viewId: view._id,
            expectedRevision: view.revision,
            status: "archived",
          }),
        "View archived",
      )
      if (!archived) return false
      activeViewIdRef.current = undefined
      const params = new URLSearchParams(searchParams.toString())
      params.delete("view")
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      })
      return true
    },
    [
      canManageSchema,
      pathname,
      router,
      runNamedViewWrite,
      searchParams,
      updateView,
    ],
  )

  const restoreView = useCallback(
    async (viewId: string) => {
      if (!canManageSchema) return false
      return await runNamedViewWrite(
        viewId,
        (view) =>
          updateView({
            viewId: view._id,
            expectedRevision: view.revision,
            status: "active",
          }),
        "View restored",
      )
    },
    [canManageSchema, runNamedViewWrite, updateView],
  )

  const moveView = useCallback(
    async (viewId: string, direction: "up" | "down") => {
      if (!canManageSchema) return false
      const activeViews = (viewDocs ?? []).filter(
        (view) => view.status === "active",
      )
      const index = activeViews.findIndex((view) => view._id === viewId)
      const targetIndex = direction === "up" ? index - 1 : index + 1
      const target = activeViews[targetIndex]
      if (index < 0 || !target) return false
      return await runNamedViewWrite(
        viewId,
        (view) =>
          reorderViewMutation({
            viewId: view._id,
            expectedRevision: view.revision,
            ...(direction === "up"
              ? { beforeViewId: target._id }
              : { afterViewId: target._id }),
          }),
        "View order updated",
      )
    },
    [
      canManageSchema,
      reorderViewMutation,
      runNamedViewWrite,
      viewDocs,
    ],
  )

  const deleteView = useCallback(
    async (viewId: string) => {
      if (!canManageSchema || activeViewIdRef.current !== viewId) {
        return false
      }
      const deleted = await runViewWrite(
        (activeViewId, expectedRevision) =>
          removeViewMutation({
            viewId: activeViewId,
            expectedRevision,
          }),
        "View deleted",
      )
      if (!deleted) return false
      activeViewIdRef.current = undefined
      const params = new URLSearchParams(searchParams.toString())
      params.delete("view")
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      })
      return true
    },
    [
      canManageSchema,
      pathname,
      removeViewMutation,
      router,
      runViewWrite,
      searchParams,
    ],
  )

  const updateCell = useCallback(
    (
      recordId: string,
      fieldId: string,
      value: CellValue,
    ) => {
      const field = fields.find((candidate) => candidate.id === fieldId)
      if (!field) return
      if (field.type === "attachment") return
      if (field.type === "createdBy" || field.type === "createdTime") return
      const mutationValue = writableCellValue(value)
      if (mutationValue === undefined) {
        toast.error("This cell value cannot be saved.")
        return
      }

      void runWrite(() =>
        updateCellMutation({
          recordId: recordId as Id<"records">,
          fieldId: fieldId as Id<"fields">,
          value: mutationValue,
        }),
      )
    },
    [fields, runWrite, updateCellMutation],
  )

  const batchUpdateCells = useCallback(
    async (
      updates: GridCellBatchUpdate[],
    ): Promise<GridCellBatchResult | GridCellBatchFailure> => {
      setPendingWrites((count) => count + 1)
      try {
        const result = await batchUpdateCellsMutation({
          tableId,
          idempotencyKey: crypto.randomUUID(),
          operations: updates.map((update) => ({
            recordId: update.recordId as Id<"records">,
            fieldId: update.fieldId as Id<"fields">,
            value: update.value as
              | string
              | number
              | boolean
              | string[]
              | null,
            expectedRevision: update.expectedRevision,
          })),
        })
        return {
          revisions: result.revisions.map((revision) => ({
            recordId: revision.recordId,
            revision: revision.revision,
          })),
        }
      } catch (error) {
        return {
          saved: false,
          message: publicErrorMessage(error),
        }
      } finally {
        setPendingWrites((count) => Math.max(0, count - 1))
      }
    },
    [batchUpdateCellsMutation, tableId],
  )

  const addRecord = useCallback(() => {
    const primaryField = fields.find((field) => field.isPrimary)
    if (!primaryField) {
      toast.error("This table does not have its required column.")
      return
    }
    void runWrite(
      () =>
        createRecord({
          tableId,
          values: {
            [primaryField.id]: "",
          },
          afterRank: records.at(-1)?.rank,
        }),
      "Record added",
    )
  }, [createRecord, fields, records, runWrite, tableId])

  useEffect(() => {
    if (!newRecordRequested) {
      newRecordHandledRef.current = false
      return
    }
    if (newRecordHandledRef.current) return
    newRecordHandledRef.current = true
    addRecord()
    setNewRecordRequested(false)
  }, [addRecord, newRecordRequested, setNewRecordRequested])

  const duplicateRecords = useCallback(
    async (recordsToDuplicate: GridRecord[]) => {
      if (!recordsToDuplicate.length) return false
      const filesOmitted = recordsToDuplicate.some((record) =>
        allFields.some((field) => {
          const value = record.values[field.id]
          return (
            field.type === "attachment" &&
            Array.isArray(value) &&
            value.length > 0
          )
        }),
      )
      setPendingWrites((count) => count + 1)
      let duplicatedCount = 0
      let firstError: unknown
      try {
        for (const batch of chunkBulkRecords(recordsToDuplicate, 10)) {
          const results = await Promise.allSettled(
            batch.map((record) =>
              createRecord({
                tableId,
                values: duplicateRecordValues(record, allFields),
                afterRank: records.at(-1)?.rank,
              }),
            ),
          )
          for (const result of results) {
            if (result.status === "fulfilled") duplicatedCount += 1
            else firstError ??= result.reason
          }
        }

        const failedCount = recordsToDuplicate.length - duplicatedCount
        const attachmentNote = filesOmitted
          ? " Files stay with the original records."
          : ""
        if (!failedCount) {
          toast.success(
            duplicatedCount === 1
              ? "Record duplicated"
              : `${duplicatedCount.toLocaleString()} records duplicated`,
            {
              description: `Copies were added at the end of the table.${attachmentNote}`,
            },
          )
        } else if (duplicatedCount) {
          toast.warning(
            `${duplicatedCount.toLocaleString()} of ${recordsToDuplicate.length.toLocaleString()} records duplicated`,
            {
              description: `${failedCount.toLocaleString()} could not be copied. The originals are unchanged.${attachmentNote}`,
            },
          )
        } else {
          toast.error("Records could not be duplicated", {
            description: publicErrorMessage(
              firstError,
              "The originals are unchanged and remain selected so you can try again.",
            ),
          })
        }
        return duplicatedCount > 0
      } finally {
        setPendingWrites((count) => Math.max(0, count - 1))
      }
    },
    [allFields, createRecord, records, tableId],
  )

  const restoreDeletedRecords = useCallback(
    async (deletedRecords: GridRecord[]) => {
      setPendingWrites((count) => count + 1)
      try {
        const results = await Promise.allSettled(
          deletedRecords.map((record) =>
            restoreRecordMutation({
              recordId: record.id as Id<"records">,
            }),
          ),
        )
        const restoredCount = results.filter(
          (result) => result.status === "fulfilled",
        ).length
        if (restoredCount === deletedRecords.length) {
          toast.success(
            restoredCount === 1
              ? "Record restored"
              : `${restoredCount.toLocaleString()} records restored`,
          )
        } else {
          toast.error("Some records could not be restored", {
            description: `${restoredCount.toLocaleString()} of ${deletedRecords.length.toLocaleString()} records were restored.`,
          })
        }
      } finally {
        setPendingWrites((count) => Math.max(0, count - 1))
      }
    },
    [restoreRecordMutation],
  )

  const notifyDeletedRecords = useCallback(
    (
      deletedRecords: GridRecord[],
      requestedCount: number,
    ) => {
      const deletedCount = deletedRecords.length
      const partial = deletedCount !== requestedCount
      const title =
        deletedCount === 1
          ? "Record deleted"
          : `${deletedCount.toLocaleString()} records deleted`
      const options = {
        description: partial
          ? `${(requestedCount - deletedCount).toLocaleString()} records were kept and remain selected.`
          : "Removed for every collaborator.",
        duration: 12_000,
        action: {
          label: "Undo",
          onClick: () => void restoreDeletedRecords(deletedRecords),
        },
      }
      if (partial) toast.warning(title, options)
      else toast.success(title, options)
    },
    [restoreDeletedRecords],
  )

  const deleteRecords = useCallback(
    async (recordsToDelete: GridRecord[]) => {
      if (!recordsToDelete.length) return false
      setPendingWrites((count) => count + 1)
      const deletedRecords: GridRecord[] = []
      try {
        for (const batch of chunkBulkRecords(recordsToDelete)) {
          await bulkRemoveRecordsMutation({
            tableId,
            records: batch.map((record) => ({
              recordId: record.id as Id<"records">,
              expectedRevision: record.revision,
            })),
            idempotencyKey: crypto.randomUUID(),
          })
          deletedRecords.push(...batch)
        }
        notifyDeletedRecords(deletedRecords, recordsToDelete.length)
        return { deletedRecords }
      } catch (error) {
        if (deletedRecords.length) {
          notifyDeletedRecords(deletedRecords, recordsToDelete.length)
          return { deletedRecords }
        }
        toast.error("No records were deleted", {
          description: publicErrorMessage(
            error,
            "Nothing was removed. The records remain selected so you can try again.",
          ),
        })
        return false
      } finally {
        setPendingWrites((count) => Math.max(0, count - 1))
      }
    },
    [bulkRemoveRecordsMutation, notifyDeletedRecords, tableId],
  )

  const addField = useCallback(
    async (input: Pick<FieldDefinition, "name" | "type" | "config">) => {
      if (!canManageSchema) {
        toast.error("Only organization admins can change columns.")
        return false
      }
      return runWrite(
        () =>
          createField({
            tableId,
            name: input.name,
            type: input.type,
            config: fieldConfigForMutation(input.config),
            afterRank: fieldDocs?.at(-1)?.rank,
            width: input.type === "longText" ? 280 : 170,
          }),
        `${input.name} column added`,
      )
    },
    [canManageSchema, createField, fieldDocs, runWrite, tableId],
  )

  const deleteField = useCallback(
    (fieldId: string) => {
      if (!canManageSchema) {
        toast.error("Only organization admins can change columns.")
        return
      }
      const field = fields.find((candidate) => candidate.id === fieldId)
      if (!field || field.isPrimary) return
      setPendingDeletion({
        kind: "field",
        id: fieldId,
        label: field.name,
      })
    },
    [canManageSchema, fields],
  )

  const reorderField = useCallback(
    async (
      fieldId: string,
      targetIndex: number,
    ): Promise<boolean | GridFieldReorderFailure> => {
      if (!canManageSchema) {
        return {
          saved: false,
          message: "Only organization admins can change columns.",
        }
      }
      const index = fields.findIndex((field) => field.id === fieldId)
      const target = Math.max(1, targetIndex)
      if (
        index < 0 ||
        target < 1 ||
        target >= fields.length ||
        index === target ||
        fields[index]?.isPrimary
      ) {
        return {
          saved: false,
          message: "The column order changed. Try moving it again.",
        }
      }
      if (!connectionHealth.canStartWrite) {
        return {
          saved: false,
          message:
            connectionHealth.kind === "offline"
              ? "Reconnect before moving this column."
              : "Wait for the live connection, then try again.",
        }
      }
      const viewId = activeViewIdRef.current
      if (!viewId) {
        return {
          saved: false,
          message: "This view is still loading. Try again in a moment.",
        }
      }

      const reordered = moveItemToIndex(fields, index, target)
      const field = reordered[target]!
      const afterFieldId = reordered[target - 1]?.id
      const beforeFieldId = reordered[target + 1]?.id
      setPendingWrites((count) => count + 1)
      try {
        const result = await reorderViewField({
            viewId,
            fieldId: field.id as Id<"fields">,
            expectedRevision: activeViewRevisionRef.current,
            ...(afterFieldId
              ? { afterFieldId: afterFieldId as Id<"fields"> }
              : {}),
            ...(beforeFieldId
              ? { beforeFieldId: beforeFieldId as Id<"fields"> }
              : {}),
          })
        activeViewRevisionRef.current = result.revision
        toast.success("Column order updated")
        return true
      } catch (error) {
        return {
          saved: false,
          message: publicErrorMessage(error),
        }
      } finally {
        setPendingWrites((count) => Math.max(0, count - 1))
      }
    },
    [
      canManageSchema,
      connectionHealth.canStartWrite,
      connectionHealth.kind,
      fields,
      reorderViewField,
    ],
  )

  const resizeField = useCallback(
    (fieldId: string, width: number) => {
      if (!canManageSchema) {
        toast.error("Only organization admins can resize columns.")
        return
      }
      void runViewWrite(
        (viewId, expectedRevision) =>
          updateViewFieldConfig({
            viewId,
            fieldId: fieldId as Id<"fields">,
            expectedRevision,
            width,
          }),
        "Column width updated",
      )
    },
    [canManageSchema, runViewWrite, updateViewFieldConfig],
  )

  const freezeField = useCallback(
    (fieldId: string, frozen: boolean) => {
      if (!canManageSchema) {
        toast.error("Only organization admins can freeze columns.")
        return
      }
      const field = allFields.find((candidate) => candidate.id === fieldId)
      if (!field || field.isPrimary) return
      void runViewWrite(
        (viewId, expectedRevision) =>
          updateViewFieldConfig({
            viewId,
            fieldId: field.id as Id<"fields">,
            expectedRevision,
            frozen,
          }),
        frozen
          ? `${field.name} frozen`
          : `${field.name} unfrozen`,
      )
    },
    [
      allFields,
      canManageSchema,
      runViewWrite,
      updateViewFieldConfig,
    ],
  )

  const updateRowHeight = useCallback(
    (rowHeight: "compact" | "medium" | "tall") => {
      const activeView = viewData?.view
      if (!canManageSchema || !activeView) return
      void runViewWrite(
        (viewId, expectedRevision) =>
          updateView({
            viewId,
            expectedRevision,
            configuration: {
              ...activeView.configuration,
              rowHeight,
            },
          }),
        "Row height updated",
      )
    },
    [canManageSchema, runViewWrite, updateView, viewData?.view],
  )

  const updatePresenceLocation = useCallback(
    (
      location:
        | {
            fieldId: string
            recordId: string
          }
        | undefined,
    ) => {
      if (!presenceReady) return
      void updatePresenceLocationMutation({
        tableId,
        ...(location
          ? {
              fieldId: location.fieldId as Id<"fields">,
              recordId: location.recordId as Id<"records">,
            }
          : {}),
      }).catch(() => {
        // Presence is intentionally best-effort and never blocks table edits.
      })
    },
    [
      presenceReady,
      tableId,
      updatePresenceLocationMutation,
    ],
  )

  const moveRecord = useCallback(
    (recordId: string, direction: "up" | "down") => {
      if (recordsQuery.status !== "Exhausted") {
        toast.info("Load all records before changing their order.")
        return
      }
      const index = records.findIndex((record) => record.id === recordId)
      const target = direction === "up" ? index - 1 : index + 1
      if (index < 0 || target < 0 || target >= records.length) return

      const reordered = [...records]
      const [record] = reordered.splice(index, 1)
      reordered.splice(target, 0, record)
      const rank = generateKeyBetween(
        reordered[target - 1]?.rank ?? null,
        reordered[target + 1]?.rank ?? null,
        { jitterBits: 48 },
      )
      void runWrite(
        () =>
          moveRecordMutation({
            recordId: record.id as Id<"records">,
            rank,
          }),
        "Record order updated",
      )
    },
    [moveRecordMutation, records, recordsQuery.status, runWrite],
  )

  const openFieldManager = useCallback((fieldId?: string) => {
    setFieldDrafts(
      Object.fromEntries(
        allFields.map((field) => [
          field.id,
          {
            name: field.name,
            type: field.type,
            config: {
              ...field.config,
              options: field.config.options?.map((option) => ({ ...option })),
            },
          },
        ]),
      ),
    )
    setFieldVisibilityDrafts(
      Object.fromEntries(
        allFields.map((field) => [
          field.id,
          field.isPrimary ||
            !viewFieldConfigById.get(field.id)?.hidden,
        ]),
      ),
    )
    setFocusedFieldId(fieldId)
    setFieldManagerOpen(true)
  }, [allFields, viewFieldConfigById])

  const renameField = useCallback(
    async (fieldId: string, requestedName: string) => {
      if (!canManageSchema) {
        return {
          saved: false as const,
          message: "Only organization admins can rename columns.",
        }
      }
      if (!connectionHealth.canStartWrite) {
        return {
          saved: false as const,
          message:
            connectionHealth.kind === "offline"
              ? "Reconnect before renaming this column."
              : "Wait for the live connection, then try again.",
        }
      }
      const name = requestedName.trim()
      const normalizedName = name.normalize("NFKC").toLocaleLowerCase()
      if (
        allFields.some(
          (field) =>
            field.id !== fieldId &&
            field.name.trim().normalize("NFKC").toLocaleLowerCase() ===
              normalizedName,
        )
      ) {
        return {
          saved: false as const,
          message:
            "A column with this name already exists. Choose a different name.",
        }
      }

      setPendingWrites((count) => count + 1)
      try {
        await updateField({
          fieldId: fieldId as Id<"fields">,
          name,
        })
        setFieldDrafts((current) => {
          const draft = current[fieldId]
          return draft
            ? { ...current, [fieldId]: { ...draft, name } }
            : current
        })
        return true
      } catch (error) {
        return {
          saved: false as const,
          message: publicErrorMessage(error),
        }
      } finally {
        setPendingWrites((count) => Math.max(0, count - 1))
      }
    },
    [
      allFields,
      canManageSchema,
      connectionHealth.canStartWrite,
      connectionHealth.kind,
      updateField,
    ],
  )

  const duplicateField = useCallback(
    (fieldId: string) => {
      if (!canManageSchema) {
        toast.error("Only organization admins can create columns.")
        return
      }
      const field = allFields.find((candidate) => candidate.id === fieldId)
      const fieldDoc = fieldDocs?.find(
        (candidate) => candidate._id === fieldId,
      )
      if (!field || !fieldDoc) return
      const name = `${field.name} copy`.slice(0, 120)
      void runWrite(
        () =>
          createField({
            tableId,
            name,
            type: field.type,
            config: fieldConfigForMutation(field.config),
            width: field.width,
            afterRank: fieldDoc.rank,
          }),
        `${name} created`,
      )
    },
    [
      allFields,
      canManageSchema,
      createField,
      fieldDocs,
      runWrite,
      tableId,
    ],
  )

  const hideField = useCallback(
    (fieldId: string) => {
      const field = allFields.find((candidate) => candidate.id === fieldId)
      if (!canManageSchema || !field || field.isPrimary) return
      void runViewWrite(
        (viewId, expectedRevision) =>
          updateViewFieldConfig({
            viewId,
            fieldId: field.id as Id<"fields">,
            expectedRevision,
            hidden: true,
          }),
        `${field.name} hidden in this view`,
      )
    },
    [
      allFields,
      canManageSchema,
      runViewWrite,
      updateViewFieldConfig,
    ],
  )

  function updateFieldDraft(
    fieldId: string,
    update: (draft: FieldDraft) => FieldDraft,
  ) {
    setFieldDrafts((current) => {
      const draft = current[fieldId]
      if (!draft) return current
      return { ...current, [fieldId]: update(draft) }
    })
  }

  function updateFieldConfig(
    fieldId: string,
    update: (config: FieldConfig) => FieldConfig,
  ) {
    updateFieldDraft(fieldId, (draft) => ({
      ...draft,
      config: update(draft.config),
    }))
  }

  function addSelectOption(fieldId: string) {
    updateFieldConfig(fieldId, (config) => {
      const options = config.options ?? []
      const optionNumber = options.length + 1
      return {
        ...config,
        options: [
          ...options,
          {
            id: `option_${crypto.randomUUID()}`,
            label: `Option ${optionNumber}`,
            color: SELECT_OPTION_COLORS[options.length % SELECT_OPTION_COLORS.length]!,
          },
        ],
      }
    })
  }

  function moveSelectOption(
    fieldId: string,
    optionIndex: number,
    direction: "up" | "down",
  ) {
    updateFieldConfig(fieldId, (config) => {
      const options = [...(config.options ?? [])]
      const targetIndex = direction === "up" ? optionIndex - 1 : optionIndex + 1
      if (
        optionIndex < 0 ||
        targetIndex < 0 ||
        targetIndex >= options.length
      ) {
        return config
      }
      const [option] = options.splice(optionIndex, 1)
      options.splice(targetIndex, 0, option)
      return { ...config, options }
    })
  }

  function beginFieldTypeConversion(
    field: FieldDefinition,
    targetType: ConvertibleFieldType,
  ) {
    if (!canManageSchema || targetType === field.type) return
    const draft = fieldDrafts[field.id]
    const source = {
      ...field,
      config: draft?.config ?? field.config,
    }
    setConversionAcknowledged(false)
    setPendingFieldConversion({
      fieldId: field.id,
      columnName: draft?.name.trim() || field.name,
      targetType,
      targetConfig: conversionConfigForTarget(source, targetType),
    })
  }

  async function applyFieldTypeConversion() {
    const pending = pendingFieldConversion
    const preview = fieldConversionPreview
    const job = activeConversionJob
    if (job?.status === "ready") {
      const requiresExactAcknowledgement =
        job.counts.cleared > 0 ||
        job.counts.losingSomeInformation > 0
      if (
        conversionApplying ||
        (requiresExactAcknowledgement && !conversionAcknowledged)
      ) {
        return
      }
      setConversionApplying(true)
      setPendingWrites((count) => count + 1)
      try {
        await beginTypeConversionApply({
          jobId: job.jobId as Id<"fieldConversionJobs">,
          acknowledgeDataLoss: conversionAcknowledged,
        })
      } catch (error) {
        toast.error("Column update could not continue", {
          description: publicErrorMessage(error),
        })
      } finally {
        setConversionApplying(false)
        setPendingWrites((count) => Math.max(0, count - 1))
      }
      return
    }
    if (
      !pending ||
      !preview ||
      !preview.canApply ||
      job !== null ||
      conversionApplying ||
      (preview.requiresDataLossAcknowledgement &&
        !conversionAcknowledged)
    ) {
      return
    }

    setConversionApplying(true)
    setConversionStepError(undefined)
    setPendingWrites((count) => count + 1)
    try {
      await startTypeConversionJob({
        fieldId: pending.fieldId as Id<"fields">,
        newType: pending.targetType,
        newConfig: fieldConfigForMutation(pending.targetConfig),
        expectedFieldRevision: preview.expectedFieldRevision,
        previewVersion: preview.previewVersion,
        acknowledgeDataLoss: conversionAcknowledged,
      })
    } catch (error) {
      toast.error("Column change could not start", {
        description: publicErrorMessage(error),
      })
    } finally {
      setConversionApplying(false)
      setPendingWrites((count) => Math.max(0, count - 1))
    }
  }

  async function retryFieldTypeConversion() {
    const job = activeConversionJob
    if (!job || conversionApplying) return
    setConversionApplying(true)
    setPendingWrites((count) => count + 1)
    try {
      if (job.status === "failed") {
        await retryTypeConversionJob({
          jobId: job.jobId as Id<"fieldConversionJobs">,
        })
      }
      setConversionStepError(undefined)
    } catch (error) {
      setConversionStepError(publicErrorMessage(error))
    } finally {
      setConversionApplying(false)
      setPendingWrites((count) => Math.max(0, count - 1))
    }
  }

  async function cancelFieldTypeConversion() {
    const job = activeConversionJob
    if (
      !job ||
      job.phase === "applying" ||
      job.status === "cancelling" ||
      conversionApplying
    ) {
      return
    }
    setConversionApplying(true)
    setPendingWrites((count) => count + 1)
    try {
      await requestTypeConversionCancel({
        jobId: job.jobId as Id<"fieldConversionJobs">,
      })
      setConversionStepError(undefined)
    } catch (error) {
      toast.error("Column change could not be cancelled", {
        description: publicErrorMessage(error),
      })
    } finally {
      setConversionApplying(false)
      setPendingWrites((count) => Math.max(0, count - 1))
    }
  }

  async function saveFieldSettings() {
    if (!canManageSchema) return
    const invalidField = allFields.find((field) => {
      const draft = fieldDrafts[field.id]
      return draft && fieldConfigIssue(draft.type, draft.config)
    })
    if (invalidField) {
      const draft = fieldDrafts[invalidField.id]!
      toast.error(`Review ${draft.name.trim() || invalidField.name}`, {
        description:
          fieldConfigIssue(draft.type, draft.config) ??
          "Check this column’s validation settings.",
      })
      return
    }
    const schemaUpdates = allFields.filter(
      (field) => {
        const draft = fieldDrafts[field.id]
        if (!draft) return false
        return (
          draft.name.trim() !== field.name ||
          (draft.type === field.type &&
            JSON.stringify(draft.config) !== JSON.stringify(field.config))
        )
      },
    )
    const visibilityUpdates = allFields.filter((field) => {
      if (field.isPrimary) return false
      const shown =
        fieldVisibilityDrafts[field.id] ??
        !viewFieldConfigById.get(field.id)?.hidden
      return shown === Boolean(viewFieldConfigById.get(field.id)?.hidden)
    })
    if (!schemaUpdates.length && !visibilityUpdates.length) {
      setFieldManagerOpen(false)
      return
    }
    if (schemaUpdates.length) {
      const saved = await runWrite(
        () =>
          Promise.all(
            schemaUpdates.map((field) => {
              const draft = fieldDrafts[field.id]!
              const fieldDoc = fieldDocs?.find(
                (candidate) => candidate._id === field.id,
              )
              const nameChanged = draft.name.trim() !== field.name
              const configChanged =
                draft.type === field.type &&
                JSON.stringify(draft.config) !== JSON.stringify(field.config)
              const activeOptionIds = new Set(
                draft.config.options?.map((option) => option.id) ?? [],
              )
              const archivedOptions =
                fieldDoc?.config.options
                  ?.filter(
                    (option) =>
                      option.archived || !activeOptionIds.has(option.id),
                  )
                  .map((option) => ({
                    id: option.id,
                    label: option.label,
                    color: option.color,
                    rank: option.rank,
                  })) ?? []
              const config = configChanged
                ? {
                    ...fieldDoc?.config,
                    ...fieldConfigForMutation(
                      draft.config,
                      archivedOptions,
                    ),
                  }
                : undefined
              return updateField({
                fieldId: field.id as Id<"fields">,
                ...(nameChanged ? { name: draft.name.trim() } : {}),
                ...(config ? { config } : {}),
              })
            }),
          ),
        "Column settings updated",
      )
      if (!saved) return
    }

    for (const field of visibilityUpdates) {
      const shown = fieldVisibilityDrafts[field.id] ?? true
      const saved = await runViewWrite(
        (viewId, expectedRevision) =>
          updateViewFieldConfig({
            viewId,
            fieldId: field.id as Id<"fields">,
            expectedRevision,
            hidden: !shown,
          }),
      )
      if (!saved) return
    }
    if (visibilityUpdates.length) {
      toast.success("View columns updated")
    }
    setFieldManagerOpen(false)
  }

  async function confirmPendingDeletion() {
    if (!pendingDeletion || deleting) return
    if (pendingDeletion.kind === "field" && !canManageSchema) {
      toast.error("Only organization admins can change columns.")
      setPendingDeletion(null)
      return
    }

    setDeleting(true)
    try {
      const archiveSuccess =
        pendingDeletion.kind === "field"
          ? fieldArchiveSuccessMessage(
              pendingDeletion.label,
              archiveImpact?.dependencies ?? [],
            )
          : "Attachment removed"
      const saved =
        pendingDeletion.kind === "field"
          ? await runWrite(
              () =>
                archiveFieldMutation({
                  fieldId: pendingDeletion.id as Id<"fields">,
                }),
              archiveSuccess,
            )
          : await runWrite(
              () =>
                removeAttachment({
                  attachmentId: pendingDeletion.id as Id<"attachments">,
                }),
              archiveSuccess,
            )
      if (saved) setPendingDeletion(null)
    } finally {
      setDeleting(false)
    }
  }

  async function restoreArchivedColumn(
    fieldId: Id<"fields">,
    name: string,
  ) {
    if (restoringFieldId || !canManageSchema) return
    setRestoringFieldId(fieldId)
    try {
      await runWrite(
        () => restoreFieldMutation({ fieldId }),
        `${name} restored`,
      )
    } finally {
      setRestoringFieldId(undefined)
    }
  }

  const uploadAttachments = useCallback(
    async (recordId: string, fieldId: string, files: File[]) => {
      setPendingWrites((count) => count + 1)
      try {
        const field = allFields.find(
          (candidate) => candidate.id === fieldId,
        )
        if (!field || field.type !== "attachment") {
          throw new Error("The selected file column is unavailable.")
        }
        for (const file of files) {
          const kindError = attachmentKindErrorMessage(
            file,
            field.config.attachmentKind,
          )
          if (kindError) throw new Error(kindError)
          if (file.size > MAX_FILE_BYTES) {
            throw new Error(`${file.name} is larger than 25 MB.`)
          }
          const session = await createUploadSession({
            recordId: recordId as Id<"records">,
            fieldId: fieldId as Id<"fields">,
          })
          const response = await fetch(session.uploadUrl, {
            method: "POST",
            headers: {
              "Content-Type": file.type || "application/octet-stream",
            },
            body: file,
          })
          if (!response.ok) {
            throw new Error(`Upload failed with status ${response.status}.`)
          }
          const payload: unknown = await response.json()
          const storageId =
            typeof payload === "object" &&
            payload !== null &&
            "storageId" in payload &&
            typeof payload.storageId === "string"
              ? payload.storageId
              : null
          if (!storageId) {
            throw new Error("The upload could not be prepared.")
          }
          const finalized = await finalizeUploadSession({
            uploadSessionId: session.uploadSessionId,
            storageId: storageId as Id<"_storage">,
            fileName: file.name,
          })
          if (!finalized.ok) {
            throw new Error(
              finalized.error ?? "Upload could not be finalized.",
            )
          }
        }
        toast.success(
          files.length === 1
            ? `${files[0]?.name ?? "Attachment"} uploaded`
            : `${files.length} attachments uploaded`,
        )
      } finally {
        setPendingWrites((count) => Math.max(0, count - 1))
      }
    },
    [allFields, createUploadSession, finalizeUploadSession],
  )

  async function submitTable() {
    const name = tableName.trim()
    if (!name || creatingTable || !canManageSchema) return
    setCreatingTable(true)
    try {
      const result = await createTable({
        baseId,
        name,
        afterRank: tables?.at(-1)?.rank,
      })
      toast.success(`${name} table created`)
      setTableName("")
      setTableDialogOpen(false)
      window.location.assign(`/bases/${baseId}/tables/${result.tableId}`)
    } catch (error) {
      toast.error("Could not create the table", {
        description: publicErrorMessage(error),
      })
    } finally {
      setCreatingTable(false)
    }
  }

  async function submitAttachment() {
    if (
      !uploadRecordId ||
      !uploadFieldId ||
      !uploadFile ||
      uploading
    ) {
      return
    }
    if (uploadFile.size > MAX_FILE_BYTES) {
      toast.error("Files must be 25 MB or smaller.")
      return
    }
    const attachmentField = allFields.find(
      (field) => field.id === uploadFieldId && field.type === "attachment",
    )
    const kindError = attachmentKindErrorMessage(
      uploadFile,
      attachmentField?.config.attachmentKind,
    )
    if (kindError) {
      toast.error(kindError)
      return
    }

    setUploading(true)
    try {
      await uploadAttachments(uploadRecordId, uploadFieldId, [uploadFile])
      setUploadOpen(false)
      setUploadFile(undefined)
      setUploadRecordId("")
      setUploadFieldId("")
    } catch (error) {
      toast.error("Attachment was not saved", {
        description: publicErrorMessage(
          error,
          "We could not upload this file. Your other changes are safe—please try again.",
        ),
      })
    } finally {
      setUploading(false)
    }
  }

  if (
    base === undefined ||
    tables === undefined ||
    fieldDocs === undefined ||
    viewDocs === undefined ||
    viewData === undefined
  ) {
    return <ConnectedLoading label="Loading live table data…" />
  }

  if (!activeTable) {
    return (
      <main className="grid min-h-dvh place-items-center bg-muted/20 px-5">
        <div className="max-w-md text-center">
          <Table2 className="mx-auto size-8 text-muted-foreground" />
          <h1 className="mt-4 text-xl font-semibold">Table unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This table is not part of the selected base or is no longer active.
          </p>
          <Button
            className="mt-6"
            render={<Link href={`/bases/${baseId}`} />}
            variant="outline"
          >
            Return to base
          </Button>
        </div>
      </main>
    )
  }

  const attachmentFields = allFields.filter(
    (field) => field.type === "attachment",
  )
  const viewOptions: WorkspaceViewOption[] = viewDocs
    .filter(
      (
        view,
      ): view is Doc<"views"> & {
        status: "active" | "archived"
      } => view.status === "active" || view.status === "archived",
    )
    .map((view) => {
      const preference = viewPreferences?.find(
        (candidate) => candidate.viewId === view._id,
      )
      return {
        calendarDisplay: view.configuration.calendarDisplay,
        gallerySummaryFieldIds:
          view.configuration.gallerySummaryFieldIds,
        id: view._id,
        isDefault: view.isDefault,
        isFavorite: preference?.isFavorite ?? false,
        lastOpenedAt: preference?.lastOpenedAt,
        layoutFieldId:
          view.type === "kanban"
            ? view.configuration.kanbanFieldId
            : view.type === "calendar"
              ? view.configuration.calendarDateFieldId
              : view.type === "gallery"
                ? view.configuration.galleryCoverFieldId
                : undefined,
        name: view.name,
        status: view.status,
        type: view.type,
        kanbanSummaryFieldIds:
          view.configuration.kanbanSummaryFieldIds,
      }
    })
  const activeViewType = viewData?.view.type ?? "grid"
  const viewControl = (
    <div className="flex min-w-0 items-center gap-1">
      <div
        aria-label="View layouts"
        className="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5"
        role="tablist"
      >
        {VIEW_TYPE_TABS.map((option) => {
          const Icon = option.icon
          const active = activeViewType === option.type
          return (
            <Button
              aria-label={`${option.label} view`}
              aria-selected={active}
              className="h-7 gap-1.5 rounded-[5px] px-2 text-[11px]"
              key={option.type}
              onClick={() => {
                const matching = viewOptions
                  .filter(
                    (view) =>
                      view.status === "active" &&
                      view.type === option.type,
                  )
                  .toSorted(
                    (left, right) =>
                      Number(right.isFavorite) -
                        Number(left.isFavorite) ||
                      Number(right.isDefault) -
                        Number(left.isDefault) ||
                      (right.lastOpenedAt ?? 0) -
                        (left.lastOpenedAt ?? 0),
                  )[0]
                if (matching) {
                  selectView(matching.id)
                  return
                }
                setRequestedViewType(option.type)
                setNewViewOpen(true)
              }}
              role="tab"
              size="sm"
              title={
                viewOptions.some(
                  (view) =>
                    view.status === "active" &&
                    view.type === option.type,
                )
                  ? `Open ${option.label.toLocaleLowerCase()} view`
                  : `Create ${option.label.toLocaleLowerCase()} view`
              }
              variant={active ? "secondary" : "ghost"}
            >
              <Icon className="size-3.5" />
              <span className="hidden min-[760px]:inline">
                {option.label}
              </span>
            </Button>
          )
        })}
      </div>
      <div className="mx-0.5 h-5 w-px shrink-0 bg-border" />
      <ViewSwitcher
        activeViewId={viewData?.view._id}
        canManage={canManageSchema}
        createOpen={newViewOpen}
        fields={allFields}
        initialCreateType={requestedViewType}
        key={`view-switcher:${requestedViewType}`}
        onArchive={archiveView}
        onCreate={addView}
        onCreateOpenChange={setNewViewOpen}
        onDelete={deleteView}
        onDuplicate={duplicateView}
        onMove={moveView}
        onRename={renameView}
        onRestore={restoreView}
        onSelect={selectView}
        onSetFavorite={setViewFavorite}
        onSetDefault={makeViewDefault}
        onUpdateOptions={updateViewOptions}
        views={viewOptions}
      />
      <ViewControls
        disabled={!canManageSchema || pendingWrites > 0}
        fields={allFields}
        onChange={saveViewControls}
        value={viewControlsValue}
      />
    </div>
  )
  const kanbanField = allFields.find(
    (field) =>
      field.id === viewData?.view.configuration.kanbanFieldId &&
      field.type === "singleSelect",
  )
  const calendarField = allFields.find(
    (field) =>
      field.id === viewData?.view.configuration.calendarDateFieldId &&
      field.type === "date",
  )
  const galleryCoverField = allFields.find(
    (field) =>
      field.id === viewData?.view.configuration.galleryCoverFieldId &&
      field.type === "attachment",
  )
  const primaryFieldId = allFields.find((field) => field.isPrimary)?.id
  const resolveCardSummaryFields = (
    configuredFieldIds: readonly string[] | undefined,
    excludedFieldIds: readonly (string | undefined)[],
    legacyLimit: number,
  ) => {
    const excluded = new Set(
      [primaryFieldId, ...excludedFieldIds].filter(
        (fieldId): fieldId is string => Boolean(fieldId),
      ),
    )
    if (configuredFieldIds === undefined) {
      return fields
        .filter((field) => !excluded.has(field.id))
        .slice(0, legacyLimit)
    }
    return configuredFieldIds
      .map((fieldId) =>
        allFields.find(
          (field) => field.id === fieldId && !excluded.has(field.id),
        ),
      )
      .filter((field) => field !== undefined)
  }
  const kanbanSummaryFields = resolveCardSummaryFields(
    viewData?.view.configuration.kanbanSummaryFieldIds,
    [kanbanField?.id],
    2,
  )
  const gallerySummaryFields = resolveCardSummaryFields(
    viewData?.view.configuration.gallerySummaryFieldIds,
    [galleryCoverField?.id],
    3,
  )
  const selectedAttachmentValue = records.find(
    (record) => record.id === uploadRecordId,
  )?.values[uploadFieldId]
  const selectedAttachments = Array.isArray(selectedAttachmentValue)
    ? selectedAttachmentValue.filter(
        (value): value is AttachmentValue =>
          typeof value === "object" && value !== null && "id" in value,
      )
    : []

  return (
    <main className="workspace-shell-offset flex h-dvh min-h-[620px] overflow-hidden bg-background">
      <section className="flex min-w-0 flex-1 flex-col">
        <ConnectedTopBar />
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
          <div className="min-w-0">
            <FormBreadcrumbs
              items={[
                {
                  href: `/bases/${baseId}`,
                  label: base.name,
                },
                {
                  href: pathname,
                  label: activeTable.name,
                },
                {
                  label: viewData?.view.name ?? "Grid view",
                },
              ]}
            />
            <p className="truncate text-sm font-semibold">{activeTable.name}</p>
          </div>
          <ConnectedTablePresence
            className="ml-2 hidden sm:flex"
            onPresenceChange={setCollaborators}
            onReadyChange={setPresenceReady}
            tableId={tableId}
          />
          <div
            className="hidden items-center gap-1.5 text-[11px] text-muted-foreground xl:flex"
            role="status"
          >
            <span
              className={`size-1.5 rounded-full ${
                connectionHealth.kind === "offline" ||
                connectionHealth.kind === "failed"
                  ? "bg-destructive"
                  : connectionHealth.kind === "live"
                    ? "bg-emerald-500"
                    : "bg-amber-500"
              }`}
            />
            {connectionHealth.label}
          </div>
          <Button
            className="ml-auto hidden sm:inline-flex"
            onClick={() => setRecordOrderOpen(true)}
            size="sm"
            variant="ghost"
          >
            <ArrowUpDown />
            Order
          </Button>
          {canManageSchema ? (
            <Button
              onClick={() => openFieldManager()}
              size="sm"
              variant="ghost"
            >
              <Columns3 />
              <span className="hidden md:inline">Columns</span>
            </Button>
          ) : null}
          <Button
            disabled={!attachmentFields.length || !records.length}
            onClick={() => {
              setUploadRecordId(records[0]?.id ?? "")
              setUploadFieldId(attachmentFields[0]?.id ?? "")
              setUploadFile(undefined)
              setUploadOpen(true)
            }}
            size="sm"
            variant="ghost"
          >
            <UploadCloud />
            <span className="hidden md:inline">Upload</span>
          </Button>
        </header>

        {!viewData?.view ||
        viewMaterialization === undefined ||
        recordsPreparing ||
        recordsQuery.status === "LoadingFirstPage" ? (
          <ConnectedLoading
            label={
              recordsPreparing
                ? (viewMaterialization?.message ??
                  "Preparing this saved view…")
                : "Loading records…"
            }
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <ComponentErrorBoundary
              description="Try this view again. If the problem continues, choose another saved view."
              resetKey={`${tableId}:${viewData?.view._id ?? "loading"}:${gridEpoch}`}
              title="This view could not open"
            >
            {activeViewType === "grid" ? (
              <DataGrid
                key={gridEpoch}
                canManageSchema={canManageSchema}
                connectionHealth={connectionHealth}
                fields={fields}
                exportName={activeTable.name}
                onAddField={addField}
                onAddRecord={addRecord}
                onBatchUpdateCells={batchUpdateCells}
                onDeleteField={deleteField}
                onDeleteRecords={deleteRecords}
                onDuplicateField={
                  canManageSchema ? duplicateField : undefined
                }
                onDuplicateRecords={duplicateRecords}
                onHideField={canManageSchema ? hideField : undefined}
                onManageField={
                  canManageSchema ? openFieldManager : undefined
                }
                onManageFields={
                  canManageSchema ? () => openFieldManager() : undefined
                }
                onActiveCellChange={updatePresenceLocation}
                onFreezeField={
                  canManageSchema ? freezeField : undefined
                }
                onReorderField={reorderField}
                onRenameField={canManageSchema ? renameField : undefined}
                onResizeField={resizeField}
                onRowHeightChange={
                  canManageSchema ? updateRowHeight : undefined
                }
                onUpdateCell={updateCell}
                onUploadAttachments={uploadAttachments}
                collaborators={collaborators}
                presenceReady={presenceReady}
                recordGroupCounts={materializedGroupCounts}
                recordGroupLabels={groupedView.labelsByRecordId}
                records={groupedView.records}
                rowHeight={
                  viewData.view.configuration.rowHeight ?? "medium"
                }
                syncing={pendingWrites > 0}
                totalRecordCount={
                  viewMaterialization?.mode === "ready"
                    ? (viewMaterialization.matchedCount ?? undefined)
                    : tableRecordTotal
                }
                viewControl={viewControl}
              />
            ) : (
              <>
                <div className="flex h-10 shrink-0 items-center overflow-x-auto border-b px-2">
                  {viewControl}
                  <span className="ml-auto pr-2 text-xs capitalize text-muted-foreground">
                    {activeViewType} layout
                  </span>
                </div>
                {activeViewType === "kanban" && kanbanField ? (
                  <KanbanView
                    fields={fields}
                    groupField={kanbanField}
                    onUpdateCell={updateCell}
                    onUploadAttachments={uploadAttachments}
                    records={groupedView.records}
                    summaryFields={kanbanSummaryFields}
                  />
                ) : activeViewType === "calendar" && calendarField ? (
                  <CalendarView
                    dateField={calendarField}
                    fields={fields}
                    initialDisplay={
                      viewData?.view.configuration.calendarDisplay ?? "month"
                    }
                    key={`${viewData?.view._id ?? "calendar"}:${viewData?.view.configuration.calendarDisplay ?? "month"}`}
                    onDisplayChange={
                      canManageSchema ? updateCalendarDisplay : undefined
                    }
                    onUpdateCell={updateCell}
                    onUploadAttachments={uploadAttachments}
                    records={groupedView.records}
                  />
                ) : activeViewType === "gallery" ? (
                  <GalleryView
                    coverField={galleryCoverField}
                    fields={fields}
                    onUpdateCell={updateCell}
                    onUploadAttachments={uploadAttachments}
                    records={groupedView.records}
                    summaryFields={gallerySummaryFields}
                  />
                ) : (
                  <div className="grid min-h-0 flex-1 place-items-center bg-muted/20 p-6">
                    <div className="max-w-md rounded-xl border bg-background p-6 text-center shadow-sm">
                      <h2 className="font-semibold">
                        Choose an available column
                      </h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        This layout&apos;s column is no longer available.
                        Restore that column or create a new view and choose
                        another one by name.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
            </ComponentErrorBoundary>
            <RecordsPageFooter
              layout={activeViewType}
              onLoadMore={(count) => recordsQuery.loadMore(count)}
              status={recordsQuery.status}
            />
          </div>
        )}
      </section>

      <FloatingAssistantLauncher
        canUseAi={canUseAi}
        onClick={() => setAssistantOpen(true)}
        open={assistantOpen}
      />

      <UrlRecordDrawer
        fields={allFields}
        onUpdateCell={(recordId, fieldId, value) =>
          updateCell(recordId, fieldId, value)
        }
        onUploadAttachments={uploadAttachments}
        records={records}
      />

      <ConnectedAssistantSheet
        canUseAi={canUseAi}
        context={{
          base: { id: baseId, name: base.name },
          table: { id: tableId, name: activeTable.name },
        }}
        onOpenChange={setAssistantOpen}
        open={assistantOpen}
        title="Basecraft AI"
      />

      <Dialog open={tableDialogOpen} onOpenChange={setTableDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a table</DialogTitle>
            <DialogDescription>
              The new table starts with a required Name column.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="workspace-table-name">Table name</Label>
            <Input
              autoFocus
              id="workspace-table-name"
              onChange={(event) => setTableName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitTable()
              }}
              placeholder="e.g. Feedback"
              value={tableName}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => setTableDialogOpen(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={!tableName.trim() || creatingTable}
              onClick={() => void submitTable()}
            >
              {creatingTable ? "Creating…" : "Create table"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={recordOrderOpen} onOpenChange={setRecordOrderOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Reorder records</DialogTitle>
            <DialogDescription>
              Move records into the order your team should see. Changes appear
              for collaborators automatically.
            </DialogDescription>
          </DialogHeader>
          {recordsQuery.status !== "Exhausted" ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-100">
              Load all remaining records before changing their order.
            </div>
          ) : null}
          <div className="max-h-[420px] space-y-1 overflow-y-auto py-2">
            {records.map((record, index) => (
              <div
                className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2"
                key={record.id}
              >
                <span className="w-7 text-xs tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {recordLabel(record.values[fields.find((field) => field.isPrimary)?.id ?? ""])}
                </span>
                <Button
                  aria-label={`Move record ${index + 1} up`}
                  disabled={
                    recordsQuery.status !== "Exhausted" ||
                    index === 0 ||
                    pendingWrites > 0
                  }
                  onClick={() => moveRecord(record.id, "up")}
                  size="icon-xs"
                  variant="ghost"
                >
                  <ArrowUp />
                </Button>
                <Button
                  aria-label={`Move record ${index + 1} down`}
                  disabled={
                    recordsQuery.status !== "Exhausted" ||
                    index === records.length - 1 ||
                    pendingWrites > 0
                  }
                  onClick={() => moveRecord(record.id, "down")}
                  size="icon-xs"
                  variant="ghost"
                >
                  <ArrowDown />
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setRecordOrderOpen(false)} variant="outline">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open)
          if (!open) setUploadFile(undefined)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload an attachment</DialogTitle>
            <DialogDescription>
              Choose a record, select where the file belongs, then upload it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="attachment-record">Record</Label>
              <SearchableSelect
                id="attachment-record"
                onValueChange={setUploadRecordId}
                options={records.map((record, index) => ({
                  value: record.id,
                  label: `${index + 1}. ${recordLabel(
                    record.values[
                      fields.find((field) => field.isPrimary)?.id ?? ""
                    ],
                  )}`,
                }))}
                placeholder="Choose a record"
                searchPlaceholder="Search records…"
                value={uploadRecordId}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="attachment-field">Save in column</Label>
              <SearchableSelect
                id="attachment-field"
                onValueChange={(fieldId) => {
                  setUploadFieldId(fieldId)
                  setUploadFile(undefined)
                }}
                options={attachmentFields.map((field) => ({
                  value: field.id,
                  label: field.name,
                }))}
                placeholder="Choose a file column"
                searchPlaceholder="Search columns…"
                value={uploadFieldId}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="attachment-file">File</Label>
              <Input
                accept={attachmentAccept(
                  attachmentFields.find((field) => field.id === uploadFieldId)
                    ?.config.attachmentKind,
                )}
                id="attachment-file"
                key={uploadFieldId}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  if (!file) {
                    setUploadFile(undefined)
                    return
                  }
                  const field = attachmentFields.find(
                    (candidate) => candidate.id === uploadFieldId,
                  )
                  const kindError = attachmentKindErrorMessage(
                    file,
                    field?.config.attachmentKind,
                  )
                  if (kindError) {
                    toast.error(kindError)
                    setUploadFile(undefined)
                    event.currentTarget.value = ""
                    return
                  }
                  if (file.size > MAX_FILE_BYTES) {
                    toast.error(`${file.name} is larger than 25 MB.`)
                    setUploadFile(undefined)
                    event.currentTarget.value = ""
                    return
                  }
                  setUploadFile(file)
                }}
                type="file"
              />
              <p className="text-xs text-muted-foreground">
                Maximum 25 MB. Up to 10 attachments can be stored in a cell.
              </p>
            </div>
            {selectedAttachments.length ? (
              <div className="grid gap-2">
                <Label>Current attachments</Label>
                <div className="space-y-1 rounded-xl border p-2">
                  {selectedAttachments.map((attachment) => (
                    <div
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs"
                      key={attachment.id}
                    >
                      {attachment.mimeType.startsWith("image/") &&
                      attachment.url ? (
                        <span
                          aria-label={`${attachment.name} thumbnail`}
                          className="size-8 shrink-0 rounded-md bg-cover bg-center"
                          role="img"
                          style={{
                            backgroundImage: `url("${attachment.url}")`,
                          }}
                        />
                      ) : (
                        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted">
                          <FileText className="size-3.5 text-muted-foreground" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        {attachment.url ? (
                          <a
                            className="block truncate font-medium hover:underline"
                            href={attachment.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {attachment.name}
                          </a>
                        ) : (
                          <span className="block truncate font-medium">
                            {attachment.name}
                          </span>
                        )}
                        {attachment.size > 0 ? (
                          <span className="block text-[10px] text-muted-foreground">
                            {formatFileSize(attachment.size)}
                          </span>
                        ) : null}
                      </span>
                      <Button
                        aria-label={`Remove ${attachment.name}`}
                        disabled={pendingWrites > 0}
                        onClick={() =>
                          setPendingDeletion({
                            kind: "attachment",
                            id: attachment.id,
                            label: attachment.name,
                          })
                        }
                        size="icon-xs"
                        variant="ghost"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button onClick={() => setUploadOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={
                !uploadRecordId ||
                !uploadFieldId ||
                !uploadFile ||
                uploading
              }
              onClick={() => void submitAttachment()}
            >
              {uploading ? "Uploading…" : "Upload file"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={fieldManagerOpen}
        onOpenChange={(open) => {
          setFieldManagerOpen(open)
          if (!open) setFocusedFieldId(undefined)
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-max(1rem,env(safe-area-inset-top))-max(1rem,env(safe-area-inset-bottom)))] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-h-[90dvh] sm:max-w-2xl">
          <DialogHeader className="min-w-0 pr-8">
            <DialogTitle>Edit columns</DialogTitle>
            <DialogDescription>
              Rename columns and tune the settings that control editing,
              validation, and file uploads.
            </DialogDescription>
          </DialogHeader>
          <div className="-mr-1 min-h-0 min-w-0 space-y-3 overflow-x-hidden overflow-y-auto overscroll-contain py-2 pr-2 [scrollbar-gutter:stable]">
            {allFields.length > 1 ? (
              <div className="sticky top-0 z-10 grid gap-1.5 rounded-xl border bg-background p-3 shadow-sm">
                <Label htmlFor="column-editor-picker">Choose a column</Label>
                <SearchableSelect
                  id="column-editor-picker"
                  onValueChange={(fieldId) =>
                    setFocusedFieldId(fieldId || undefined)
                  }
                  options={[
                    {
                      value: "",
                      label: "Show all columns",
                    },
                    ...allFields.map((field) => ({
                      value: field.id,
                      label: `${field.name} · ${getFieldTypeLabel(field.type)}`,
                    })),
                  ]}
                  placeholder="Show all columns"
                  searchPlaceholder="Search columns…"
                  value={focusedFieldId ?? ""}
                />
              </div>
            ) : null}
            {allFields
              .filter(
                (field) =>
                  !focusedFieldId || field.id === focusedFieldId,
              )
              .map((field) => {
              const draft = fieldDrafts[field.id] ?? {
                name: field.name,
                type: field.type,
                config: field.config,
              }
              const options = draft.config.options ?? []
              return (
                <section
                  className="min-w-0 overflow-hidden rounded-xl border bg-muted/15 p-3.5"
                  key={field.id}
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold">
                        {getFieldTypeLabel(draft.type)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {field.isPrimary
                          ? "Required column · always shown"
                          : "Active column"}
                      </p>
                    </div>
                    <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {field.isPrimary
                          ? "Always shown"
                          : "Show in this view"}
                      </span>
                      <Switch
                        aria-label={`Show ${field.name} in this view`}
                        checked={
                          field.isPrimary ||
                          (fieldVisibilityDrafts[field.id] ?? true)
                        }
                        disabled={field.isPrimary}
                        onCheckedChange={(shown) =>
                          setFieldVisibilityDrafts((current) => ({
                            ...current,
                            [field.id]: shown,
                          }))
                        }
                        size="sm"
                      />
                    </label>
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor={`field-name-${field.id}`}>
                      Column name
                    </Label>
                    <Input
                      id={`field-name-${field.id}`}
                      maxLength={120}
                      onChange={(event) =>
                        updateFieldDraft(field.id, (current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      value={draft.name}
                    />
                  </div>

                  <div className="mt-4 grid gap-1.5">
                    <Label htmlFor={`field-type-${field.id}`}>
                      Column type
                    </Label>
                    <select
                      aria-label={`Column type for ${field.name}`}
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={
                        !isConvertibleFieldType(field.type) ||
                        conversionBusy
                      }
                      id={`field-type-${field.id}`}
                      onChange={(event) => {
                        const targetType = event.target
                          .value as ConvertibleFieldType
                        if (targetType !== field.type) {
                          beginFieldTypeConversion(field, targetType)
                        }
                      }}
                      value={field.type}
                    >
                      {isConvertibleFieldType(field.type) ? (
                        CONVERTIBLE_FIELD_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {getFieldTypeLabel(type)}
                          </option>
                        ))
                      ) : (
                        <option value={field.type}>
                          {getFieldTypeLabel(field.type)}
                        </option>
                      )}
                    </select>
                    {!isConvertibleFieldType(field.type) ? (
                      <p className="text-[11px] leading-5 text-muted-foreground">
                        {field.type === "attachment"
                          ? "File columns keep their upload settings and cannot be converted."
                          : "This column is filled automatically and its type cannot be changed."}
                      </p>
                    ) : (
                      <p className="text-[11px] leading-5 text-muted-foreground">
                        Choosing another type opens a value-by-value preview
                        before anything changes.
                      </p>
                    )}
                  </div>

                  <div className="mt-4">
                    <FieldValidationInputs
                      config={draft.config}
                      idPrefix={`field-validation-${field.id}`}
                      onChange={(config) =>
                        updateFieldDraft(field.id, (current) => ({
                          ...current,
                          config,
                        }))
                      }
                      type={draft.type}
                    />
                  </div>

                  {draft.type === "singleSelect" ||
                  draft.type === "multiSelect" ? (
                    <div className="mt-4 grid gap-2">
                      <div className="flex items-center justify-between gap-3">
                        <Label>Select options</Label>
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {options.length}/250
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {options.map((option, optionIndex) => (
                          <div
                            className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)_repeat(3,1.5rem)] items-center gap-1.5"
                            key={option.id}
                          >
                            <input
                              aria-label={`Color for ${option.label}`}
                              className="size-8 shrink-0 cursor-pointer rounded-md border bg-background p-1"
                              onChange={(event) =>
                                updateFieldConfig(field.id, (config) => ({
                                  ...config,
                                  options: (config.options ?? []).map(
                                    (candidate) =>
                                      candidate.id === option.id
                                        ? {
                                            ...candidate,
                                            color: event.target.value,
                                          }
                                        : candidate,
                                  ),
                                }))
                              }
                              type="color"
                              value={option.color}
                            />
                            <Input
                              aria-label={`Option ${optionIndex + 1} label`}
                              className="h-8 min-w-0"
                              maxLength={120}
                              onChange={(event) =>
                                updateFieldConfig(field.id, (config) => ({
                                  ...config,
                                  options: (config.options ?? []).map(
                                    (candidate) =>
                                      candidate.id === option.id
                                        ? {
                                            ...candidate,
                                            label: event.target.value,
                                          }
                                        : candidate,
                                  ),
                                }))
                              }
                              value={option.label}
                            />
                            <Button
                              aria-label={`Move ${option.label} up`}
                              disabled={optionIndex === 0}
                              onClick={() =>
                                moveSelectOption(
                                  field.id,
                                  optionIndex,
                                  "up",
                                )
                              }
                              size="icon-xs"
                              type="button"
                              variant="ghost"
                            >
                              <ArrowUp />
                            </Button>
                            <Button
                              aria-label={`Move ${option.label} down`}
                              disabled={optionIndex === options.length - 1}
                              onClick={() =>
                                moveSelectOption(
                                  field.id,
                                  optionIndex,
                                  "down",
                                )
                              }
                              size="icon-xs"
                              type="button"
                              variant="ghost"
                            >
                              <ArrowDown />
                            </Button>
                            <Button
                              aria-label={`Remove ${option.label}`}
                              onClick={() =>
                                updateFieldConfig(field.id, (config) => ({
                                  ...config,
                                  options: (config.options ?? []).filter(
                                    (candidate) =>
                                      candidate.id !== option.id,
                                  ),
                                }))
                              }
                              size="icon-xs"
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
                        disabled={options.length >= 250}
                        onClick={() => addSelectOption(field.id)}
                        size="xs"
                        type="button"
                        variant="outline"
                      >
                        <Plus />
                        Add option
                      </Button>
                    </div>
                  ) : null}

                  {draft.type === "number" ||
                  draft.type === "currency" ||
                  draft.type === "percent" ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label htmlFor={`field-precision-${field.id}`}>
                          Decimal places
                        </Label>
                        <Input
                          id={`field-precision-${field.id}`}
                          max={12}
                          min={0}
                          onChange={(event) => {
                            const next = event.target.value
                            updateFieldConfig(field.id, (config) => ({
                              ...config,
                              precision: next
                                ? Math.max(
                                    0,
                                    Math.min(12, Math.trunc(Number(next))),
                                  )
                                : undefined,
                            }))
                          }}
                          type="number"
                          value={draft.config.precision ?? 2}
                        />
                      </div>
                      {draft.type === "currency" ? (
                        <div className="grid gap-1.5">
                          <Label htmlFor={`field-currency-${field.id}`}>
                            Currency
                          </Label>
                          <CurrencySelect
                            id={`field-currency-${field.id}`}
                            onValueChange={(currency) =>
                              updateFieldConfig(field.id, (config) => ({
                                ...config,
                                currency,
                              }))
                            }
                            value={draft.config.currency ?? "USD"}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {draft.type === "rating" ? (
                    <div className="mt-4 flex items-center gap-3 rounded-xl border bg-muted/25 p-3">
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
                        <p className="text-xs font-medium">
                          One to five stars
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Ratings are always saved as whole numbers.
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {draft.type === "date" ? (
                    <div className="mt-4 grid gap-1.5">
                      <Label htmlFor={`field-date-style-${field.id}`}>
                        Date input
                      </Label>
                      <select
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                        id={`field-date-style-${field.id}`}
                        onChange={(event) =>
                          updateFieldConfig(field.id, (config) => ({
                            ...config,
                            dateStyle: event.target.value as
                              | "date"
                              | "dateTime",
                          }))
                        }
                        value={draft.config.dateStyle ?? "date"}
                      >
                        <option value="date">Date only</option>
                        <option value="dateTime">Date and time</option>
                      </select>
                    </div>
                  ) : null}

                  {draft.type === "attachment" ? (
                    <div className="mt-4 grid gap-1.5">
                      <Label htmlFor={`field-attachment-kind-${field.id}`}>
                        Accepted files
                      </Label>
                      <select
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                        id={`field-attachment-kind-${field.id}`}
                        onChange={(event) =>
                          updateFieldConfig(field.id, (config) => ({
                            ...config,
                            attachmentKind: event.target.value as
                              | "image"
                              | "file"
                              | "any",
                          }))
                        }
                        value={draft.config.attachmentKind ?? "any"}
                      >
                        <option value="any">Images and files</option>
                        <option value="image">Images only</option>
                        <option value="file">Non-image files only</option>
                      </select>
                    </div>
                  ) : null}
                </section>
              )
            })}
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              onClick={() => {
                setFieldManagerOpen(false)
                setArchivedColumnsOpen(true)
              }}
              variant="ghost"
            >
              <Archive />
              Archived columns
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                onClick={() => setFieldManagerOpen(false)}
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={
                  pendingWrites > 0 ||
                  allFields.some(
                    (field) =>
                      !(fieldDrafts[field.id]?.name ?? field.name).trim() ||
                      Boolean(
                        fieldConfigIssue(
                          fieldDrafts[field.id]?.type ?? field.type,
                          fieldDrafts[field.id]?.config ?? field.config,
                        ),
                      ) ||
                      (fieldDrafts[field.id]?.type === "singleSelect" ||
                      fieldDrafts[field.id]?.type === "multiSelect"
                        ? (
                            fieldDrafts[field.id]?.config.options ??
                            field.config.options ??
                            []
                          ).some((option) => !option.label.trim())
                        : false),
                  )
                }
                onClick={() => void saveFieldSettings()}
              >
                Save column settings
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pendingFieldConversion ? (
        <FieldConversionDialog
          acknowledged={conversionAcknowledged}
          applying={conversionBusy}
          columnName={pendingFieldConversion.columnName}
          configIssue={conversionConfigIssue}
          job={displayedConversionJob}
          onAcknowledgedChange={setConversionAcknowledged}
          onApply={() => void applyFieldTypeConversion()}
          onCancel={() => void cancelFieldTypeConversion()}
          onOpenChange={(open) => {
            if (open || conversionBusy || activeConversionJob) return
            setPendingFieldConversion(undefined)
            setConversionAcknowledged(false)
          }}
          onRetry={() => void retryFieldTypeConversion()}
          onTargetConfigChange={(targetConfig) =>
            setPendingFieldConversion((current) =>
              current ? { ...current, targetConfig } : current,
            )
          }
          open
          preview={fieldConversionPreview}
          targetConfig={pendingFieldConversion.targetConfig}
          targetType={pendingFieldConversion.targetType}
        />
      ) : null}

      <Dialog
        open={archivedColumnsOpen}
        onOpenChange={setArchivedColumnsOpen}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Archived columns</DialogTitle>
            <DialogDescription>
              Restore a column with its saved values and view settings.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto py-2">
            {archivedColumns === undefined ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Loading archived columns…
              </div>
            ) : archivedColumns.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center">
                <p className="text-sm font-medium">
                  No archived columns
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Columns you archive will appear here.
                </p>
              </div>
            ) : (
              archivedColumns.map((column) => (
                <div
                  className="flex items-center gap-3 rounded-xl border p-3"
                  key={column.fieldId}
                >
                  <Archive className="size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {column.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Archived{" "}
                      {new Date(column.archivedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    disabled={Boolean(restoringFieldId)}
                    onClick={() =>
                      void restoreArchivedColumn(
                        column.fieldId,
                        column.name,
                      )
                    }
                    size="sm"
                    variant="outline"
                  >
                    {restoringFieldId === column.fieldId ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <ArchiveRestore />
                    )}
                    Restore
                  </Button>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={() => setArchivedColumnsOpen(false)}
              variant="outline"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(pendingDeletion)}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDeletion(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDeletion?.kind === "field"
                ? "Archive this column?"
                : "Remove this attachment?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeletion?.kind === "field"
                ? fieldArchiveDescription(pendingDeletion.label)
                : `“${pendingDeletion?.label ?? "This file"}” will be removed from the record. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingDeletion?.kind === "field" ? (
            <FieldArchiveImpact impact={archiveImpact} />
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {pendingDeletion?.kind === "field"
                ? "Keep column"
                : "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                deleting ||
                (pendingDeletion?.kind === "field" &&
                  (!archiveImpact || !archiveImpact.canArchive))
              }
              onClick={() => void confirmPendingDeletion()}
              variant={
                pendingDeletion?.kind === "attachment"
                  ? "destructive"
                  : "default"
              }
            >
              {deleting
                ? "Removing…"
                : pendingDeletion?.kind === "attachment"
                  ? "Remove attachment"
                  : "Archive column"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

function recordLabel(value: CellValue | undefined) {
  if (typeof value === "string" && value.trim()) return value
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return "Untitled record"
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function writableCellValue(
  value: CellValue,
): string | number | boolean | string[] | null | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }
  if (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  ) {
    return value
  }
  return undefined
}
