import { describe, expect, it } from "vitest"

import {
  clampGridCell,
  isGridCellSelected,
  moveGridSelection,
  normalizeGridSelection,
  selectedGridCells,
} from "@/lib/grid-selection"

describe("grid selection", () => {
  it("normalizes ranges selected in any direction", () => {
    expect(
      normalizeGridSelection({
        anchor: { row: 4, column: 3 },
        focus: { row: 1, column: 0 },
      }),
    ).toEqual({
      firstRow: 1,
      lastRow: 4,
      firstColumn: 0,
      lastColumn: 3,
    })
  })

  it("extends from the anchor and clamps keyboard movement", () => {
    const selected = {
      anchor: { row: 1, column: 1 },
      focus: { row: 1, column: 1 },
    }
    expect(moveGridSelection(selected, { row: 9, column: -9 }, 3, 4, true))
      .toEqual({
        anchor: { row: 1, column: 1 },
        focus: { row: 2, column: 0 },
      })
    expect(clampGridCell({ row: -1, column: 99 }, 3, 4)).toEqual({
      row: 0,
      column: 3,
    })
  })

  it("enumerates a rectangular selection in row order", () => {
    const selection = {
      anchor: { row: 0, column: 1 },
      focus: { row: 1, column: 2 },
    }
    expect(selectedGridCells(selection)).toEqual([
      { row: 0, column: 1 },
      { row: 0, column: 2 },
      { row: 1, column: 1 },
      { row: 1, column: 2 },
    ])
    expect(isGridCellSelected(selection, { row: 1, column: 2 })).toBe(true)
    expect(isGridCellSelected(selection, { row: 2, column: 2 })).toBe(false)
  })
})
