"use client"

import { generateKeyBetween } from "jittered-fractional-indexing"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { ViewControlsValue } from "@/components/workspace/view-controls"

import type {
  CellValue,
  DashboardWidgetConfig,
  FieldConfig,
  FieldDefinition,
  FieldType,
  GridRecord,
  ViewType,
} from "@/lib/domain"

export interface WorkspaceTableDto {
  id: string
  baseId: string
  name: string
  description: string
  rank: string
  createdAt: number
  updatedAt: number
}

export interface WorkspaceViewDto {
  id: string
  tableId: string
  name: string
  type: ViewType
  isDefault: boolean
  visibility: string
  rank: string
  filterConjunction: "and" | "or"
  filters: ViewControlsValue["filters"]
  sorts: ViewControlsValue["sorts"]
  groups: ViewControlsValue["groups"]
  configuration: Record<string, unknown>
}


interface SavedViewRecordGroupDto {
  fieldName: string
  label: string
  records: GridRecord[]
  children: SavedViewRecordGroupDto[]
}

export interface TableBundleDto {
  table: WorkspaceTableDto
  fields: FieldDefinition[]
  views: WorkspaceViewDto[]
  viewFieldConfigs: Array<{
    id: string
    viewId: string
    fieldId: string
    hidden: boolean
    frozen: boolean
    width: number | null
  }>
}

export interface RecordQueryResponse {
  records: GridRecord[]
  totalCount: number
  groupLabelsByRecordId: Record<string, string>
  groups: SavedViewRecordGroupDto[]
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }

  get isRevisionConflict(): boolean {
    return this.status === 409 && this.code === "REVISION_CONFLICT"
  }
}

async function requestJson<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  })
  const payload = (await response.json().catch(() => null)) as
    | (T & { code?: string; message?: string })
    | null
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.code ?? "REQUEST_FAILED",
      payload?.message ?? "The request could not be completed.",
    )
  }
  if (!payload) {
    throw new ApiError(response.status, "EMPTY_RESPONSE", "The server returned no data.")
  }
  return payload
}

function flattenGroupCounts(
  groups: readonly SavedViewRecordGroupDto[],
): Record<string, number> {
  const counts: Record<string, number> = {}
  const visit = (nodes: readonly SavedViewRecordGroupDto[]) => {
    for (const node of nodes) {
      if (node.children.length) {
        visit(node.children)
        continue
      }
      counts[node.label] = (counts[node.label] ?? 0) + node.records.length
    }
  }
  visit(groups)
  return counts
}

export function viewControlsOf(view?: WorkspaceViewDto): ViewControlsValue {
  return {
    filterConjunction: view?.filterConjunction ?? "and",
    filters: view?.filters ?? [],
    sorts: view?.sorts ?? [],
    groups: view?.groups ?? [],
  }
}

export type AttachmentUploadTarget = {
  recordId: string
  fieldId: string
}

/**
 * Owns every read and write for one table workspace. The server is the source
 * of truth for view configuration; cell writes are the only optimistic path
 * because they are the interaction that must feel instant.
 */
