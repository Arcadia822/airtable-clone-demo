export const MIN_COLUMN_WIDTH = 100
export const MAX_COLUMN_WIDTH = 600

export type ColumnDropEdge = "before" | "after"

export function clampColumnWidth(width: number): number {
  return Math.max(
    MIN_COLUMN_WIDTH,
    Math.min(MAX_COLUMN_WIDTH, Math.round(width)),
  )
}

export function columnDropIndex(
  fieldIds: readonly string[],
  draggedFieldId: string,
  targetFieldId: string,
  edge: ColumnDropEdge,
): number | null {
  const fromIndex = fieldIds.indexOf(draggedFieldId)
  const targetIndex = fieldIds.indexOf(targetFieldId)
  if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) {
    return null
  }

  let insertionIndex = targetIndex + (edge === "after" ? 1 : 0)
  if (fromIndex < insertionIndex) insertionIndex -= 1

  const finalIndex = Math.max(
    0,
    Math.min(fieldIds.length - 1, insertionIndex),
  )
  return finalIndex === fromIndex ? null : finalIndex
}

export function moveItemToIndex<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  if (
    fromIndex < 0 ||
    fromIndex >= items.length ||
    toIndex < 0 ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return [...items]
  }

  const next = [...items]
  const [item] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, item!)
  return next
}
