"use client"

import { generateKeyBetween } from "jittered-fractional-indexing"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { ViewControlsValue } from "@/components/workspace/view-controls"

import type {
  AttachmentValue,
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

type CellWriteTarget = { recordId: string; fieldId: string }

type CellSnapshot = CellWriteTarget & {
  hadValue: boolean
  value: CellValue | undefined
  token: number
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

  // Mirrors the committed rows so a failed write can put the old cell back.
  const recordsRef = useRef<GridRecord[]>(records)
  // Highest revision the server has confirmed for each record.
  const latestRevisionsRef = useRef(new Map<string, number>())
  // Writes queued per record so consecutive edits reuse the newest revision.
  const recordWritesRef = useRef(new Map<string, Promise<unknown>>())
  // Uploads queued per cell so two batches never merge the same array twice.
  const uploadChainsRef = useRef(new Map<string, Promise<unknown>>())
  // Sequence tokens let a stale rollback skip cells a newer write owns.
  const cellWriteSeqRef = useRef(0)
  const cellWriteTokensRef = useRef(new Map<string, number>())
  const pendingWritesRef = useRef(0)

  const beginWrite = useCallback(() => {
    pendingWritesRef.current += 1
    setSyncing(true)
  }, [])

  const endWrite = useCallback(() => {
    pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1)
    setSyncing(pendingWritesRef.current > 0)
  }, [])

  useEffect(() => {
    recordsRef.current = records
  }, [records])

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
      for (const record of result.records) {
        const known = latestRevisionsRef.current.get(record.id) ?? 0
        if (record.revision > known) {
          latestRevisionsRef.current.set(record.id, record.revision)
        }
      }
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
    // Bootstrap on the next tick: state may only be reset from an async
    // callback, never while the effect body is running.
    const handle = window.setTimeout(() => {
      setLoading(true)
      setBundle(undefined)
      setActiveViewId(undefined)
      setRecords([])
      setSearch("")
      void (async () => {
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
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
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
      beginWrite()
      try {
        await runQuery(view, search)
      } catch (queryError) {
        setError(
          queryError instanceof Error ? queryError.message : "Could not load this view.",
        )
      } finally {
        endWrite()
      }
    },
    [bundle?.views, runQuery, search],
  )

  const applySearch = useCallback(
    async (value: string) => {
      setSearch(value)
      beginWrite()
      try {
        await runQuery(activeView, value)
      } catch (queryError) {
        setError(
          queryError instanceof Error ? queryError.message : "Search failed.",
        )
      } finally {
        endWrite()
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
      beginWrite()
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
        endWrite()
      }
    },
    [activeView, persistView, runQuery, search],
  )

  const applyView = useCallback(
    async (view: WorkspaceViewDto) => {
      setActiveViewId(view.id)
      beginWrite()
      try {
        await runQuery(view, search)
      } finally {
        endWrite()
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
      beginWrite()
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
        endWrite()
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

  /** Merges saved cell values into the local records so edits render immediately. */
  const applyCellValues = useCallback(
    (
      updates: Array<{ recordId: string; fieldId: string; value: CellValue }>,
    ) => {
      if (!updates.length) return
      const byRecordId = new Map<string, Map<string, CellValue>>()
      for (const update of updates) {
        const fields =
          byRecordId.get(update.recordId) ?? new Map<string, CellValue>()
        fields.set(update.fieldId, update.value)
        byRecordId.set(update.recordId, fields)
      }
      setRecords((current) =>
        current.map((record) => {
          const fields = byRecordId.get(record.id)
          if (!fields) return record
          const values = { ...record.values }
          for (const [fieldId, value] of fields) values[fieldId] = value
          return { ...record, values }
        }),
      )
    },
    [],
  )

  const rememberRevisions = useCallback(
    (revisions: Array<{ recordId: string; revision: number }>) => {
      if (!revisions.length) return
      for (const revision of revisions) {
        latestRevisionsRef.current.set(revision.recordId, revision.revision)
      }
      applyRevisions(revisions)
    },
    [applyRevisions],
  )

  /** Newest revision the server confirmed, so a queued write stops guessing. */
  const effectiveRevision = useCallback(
    (recordId: string, expectedRevision: number) => {
      const known = latestRevisionsRef.current.get(recordId)
      return known === undefined
        ? expectedRevision
        : Math.max(known, expectedRevision)
    },
    [],
  )

  const captureCellSnapshots = useCallback(
    (cells: readonly CellWriteTarget[]): CellSnapshot[] => {
      const byId = new Map(recordsRef.current.map((record) => [record.id, record]))
      return cells.map((cell) => {
        const record = byId.get(cell.recordId)
        const token = ++cellWriteSeqRef.current
        cellWriteTokensRef.current.set(`${cell.recordId}:${cell.fieldId}`, token)
        return {
          ...cell,
          hadValue: record
            ? Object.prototype.hasOwnProperty.call(record.values, cell.fieldId)
            : false,
          value: record?.values[cell.fieldId],
          token,
        }
      })
    },
    [],
  )

  const restoreCellSnapshots = useCallback(
    (snapshots: readonly CellSnapshot[]) => {
      const byRecordId = new Map<string, Map<string, CellSnapshot>>()
      for (const snapshot of snapshots) {
        const key = `${snapshot.recordId}:${snapshot.fieldId}`
        // A newer write owns this cell now; keep its optimistic value.
        if (cellWriteTokensRef.current.get(key) !== snapshot.token) continue
        cellWriteTokensRef.current.delete(key)
        const fields =
          byRecordId.get(snapshot.recordId) ?? new Map<string, CellSnapshot>()
        fields.set(snapshot.fieldId, snapshot)
        byRecordId.set(snapshot.recordId, fields)
      }
      if (!byRecordId.size) return
      setRecords((current) =>
        current.map((record) => {
          const fields = byRecordId.get(record.id)
          if (!fields) return record
          const values = { ...record.values }
          for (const [fieldId, snapshot] of fields) {
            if (snapshot.hadValue) values[fieldId] = snapshot.value as CellValue
            else delete values[fieldId]
          }
          return { ...record, values }
        }),
      )
    },
    [],
  )

  const enqueueRecordWrites = useCallback(
    <T,>(recordIds: readonly string[], task: () => Promise<T>): Promise<T> => {
      const ids = [...new Set(recordIds)]
      const pending = ids.map(
        (recordId) => recordWritesRef.current.get(recordId) ?? Promise.resolve(),
      )
      const next = Promise.all(
        pending.map((write) => write.catch(() => undefined)),
      ).then(task)
      const tracked = next.catch(() => undefined)
      for (const recordId of ids) {
        recordWritesRef.current.set(recordId, tracked)
        void tracked.finally(() => {
          if (recordWritesRef.current.get(recordId) === tracked) {
            recordWritesRef.current.delete(recordId)
          }
        })
      }
      return next
    },
    [],
  )

  /**
   * Optimistically paints the cell, then writes it. Any rejection restores the
   * pre-write value, and the returned promise carries the server revision so
   * consecutive writes to one record queue instead of racing on a stale one.
   */
  const updateCell = useCallback(
    (
      recordId: string,
      fieldId: string,
      value: CellValue,
      expectedRevision: number,
    ): Promise<number | null> => {
      const snapshots = captureCellSnapshots([{ recordId, fieldId }])
      applyCellValues([{ recordId, fieldId, value }])
      beginWrite()
      return enqueueRecordWrites([recordId], async () => {
        try {
          const result = await requestJson<{ revisions: Record<string, number> }>(
            `/api/tables/${encodeURIComponent(tableId)}/records/batch`,
            {
              method: "PATCH",
              body: JSON.stringify({
                updates: [
                  {
                    recordId,
                    fieldId,
                    value,
                    expectedRevision: effectiveRevision(
                      recordId,
                      expectedRevision,
                    ),
                  },
                ],
              }),
            },
          )
          const revisions = Object.entries(result.revisions ?? {}).map(
            ([id, revision]) => ({ recordId: id, revision }),
          )
          rememberRevisions(revisions)
          return result.revisions?.[recordId] ?? null
        } catch (writeError) {
          restoreCellSnapshots(snapshots)
          const conflict =
            writeError instanceof ApiError && writeError.isRevisionConflict
          setError(
            conflict
              ? "Someone else changed this record. Showing the latest saved values."
              : writeError instanceof Error
                ? writeError.message
                : "Could not save this cell.",
          )
          if (conflict) {
            await refreshRecords().catch(() => undefined)
          }
          return null
        } finally {
          endWrite()
        }
      })
    },
    [
      applyCellValues,
      beginWrite,
      captureCellSnapshots,
      effectiveRevision,
      endWrite,
      enqueueRecordWrites,
      refreshRecords,
      rememberRevisions,
      restoreCellSnapshots,
      tableId,
    ],
  )

  const batchUpdateCells = useCallback(
    async (updates: Array<{
      recordId: string
      fieldId: string
      value: CellValue
      expectedRevision: number
    }>) => {
      const snapshots = captureCellSnapshots(updates)
      applyCellValues(updates)
      beginWrite()
      try {
        const result = await enqueueRecordWrites(
          updates.map((update) => update.recordId),
          () =>
            requestJson<{ revisions: Record<string, number> }>(
              `/api/tables/${encodeURIComponent(tableId)}/records/batch`,
              {
                method: "PATCH",
                body: JSON.stringify({
                  updates: updates.map((update) => ({
                    ...update,
                    expectedRevision: effectiveRevision(
                      update.recordId,
                      update.expectedRevision,
                    ),
                  })),
                }),
              },
            ),
        )
        const revisions = Object.entries(result.revisions ?? {}).map(
          ([recordId, revision]) => ({ recordId, revision }),
        )
        rememberRevisions(revisions)
        return { revisions }
      } catch (writeError) {
        restoreCellSnapshots(snapshots)
        const conflict =
          writeError instanceof ApiError && writeError.isRevisionConflict
        const message =
          writeError instanceof Error ? writeError.message : "Could not save changes."
        if (conflict) {
          await refreshRecords().catch(() => undefined)
        }
        return { saved: false as const, message }
      } finally {
        endWrite()
      }
    },
    [
      applyCellValues,
      beginWrite,
      captureCellSnapshots,
      effectiveRevision,
      endWrite,
      enqueueRecordWrites,
      refreshRecords,
      rememberRevisions,
      restoreCellSnapshots,
      tableId,
    ],
  )

  const addRecord = useCallback(
    async (initialValues: Record<string, CellValue> = {}) => {
      beginWrite()
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
        endWrite()
      }
    },
    [beginWrite, endWrite, refreshRecords, tableId],
  )

  const deleteRecords = useCallback(
    async (recordsToDelete: readonly GridRecord[]) => {
      if (!recordsToDelete.length) return false
      beginWrite()
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
        endWrite()
      }
    },
    [beginWrite, endWrite, refreshRecords, tableId],
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
      const created: string[] = []
      beginWrite()
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
          created.push(record.id)
        }
        await refreshRecords()
        return true
      } catch (duplicateError) {
        const reason =
          duplicateError instanceof Error
            ? duplicateError.message
            : "Could not duplicate records."
        setError(
          created.length
            ? `Duplicated ${created.length} of ${recordsToDuplicate.length} records before the request failed. ${reason}`
            : reason,
        )
        // Surface the copies that did land instead of leaving them invisible.
        if (created.length) {
          await refreshRecords().catch(() => undefined)
        }
        return false
      } finally {
        endWrite()
      }
    },
    [beginWrite, bundle?.fields, endWrite, refreshRecords, tableId],
  )

  /* ---------------------------------------------------------------------- */
  /* Schema mutations                                                       */
  /* ---------------------------------------------------------------------- */

  const addField = useCallback(
    async (field: { name: string; type: FieldType; config?: FieldConfig }) => {
      beginWrite()
      try {
        await requestJson(`/api/tables/${encodeURIComponent(tableId)}/fields`, {
          method: "POST",
          body: JSON.stringify({
            name: field.name,
            type: field.type,
            config: field.config ?? {},
          }),
        })
        await refresh(activeViewId)
        return true
      } catch (fieldError) {
        setError(
          fieldError instanceof Error ? fieldError.message : "Could not add this column.",
        )
        return false
      } finally {
        endWrite()
      }
    },
    [activeViewId, beginWrite, endWrite, refresh, tableId],
  )

  const patchField = useCallback(
    async (fieldId: string, patch: Record<string, unknown>) => {
      const { field } = await requestJson<{ field: FieldDefinition }>(
        `/api/fields/${encodeURIComponent(fieldId)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      )
      setBundle((current) =>
        current
          ? {
              ...current,
              fields: current.fields
                .map((candidate) => (candidate.id === field.id ? field : candidate))
                .sort((left, right) => (left.rank < right.rank ? -1 : 1)),
            }
          : current,
      )
      return field
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
        await refresh(activeViewId)
        return false
      }
    },
    [activeViewId, bundle?.fields, refresh],
  )

  const deleteField = useCallback(
    async (fieldId: string) => {
      beginWrite()
      try {
        await requestJson(`/api/fields/${encodeURIComponent(fieldId)}`, {
          method: "DELETE",
        })
        await refresh(activeViewId)
        return true
      } catch (fieldError) {
        setError(
          fieldError instanceof Error ? fieldError.message : "Could not delete this column.",
        )
        return false
      } finally {
        endWrite()
      }
    },
    [activeViewId, beginWrite, endWrite, refresh],
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
   * append the new attachments to the record cell. Uploads for one cell run in
   * sequence, and the final write re-reads the record so it merges against the
   * server's current cell and revision instead of a pre-upload snapshot.
   */
  const uploadAttachments = useCallback(
    (target: AttachmentUploadTarget, files: File[]): Promise<void> => {
      if (!files.length) return Promise.resolve()
      const cellKey = `${target.recordId}:${target.fieldId}`
      const previous = uploadChainsRef.current.get(cellKey) ?? Promise.resolve()
      const next = previous.catch(() => undefined).then(async () => {
        beginWrite()
        try {
          const uploaded: unknown[] = []
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
              attachment: AttachmentValue
            }>("/api/attachments/finalize", {
              method: "POST",
              body: JSON.stringify({
                uploadSessionId: session.uploadSessionId,
                storageId: stored.storageId,
                name: stored.name,
                mimeType: stored.mimeType,
              }),
            })
            uploaded.push(finalized.attachment)
          }

          const latest = await requestJson<{ record: GridRecord }>(
            `/api/records/${encodeURIComponent(target.recordId)}`,
          )
          const known = latestRevisionsRef.current.get(target.recordId) ?? 0
          latestRevisionsRef.current.set(
            target.recordId,
            Math.max(known, latest.record.revision),
          )
          const currentValue = latest.record.values[target.fieldId]
          const current = Array.isArray(currentValue) ? currentValue : []
          const outcome = await batchUpdateCells([
            {
              recordId: target.recordId,
              fieldId: target.fieldId,
              value: [...current, ...uploaded] as CellValue,
              expectedRevision: latest.record.revision,
            },
          ])
          if ("saved" in outcome && outcome.saved === false) {
            setError(outcome.message ?? "Could not attach this file.")
          }
        } catch (uploadError) {
          setError(
            uploadError instanceof Error
              ? uploadError.message
              : "Could not upload this file.",
          )
        } finally {
          endWrite()
        }
      })
      uploadChainsRef.current.set(cellKey, next)
      void next.finally(() => {
        if (uploadChainsRef.current.get(cellKey) === next) {
          uploadChainsRef.current.delete(cellKey)
        }
      })
      return next
    },
    [batchUpdateCells, beginWrite, endWrite, tableId],
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
