export type GridCellCoordinate = {
  row: number
  column: number
}

export type GridSelection = {
  anchor: GridCellCoordinate
  focus: GridCellCoordinate
}

export type NormalizedGridSelection = {
  firstRow: number
  lastRow: number
  firstColumn: number
  lastColumn: number
}

export function clampGridCell(
  cell: GridCellCoordinate,
  rowCount: number,
  columnCount: number,
): GridCellCoordinate {
  return {
    row: Math.max(0, Math.min(rowCount - 1, cell.row)),
    column: Math.max(0, Math.min(columnCount - 1, cell.column)),
  }
}

export function normalizeGridSelection(
  selection: GridSelection,
): NormalizedGridSelection {
  return {
    firstRow: Math.min(selection.anchor.row, selection.focus.row),
    lastRow: Math.max(selection.anchor.row, selection.focus.row),
    firstColumn: Math.min(
      selection.anchor.column,
      selection.focus.column,
    ),
    lastColumn: Math.max(
      selection.anchor.column,
      selection.focus.column,
    ),
  }
}

export function isGridCellSelected(
  selection: GridSelection | undefined,
  cell: GridCellCoordinate,
): boolean {
  if (!selection) return false
  const range = normalizeGridSelection(selection)
  return (
    cell.row >= range.firstRow &&
    cell.row <= range.lastRow &&
    cell.column >= range.firstColumn &&
    cell.column <= range.lastColumn
  )
}

export function moveGridSelection(
  selection: GridSelection | undefined,
  delta: GridCellCoordinate,
  rowCount: number,
  columnCount: number,
  extend: boolean,
): GridSelection | undefined {
  if (rowCount <= 0 || columnCount <= 0) return undefined
  const current = selection?.focus ?? { row: 0, column: 0 }
  const focus = clampGridCell(
    {
      row: current.row + delta.row,
      column: current.column + delta.column,
    },
    rowCount,
    columnCount,
  )
  return extend && selection
    ? { anchor: selection.anchor, focus }
    : { anchor: focus, focus }
}

export function selectedGridCells(
  selection: GridSelection,
): GridCellCoordinate[] {
  const range = normalizeGridSelection(selection)
  const cells: GridCellCoordinate[] = []
  for (let row = range.firstRow; row <= range.lastRow; row += 1) {
    for (
      let column = range.firstColumn;
      column <= range.lastColumn;
      column += 1
    ) {
      cells.push({ row, column })
    }
  }
  return cells
}