export function useTableData(tableId: string) {
  const [bundle, setBundle] = useState<TableBundleDto>()
  const [activeViewId, setActiveViewId] = useState<string>()
  const [records, setRecords] = useState<GridRecord[]>([])
  const [totalRecordCount, setTotalRecordCount] = useState(0)
  const [groupLabels, setGroupLabels] = useState<Record<string, string>>({})
  const [groupCounts, setGroupCounts] = useState<Record<string, number>>({})
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [syncing, setSyncing] = useState(false)

  const activeView = useMemo(
    () => bundle?.views.find((view) => view.id === activeViewId),
    [activeViewId, bundle?.views],
  )
  const controls = useMemo(() => viewControlsOf(activeView), [activeView])

  const queryKeyRef = useRef(0)

  const runQuery = useCallback(
    async (
      view: WorkspaceViewDto | undefined,
      searchTerm: string,
    ) => {
      const key = ++queryKeyRef.current
      const body: Record<string, unknown> = {
        filterConjunction: view?.filterConjunction ?? "and",
        filters: view?.filters ?? [],
        sorts: view?.sorts ?? [],
        groups: view?.groups ?? [],
      }
      if (searchTerm.trim()) body.search = searchTerm.trim()
      const result = await requestJson<RecordQueryResponse>(
        `/api/tables/${encodeURIComponent(tableId)}/records/query`,
        { method: "POST", body: JSON.stringify(body) },
      )
      if (key !== queryKeyRef.current) return
      setRecords(result.records)
      setTotalRecordCount(result.totalCount)
      setGroupLabels(result.groupLabelsByRecordId ?? {})
      setGroupCounts(flattenGroupCounts(result.groups ?? []))
    },
    [tableId],
  )

  const loadBundle = useCallback(
    async (viewId?: string) => {
      const next = await requestJson<TableBundleDto>(
        `/api/tables/${encodeURIComponent(tableId)}`,
      )
      setBundle(next)
      const fallback =
        next.views.find((view) => view.isDefault) ?? next.views[0]
      const resolved =
        (viewId && next.views.some((view) => view.id === viewId)
          ? viewId
          : undefined) ?? fallback?.id
      setActiveViewId(resolved)
      return {
        bundle: next,
        view: next.views.find((view) => view.id === resolved),
      }
    },
    [tableId],
  )

  const refresh = useCallback(
    async (viewId?: string) => {
      try {
        const loaded = await loadBundle(viewId)
        await runQuery(loaded.view, search)
        setError(undefined)
      } catch (refreshError) {
        setError(
          refreshError instanceof Error
            ? refreshError.message
            : "Could not load this table.",
        )
      }
    },
    [loadBundle, runQuery, search],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setBundle(undefined)
    setActiveViewId(undefined)
    setRecords([])
    setSearch("")
    ;(async () => {
      try {
        const loaded = await loadBundle()
        if (cancelled) return
        await runQuery(loaded.view, "")
        if (cancelled) return
        setError(undefined)
      } catch (loadError) {
        if (cancelled) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load this table.",
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // Re-running on tableId only: view and search changes go through explicit
    // actions so a re-render never refetches the workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId])

  const selectView = useCallback(
    async (viewId: string) => {
      const view = bundle?.views.find((candidate) => candidate.id === viewId)
      if (!view) return
      setActiveViewId(viewId)
      setSyncing(true)
      try {
        await runQuery(view, search)
      } catch (queryError) {
        setError(
          queryError instanceof Error ? queryError.message : "Could not load this view.",
        )
      } finally {
        setSyncing(false)
      }
    },
    [bundle?.views, runQuery, search],
  )

  const applySearch = useCallback(
    async (value: string) => {
      setSearch(value)
      setSyncing(true)
      try {
        await runQuery(activeView, value)
      } catch (queryError) {
        setError(
          queryError instanceof Error ? queryError.message : "Search failed.",
        )
      } finally {
        setSyncing(false)
      }
    },
    [activeView, runQuery],
  )

  const refreshRecords = useCallback(async () => {
    await runQuery(activeView, search)
  }, [activeView, runQuery, search])

  const persistView = useCallback(
    async (viewId: string, patch: Record<string, unknown>) => {
      const { view } = await requestJson<{ view: WorkspaceViewDto }>(
        `/api/views/${encodeURIComponent(viewId)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      )
      setBundle((current) =>
        current
          ? {
              ...current,
              views: current.views.map((candidate) =>
                candidate.id === view.id ? view : candidate,
              ),
            }
          : current,
      )
      return view
    },
    [],
  )

  const updateControls = useCallback(
    async (next: ViewControlsValue) => {
      if (!activeView) return false
      setSyncing(true)
      try {
        const view = await persistView(activeView.id, {
          filterConjunction: next.filterConjunction,
          filters: next.filters,
          sorts: next.sorts,
          groups: next.groups,
        })
        await runQuery(view, search)
        return true
      } catch (controlError) {
        setError(
          controlError instanceof Error
            ? controlError.message
            : "Could not save this view.",
        )
        return false
      } finally {
        setSyncing(false)
      }
    },
    [activeView, persistView, runQuery, search],
  )

  const applyView = useCallback(
    async (view: WorkspaceViewDto) => {
      setActiveViewId(view.id)
      setSyncing(true)
      try {
        await runQuery(view, search)
      } finally {
        setSyncing(false)
      }
    },
    [runQuery, search],
  )

  const createView = useCallback(
    async (type: ViewType) => {
      const label = type.charAt(0).toUpperCase() + type.slice(1)
      const { view } = await requestJson<{ view: WorkspaceViewDto }>("/api/views", {
        method: "POST",
        body: JSON.stringify({ tableId, type, name: `${label} view` }),
      })
      setBundle((current) =>
        current ? { ...current, views: [...current.views, view] } : current,
      )
      await applyView(view)
    },
    [applyView, tableId],
  )

  const renameView = useCallback(
    async (viewId: string, name: string) => {
      await persistView(viewId, { name })
    },
    [persistView],
  )

  const deleteView = useCallback(
    async (viewId: string) => {
      await requestJson(`/api/views/${encodeURIComponent(viewId)}`, {
        method: "DELETE",
      })
      const remaining = (bundle?.views ?? []).filter((view) => view.id !== viewId)
      setBundle((current) =>
        current ? { ...current, views: remaining } : current,
      )
      const next = remaining[0]
      if (next) {
        await applyView(next)
      } else {
        setActiveViewId(undefined)
        setRecords([])
      }
    },
    [applyView, bundle?.views],
  )

  const updateViewConfiguration = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!activeView) return
      setSyncing(true)
      try {
        const view = await persistView(activeView.id, {
          configuration: { ...activeView.configuration, ...patch },
        })
        setBundle((current) =>
          current
            ? {
                ...current,
                views: current.views.map((candidate) =>
                  candidate.id === view.id
                    ? { ...view, configuration: view.configuration }
                    : candidate,
                ),
              }
            : current,
        )
      } finally {
        setSyncing(false)
      }
    },
    [activeView, persistView],
  )

  /* ---------------------------------------------------------------------- */
  /* Record mutations                                                       */
  /* ---------------------------------------------------------------------- */

  const applyRevisions = useCallback(
    (revisions: Array<{ recordId: string; revision: number }>) => {
      const byId = new Map(revisions.map((item) => [item.recordId, item.revision]))
      setRecords((current) =>
        current.map((record) =>
          byId.has(record.id)
            ? { ...record, revision: byId.get(record.id)! }
            : record,
        ),
      )
    },
    [],
  )

  const updateCell = useCallback(
    (recordId: string, fieldId: string, value: CellValue, expectedRevision: number) => {
      setRecords((current) =>
        current.map((record) =>
          record.id === recordId
            ? { ...record, values: { ...record.values, [fieldId]: value } }
            : record,
        ),
      )
      setSyncing(true)
      void (async () => {
        try {
          const result = await requestJson<{
            revisions: Record<string, number>
          }>(`/api/tables/${encodeURIComponent(tableId)}/records/batch`, {
            method: "PATCH",
            body: JSON.stringify({
              updates: [{ recordId, fieldId, value, expectedRevision }],
            }),
          })
          applyRevisions(
            Object.entries(result.revisions ?? {}).map(([id, revision]) => ({
              recordId: id,
              revision,
            })),
          )
        } catch (writeError) {
          if (writeError instanceof ApiError && writeError.isRevisionConflict) {
            setError("Someone else changed this record. Reloading the latest values.")
          } else {
            setError(
              writeError instanceof Error ? writeError.message : "Could not save this cell.",
            )
          }
          await refreshRecords().catch(() => undefined)
        } finally {
          setSyncing(false)
        }
      })()
    },
    [applyRevisions, refreshRecords, tableId],
  )

  const batchUpdateCells = useCallback(
    async (updates: Array<{
      recordId: string
      fieldId: string
      value: CellValue
      expectedRevision: number
    }>) => {
      setSyncing(true)
      try {
        const result = await requestJson<{ revisions: Record<string, number> }>(
          `/api/tables/${encodeURIComponent(tableId)}/records/batch`,
          { method: "PATCH", body: JSON.stringify({ updates }) },
        )
        const revisions = Object.entries(result.revisions ?? {}).map(
          ([recordId, revision]) => ({ recordId, revision }),
        )
        applyRevisions(revisions)
        return { revisions }
      } catch (writeError) {
        const message =
          writeError instanceof Error ? writeError.message : "Could not save changes."
        if (writeError instanceof ApiError && writeError.isRevisionConflict) {
          await refreshRecords().catch(() => undefined)
        }
        return { saved: false as const, message }
      } finally {
        setSyncing(false)
      }
    },
    [applyRevisions, refreshRecords, tableId],
  )

  const addRecord = useCallback(
    async (initialValues: Record<string, CellValue> = {}) => {
      setSyncing(true)
      try {
        await requestJson(`/api/tables/${encodeURIComponent(tableId)}/records`, {
          method: "POST",
          body: JSON.stringify({ values: initialValues }),
        })
        await refreshRecords()
        return true
      } catch (createError) {
        setError(
          createError instanceof Error ? createError.message : "Could not add a record.",
        )
        return false
      } finally {
        setSyncing(false)
      }
    },
    [refreshRecords, tableId],
  )

  const deleteRecords = useCallback(
    async (recordsToDelete: readonly GridRecord[]) => {
      if (!recordsToDelete.length) return false
      setSyncing(true)
      try {
        await requestJson(`/api/tables/${encodeURIComponent(tableId)}/records`, {
          method: "DELETE",
          body: JSON.stringify({
            recordIds: recordsToDelete.map((record) => record.id),
          }),
        })
        await refreshRecords()
        return true
      } catch (deleteError) {
        setError(
          deleteError instanceof Error ? deleteError.message : "Could not delete records.",
        )
        return false
      } finally {
        setSyncing(false)
      }
    },
    [refreshRecords, tableId],
  )

  const duplicateRecords = useCallback(
    async (recordsToDuplicate: readonly GridRecord[]) => {
      if (!recordsToDuplicate.length) return false
      const readOnlyIds = new Set(
        (bundle?.fields ?? [])
          .filter(
            (field) =>
              field.type === "autoNumber" ||
              field.type === "createdTime" ||
              field.type === "createdBy",
          )
          .map((field) => field.id),
      )
      setSyncing(true)
      try {
        for (const record of recordsToDuplicate) {
          const values = Object.fromEntries(
            Object.entries(record.values).filter(
              ([fieldId, value]) => !readOnlyIds.has(fieldId) && value !== null,
            ),
          )
          await requestJson(`/api/tables/${encodeURIComponent(tableId)}/records`, {
            method: "POST",
            body: JSON.stringify({ values }),
          })
        }
        await refreshRecords()
        return true
      } catch (duplicateError) {
        setError(
          duplicateError instanceof Error
            ? duplicateError.message
            : "Could not duplicate records.",
        )
        return false
      } finally {
        setSyncing(false)
      }
    },
    [bundle?.fields, refreshRecords, tableId],
  )

  /* ---------------------------------------------------------------------- */
  /* Schema mutations                                                       */
  /* ---------------------------------------------------------------------- */

  const addField = useCallback(
    async (field: { name: string; type: FieldType; config?: FieldConfig }) => {
      setSyncing(true)
      try {
        await requestJson(`/api/tables/${encodeURIComponent(tableId)}/fields`, {
          method: "POST",
          body: JSON.stringify({
            name: field.name,
            type: field.type,
            config: field.config ?? {},
          }),
        })
        await refresh()
        return true
      } catch (fieldError) {
        setError(
          fieldError instanceof Error ? fieldError.message : "Could not add this column.",
        )
        return false
      } finally {
        setSyncing(false)
      }
    },
    [refresh, tableId],
  )

  const patchField = useCallback(
    async (fieldId: string, patch: Record<string, unknown>) => {
      await requestJson<{ field: FieldDefinition }>(
        `/api/fields/${encodeURIComponent(fieldId)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      )
      setBundle((current) =>
        current
          ? {
              ...current,
              fields: current.fields
                .map((field) =>
                  field.id === fieldId ? { ...field, ...patch } as FieldDefinition : field,
                )
                .sort((left, right) => (left.rank < right.rank ? -1 : 1)),
            }
          : current,
      )
    },
    [],
  )

  const renameField = useCallback(
    async (fieldId: string, name: string) => {
      try {
        await patchField(fieldId, { name })
        return true
      } catch (fieldError) {
        setError(
          fieldError instanceof Error ? fieldError.message : "Could not rename this column.",
        )
        return false
      }
    },
    [patchField],
  )

  const resizeField = useCallback(
    async (fieldId: string, width: number) => {
      setBundle((current) =>
        current
          ? {
              ...current,
              fields: current.fields.map((field) =>
                field.id === fieldId ? { ...field, width } : field,
              ),
            }
          : current,
      )
      await patchField(fieldId, { width: Math.round(width) }).catch(() => undefined)
    },
    [patchField],
  )

  const freezeField = useCallback(
    async (fieldId: string, frozen: boolean) => {
      await patchField(fieldId, { frozen }).catch(() => undefined)
    },
    [patchField],
  )

  const reorderField = useCallback(
    async (fieldId: string, targetIndex: number) => {
      const fields = bundle?.fields ?? []
      const currentIndex = fields.findIndex((field) => field.id === fieldId)
      if (currentIndex < 0) return false
      const ordered = fields.filter((field) => field.id !== fieldId)
      const bounded = Math.max(0, Math.min(targetIndex, ordered.length))
      const before = ordered[bounded - 1]
      const after = ordered[bounded]
      const rank = generateKeyBetween(before?.rank ?? null, after?.rank ?? null)
      setBundle((current) =>
        current
          ? {
              ...current,
              fields: [...ordered.slice(0, bounded), { ...fields[currentIndex], rank }, ...ordered.slice(bounded)],
            }
          : current,
      )
      try {
        await requestJson(`/api/fields/${encodeURIComponent(fieldId)}`, {
          method: "PATCH",
          body: JSON.stringify({ rank }),
        })
        return true
      } catch (fieldError) {
        setError(
          fieldError instanceof Error ? fieldError.message : "Could not reorder columns.",
        )
        await refresh()
        return false
      }
    },
    [bundle?.fields, refresh],
  )

  const deleteField = useCallback(
    async (fieldId: string) => {
      setSyncing(true)
      try {
        await requestJson(`/api/fields/${encodeURIComponent(fieldId)}`, {
          method: "DELETE",
        })
        await refresh()
        return true
      } catch (fieldError) {
        setError(
          fieldError instanceof Error ? fieldError.message : "Could not delete this column.",
        )
        return false
      } finally {
        setSyncing(false)
      }
    },
    [refresh],
  )

  const duplicateField = useCallback(
    async (fieldId: string) => {
      const source = bundle?.fields.find((field) => field.id === fieldId)
      if (!source) return false
      return addField({
        name: `${source.name} copy`,
        type: source.type === "autoNumber" ? "number" : source.type,
        config: source.config,
      })
    },
    [addField, bundle?.fields],
  )

  const updateWidgets = useCallback(
    async (widgets: DashboardWidgetConfig[]) => {
      await updateViewConfiguration({ dashboardWidgets: widgets })
    },
    [updateViewConfiguration],
  )

  /**
   * Three-step attachment upload: open a session, PUT the bytes, finalize, then
   * append the new attachment to the record cell.
   */
  const uploadAttachments = useCallback(
    async (target: AttachmentUploadTarget, files: File[]) => {
      const record = records.find((candidate) => candidate.id === target.recordId)
      if (!record || !files.length) return
      setSyncing(true)
      try {
        const existing = Array.isArray(record.values[target.fieldId])
          ? (record.values[target.fieldId] as unknown[])
          : []
        const appended: unknown[] = [...existing]
        for (const file of files) {
          const session = await requestJson<{
            uploadSessionId: string
            uploadUrl: string
          }>("/api/attachments/session", {
            method: "POST",
            body: JSON.stringify({
              tableId,
              fieldId: target.fieldId,
              recordId: target.recordId,
            }),
          })
          const stored = await requestJson<{
            storageId: string
            name: string
            mimeType: string
          }>(session.uploadUrl, {
            method: "PUT",
            body: file,
            headers: {
              "content-type": file.type || "application/octet-stream",
              "x-file-name": file.name,
            },
          })
          const finalized = await requestJson<{
            attachment: { attachmentId: string; name: string; mimeType: string; size: number }
          }>("/api/attachments/finalize", {
            method: "POST",
            body: JSON.stringify({
              uploadSessionId: session.uploadSessionId,
              storageId: stored.storageId,
              name: stored.name,
              mimeType: stored.mimeType,
            }),
          })
          appended.push(finalized.attachment)
        }
        await batchUpdateCells([
          {
            recordId: target.recordId,
            fieldId: target.fieldId,
            value: appended as CellValue,
            expectedRevision: record.revision,
          },
        ])
      } catch (uploadError) {
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : "Could not upload this file.",
        )
      } finally {
        setSyncing(false)
      }
    },
    [batchUpdateCells, records, tableId],
  )

  return {
    bundle,
    table: bundle?.table,
    fields: bundle?.fields ?? [],
    views: bundle?.views ?? [],
    activeView,
    activeViewId,
    controls,
    records,
    totalRecordCount,
    groupLabels,
    groupCounts,
    search,
    loading,
    syncing,
    error,
    clearError: () => setError(undefined),
    refresh,
    refreshRecords,
    selectView,
    applySearch,
    updateControls,
    createView,
    renameView,
    deleteView,
    updateViewConfiguration,
    updateCell,
    batchUpdateCells,
    addRecord,
    deleteRecords,
    duplicateRecords,
    addField,
    renameField,
    resizeField,
    freezeField,
    reorderField,
    deleteField,
    duplicateField,
    updateWidgets,
    uploadAttachments,
  }
}
