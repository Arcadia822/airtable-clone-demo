import type { CellValue, GridRecord } from "@/lib/domain"

export const MAX_GRID_HISTORY_ENTRIES = 40
export const MAX_GRID_HISTORY_CELLS = 2_000
export const MAX_GRID_HISTORY_BYTES = 2 * 1024 * 1024

export type GridHistoryRevision = {
  recordId: string
  revision: number
}

export type GridHistoryUpdate = {
  recordId: string
  fieldId: string
  value: CellValue
  expectedRevision: number
}

type GridHistoryCell = {
  recordId: string
  fieldId: string
  before: CellValue
  after: CellValue
}

export type GridHistoryEntry = {
  label: string
  cells: GridHistoryCell[]
  expectedRevisions: GridHistoryRevision[]
}

export type GridEditHistory = {
  past: GridHistoryEntry[]
  future: GridHistoryEntry[]
}

export const EMPTY_GRID_EDIT_HISTORY: GridEditHistory = {
  past: [],
  future: [],
}

function cloneCellValue(value: CellValue): CellValue {
  if (!Array.isArray(value)) return value
  return value.map((item) =>
    typeof item === "string" ? item : { ...item },
  ) as CellValue
}

export function gridCellValuesEqual(
  first: CellValue,
  second: CellValue,
) {
  if (!Array.isArray(first) || !Array.isArray(second)) {
    return Object.is(first, second)
  }
  return JSON.stringify(first) === JSON.stringify(second)
}

export function changedGridCellUpdates(
  updates: readonly GridHistoryUpdate[],
  records: readonly GridRecord[],
) {
  const recordsById = new Map(
    records.map((record) => [record.id, record]),
  )
  return updates.filter((update) => {
    const record = recordsById.get(update.recordId)
    if (!record) return false
    return !gridCellValuesEqual(
      record.values[update.fieldId] ?? null,
      update.value,
    )
  })
}

export function createGridHistoryEntry(
  label: string,
  updates: readonly GridHistoryUpdate[],
  records: readonly GridRecord[],
  revisions: readonly GridHistoryRevision[],
): GridHistoryEntry | undefined {
  const recordsById = new Map(
    records.map((record) => [record.id, record]),
  )
  const revisionsByRecord = new Map(
    revisions.map((revision) => [
      revision.recordId,
      revision.revision,
    ]),
  )
  const cellsByKey = new Map<string, GridHistoryCell>()

  for (const update of updates) {
    const record = recordsById.get(update.recordId)
    if (!record || !revisionsByRecord.has(update.recordId)) continue
    const key = `${update.recordId}\u0000${update.fieldId}`
    const existing = cellsByKey.get(key)
    const before =
      existing?.before ??
      cloneCellValue(record.values[update.fieldId] ?? null)
    const after = cloneCellValue(update.value)
    if (gridCellValuesEqual(before, after)) {
      cellsByKey.delete(key)
      continue
    }
    cellsByKey.set(key, {
      recordId: update.recordId,
      fieldId: update.fieldId,
      before,
      after,
    })
  }

  const cells = [...cellsByKey.values()]
  if (!cells.length) return undefined

  const touchedRecordIds = new Set(
    cells.map((cell) => cell.recordId),
  )
  const expectedRevisions = revisions
    .filter((revision) => touchedRecordIds.has(revision.recordId))
    .map((revision) => ({ ...revision }))
  if (expectedRevisions.length !== touchedRecordIds.size) return undefined

  return { label, cells, expectedRevisions }
}

function entrySize(entry: GridHistoryEntry) {
  return JSON.stringify(entry).length * 2
}

function historyTotals(entries: readonly GridHistoryEntry[]) {
  return entries.reduce(
    (totals, entry) => ({
      cells: totals.cells + entry.cells.length,
      bytes: totals.bytes + entrySize(entry),
    }),
    { cells: 0, bytes: 0 },
  )
}

export function recordGridHistory(
  history: GridEditHistory,
  entry: GridHistoryEntry,
): GridEditHistory {
  if (
    entry.cells.length > MAX_GRID_HISTORY_CELLS ||
    entrySize(entry) > MAX_GRID_HISTORY_BYTES
  ) {
    return EMPTY_GRID_EDIT_HISTORY
  }

  const past = [...history.past, entry]
  while (past.length > MAX_GRID_HISTORY_ENTRIES) past.shift()

  let totals = historyTotals(past)
  while (
    past.length &&
    (totals.cells > MAX_GRID_HISTORY_CELLS ||
      totals.bytes > MAX_GRID_HISTORY_BYTES)
  ) {
    past.shift()
    totals = historyTotals(past)
  }

  return { past, future: [] }
}

function entryWithRevisions(
  entry: GridHistoryEntry,
  revisions: readonly GridHistoryRevision[],
): GridHistoryEntry | undefined {
  const revisionsByRecord = new Map(
    revisions.map((revision) => [
      revision.recordId,
      revision.revision,
    ]),
  )
  const touchedRecordIds = new Set(
    entry.cells.map((cell) => cell.recordId),
  )
  if (
    [...touchedRecordIds].some(
      (recordId) => !revisionsByRecord.has(recordId),
    )
  ) {
    return undefined
  }
  return {
    ...entry,
    expectedRevisions: revisions
      .filter((revision) => touchedRecordIds.has(revision.recordId))
      .map((revision) => ({ ...revision })),
  }
}

export function gridHistoryUpdates(
  entry: GridHistoryEntry,
  direction: "undo" | "redo",
): GridHistoryUpdate[] | undefined {
  const revisionsByRecord = new Map(
    entry.expectedRevisions.map((revision) => [
      revision.recordId,
      revision.revision,
    ]),
  )
  const updates: GridHistoryUpdate[] = []
  for (const cell of entry.cells) {
    const expectedRevision = revisionsByRecord.get(cell.recordId)
    if (expectedRevision === undefined) return undefined
    updates.push({
      recordId: cell.recordId,
      fieldId: cell.fieldId,
      value: cloneCellValue(
        direction === "undo" ? cell.before : cell.after,
      ),
      expectedRevision,
    })
  }
  return updates
}

export function completeGridUndo(
  history: GridEditHistory,
  revisions: readonly GridHistoryRevision[],
): GridEditHistory {
  const entry = history.past.at(-1)
  if (!entry) return history
  const nextEntry = entryWithRevisions(entry, revisions)
  if (!nextEntry) return EMPTY_GRID_EDIT_HISTORY
  return {
    past: history.past.slice(0, -1),
    future: [...history.future, nextEntry],
  }
}

export function completeGridRedo(
  history: GridEditHistory,
  revisions: readonly GridHistoryRevision[],
): GridEditHistory {
  const entry = history.future.at(-1)
  if (!entry) return history
  const nextEntry = entryWithRevisions(entry, revisions)
  if (!nextEntry) return EMPTY_GRID_EDIT_HISTORY
  return {
    past: [...history.past, nextEntry],
    future: history.future.slice(0, -1),
  }
}
