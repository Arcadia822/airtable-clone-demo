import { describe, expect, it } from "vitest"

import {
  clampColumnWidth,
  columnDropIndex,
  moveItemToIndex,
} from "./column-interactions"

describe("column interactions", () => {
  it("clamps drag-resized widths to the supported range", () => {
    expect(clampColumnWidth(42)).toBe(100)
    expect(clampColumnWidth(247.6)).toBe(248)
    expect(clampColumnWidth(900)).toBe(600)
  })

  it("calculates the final index when dropping on either header edge", () => {
    const fields = ["a", "b", "c", "d"]

    expect(columnDropIndex(fields, "a", "c", "after")).toBe(2)
    expect(columnDropIndex(fields, "d", "b", "before")).toBe(1)
    expect(columnDropIndex(fields, "b", "c", "before")).toBeNull()
  })

  it("moves an item to its requested final index", () => {
    expect(moveItemToIndex(["a", "b", "c"], 0, 2)).toEqual([
      "b",
      "c",
      "a",
    ])
  })
})
