export const MAX_GRID_BATCH_OPERATIONS = 500
export const MAX_GRID_BATCH_RECORDS = 100

type RecordScopedUpdate = {
  recordId: string
}

export function chunkGridCellUpdates<T extends RecordScopedUpdate>(
  updates: readonly T[],
): T[][] {
  const chunks: T[][] = []
  let current: T[] = []
  let currentRecordIds = new Set<string>()

  for (const update of updates) {
    const introducesRecord = !currentRecordIds.has(update.recordId)
    const exceedsOperationLimit =
      current.length >= MAX_GRID_BATCH_OPERATIONS
    const exceedsRecordLimit =
      introducesRecord &&
      currentRecordIds.size >= MAX_GRID_BATCH_RECORDS

    if (
      current.length > 0 &&
      (exceedsOperationLimit || exceedsRecordLimit)
    ) {
      chunks.push(current)
      current = []
      currentRecordIds = new Set()
    }

    current.push(update)
    currentRecordIds.add(update.recordId)
  }

  if (current.length > 0) chunks.push(current)
  return chunks
}
