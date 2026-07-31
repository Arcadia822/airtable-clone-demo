export interface GridColumnInput {
  frozen?: boolean
  width: number
}

export interface GridColumnPosition {
  end: number
  frozen: boolean
  frozenLeft: number
  index: number
  start: number
  width: number
}

export interface GridColumnLayout {
  columns: GridColumnPosition[]
  contentWidth: number
  frozenWidth: number
  rowHeaderWidth: number
  stickyWidth: number
}

export interface GridColumnWindow {
  indexes: number[]
  virtualIndexes: number[]
}

const DEFAULT_OVERSCAN_PIXELS = 320

export function createGridColumnLayout(
  columns: readonly GridColumnInput[],
  rowHeaderWidth: number,
): GridColumnLayout {
  const frozenWidth = columns.reduce(
    (total, column) =>
      total + (column.frozen ? Math.max(0, column.width) : 0),
    0,
  )
  let frozenStart = rowHeaderWidth
  let movableStart = rowHeaderWidth + frozenWidth
  const positions = columns.map((column, index) => {
    const width = Math.max(0, column.width)
    const frozen = Boolean(column.frozen)
    const start = frozen ? frozenStart : movableStart
    const position = {
      end: start + width,
      frozen,
      frozenLeft: frozenStart,
      index,
      start,
      width,
    }
    if (frozen) {
      frozenStart += width
    } else {
      movableStart += width
    }
    return position
  })

  return {
    columns: positions,
    contentWidth:
      rowHeaderWidth +
      columns.reduce(
        (total, column) => total + Math.max(0, column.width),
        0,
      ),
    frozenWidth,
    rowHeaderWidth,
    stickyWidth: rowHeaderWidth + frozenWidth,
  }
}

export function getGridColumnWindow(
  layout: GridColumnLayout,
  scrollLeft: number,
  viewportWidth: number,
  overscanPixels = DEFAULT_OVERSCAN_PIXELS,
): GridColumnWindow {
  const frozenIndexes = layout.columns
    .filter((column) => column.frozen)
    .map((column) => column.index)
  const movableColumns = layout.columns.filter((column) => !column.frozen)
  if (!movableColumns.length) {
    return { indexes: frozenIndexes, virtualIndexes: [] }
  }

  const safeScrollLeft = Math.max(0, scrollLeft)
  const safeViewportWidth = Math.max(1, viewportWidth)
  const safeOverscan = Math.max(0, overscanPixels)
  const visibleStart = Math.max(
    layout.rowHeaderWidth,
    safeScrollLeft + layout.stickyWidth - safeOverscan,
  )
  const visibleEnd =
    safeScrollLeft + safeViewportWidth + safeOverscan

  let low = 0
  let high = movableColumns.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (movableColumns[middle]!.end < visibleStart) {
      low = middle + 1
    } else {
      high = middle
    }
  }

  const virtualIndexes: number[] = []
  for (let index = low; index < movableColumns.length; index += 1) {
    const column = movableColumns[index]!
    if (column.start > visibleEnd) break
    virtualIndexes.push(column.index)
  }

  // A narrow or temporarily unmeasured viewport should still expose one
  // editable, non-frozen column.
  if (!virtualIndexes.length) {
    const fallback =
      movableColumns[Math.min(low, movableColumns.length - 1)]
    if (fallback) virtualIndexes.push(fallback.index)
  }

  return {
    indexes: [...frozenIndexes, ...virtualIndexes].sort(
      (left, right) => left - right,
    ),
    virtualIndexes,
  }
}

export function scrollLeftForGridColumn(
  layout: GridColumnLayout,
  columnIndex: number,
  currentScrollLeft: number,
  viewportWidth: number,
  trailingWidth = 0,
): number {
  const column = layout.columns[columnIndex]
  if (!column || column.frozen || viewportWidth <= 0) {
    return Math.max(0, currentScrollLeft)
  }

  const visibleStart = currentScrollLeft + layout.stickyWidth
  const visibleEnd = currentScrollLeft + viewportWidth
  let nextScrollLeft = currentScrollLeft
  if (column.start < visibleStart) {
    nextScrollLeft = column.start - layout.stickyWidth
  } else if (column.end > visibleEnd) {
    nextScrollLeft = column.end - viewportWidth
  }

  const maximumScrollLeft = Math.max(
    0,
    layout.contentWidth + Math.max(0, trailingWidth) - viewportWidth,
  )
  return Math.min(maximumScrollLeft, Math.max(0, nextScrollLeft))
}
