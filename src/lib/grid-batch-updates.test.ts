import { describe, expect, it } from "vitest"

import {
  chunkGridCellUpdates,
  MAX_GRID_BATCH_OPERATIONS,
  MAX_GRID_BATCH_RECORDS,
} from "@/lib/grid-batch-updates"

describe("grid batch updates", () => {
  it("bounds every chunk by both Convex mutation limits", () => {
    const updates = Array.from({ length: 650 }, (_, index) => ({
      recordId: `record-${Math.floor(index / 5)}`,
      cell: index,
    }))

    const chunks = chunkGridCellUpdates(updates)

    expect(chunks.flat()).toEqual(updates)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(
        MAX_GRID_BATCH_OPERATIONS,
      )
      expect(new Set(chunk.map((update) => update.recordId)).size).toBeLessThanOrEqual(
        MAX_GRID_BATCH_RECORDS,
      )
    }
  })

  it("starts a new chunk before a 101st record is added", () => {
    const updates = Array.from({ length: 150 }, (_, index) => ({
      recordId: `record-${index}`,
    }))

    expect(
      chunkGridCellUpdates(updates).map((chunk) => chunk.length),
    ).toEqual([100, 50])
  })
})
