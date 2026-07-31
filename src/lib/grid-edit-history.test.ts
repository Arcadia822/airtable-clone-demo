import { describe, expect, it } from "vitest"

import type { GridRecord } from "@/lib/domain"
import {
  changedGridCellUpdates,
  completeGridRedo,
  completeGridUndo,
  createGridHistoryEntry,
  EMPTY_GRID_EDIT_HISTORY,
  gridHistoryUpdates,
  MAX_GRID_HISTORY_BYTES,
  MAX_GRID_HISTORY_ENTRIES,
  recordGridHistory,
  type GridEditHistory,
} from "@/lib/grid-edit-history"

const record: GridRecord = {
  id: "record-private",
  rank: "a",
  values: { name: "Before", tags: ["one"] },
  revision: 4,
  createdAt: 1,
  createdBy: "Teammate",
  updatedAt: 2,
  updatedBy: "Teammate",
}

describe("grid edit history", () => {
  it("builds revision-safe inverse updates and moves entries through undo and redo", () => {
    const updates = [
      {
        recordId: record.id,
        fieldId: "name",
        value: "After",
        expectedRevision: 4,
      },
    ]
    const entry = createGridHistoryEntry(
      "Edit Name",
      updates,
      [record],
      [{ recordId: record.id, revision: 5 }],
    )
    expect(entry).toBeDefined()

    const afterEdit = recordGridHistory(
      EMPTY_GRID_EDIT_HISTORY,
      entry!,
    )
    expect(gridHistoryUpdates(entry!, "undo")).toEqual([
      {
        recordId: record.id,
        fieldId: "name",
        value: "Before",
        expectedRevision: 5,
      },
    ])

    const afterUndo = completeGridUndo(afterEdit, [
      { recordId: record.id, revision: 6 },
    ])
    expect(afterUndo.past).toHaveLength(0)
    expect(gridHistoryUpdates(afterUndo.future[0]!, "redo")).toEqual([
      {
        recordId: record.id,
        fieldId: "name",
        value: "After",
        expectedRevision: 6,
      },
    ])

    const afterRedo = completeGridRedo(afterUndo, [
      { recordId: record.id, revision: 7 },
    ])
    expect(afterRedo.future).toHaveLength(0)
    expect(afterRedo.past[0]?.expectedRevisions).toEqual([
      { recordId: record.id, revision: 7 },
    ])
  })

  it("drops no-op writes and clears redo when a new edit is recorded", () => {
    expect(
      changedGridCellUpdates(
        [
          {
            recordId: record.id,
            fieldId: "name",
            value: "Before",
            expectedRevision: 4,
          },
          {
            recordId: record.id,
            fieldId: "tags",
            value: ["one"],
            expectedRevision: 4,
          },
        ],
        [record],
      ),
    ).toEqual([])

    const first = createGridHistoryEntry(
      "Edit Name",
      [
        {
          recordId: record.id,
          fieldId: "name",
          value: "After",
          expectedRevision: 4,
        },
      ],
      [record],
      [{ recordId: record.id, revision: 5 }],
    )!
    const withRedo: GridEditHistory = {
      past: [],
      future: [first],
    }
    expect(recordGridHistory(withRedo, first).future).toEqual([])
  })

  it("keeps only the newest bounded history and retires oversized actions", () => {
    let history = EMPTY_GRID_EDIT_HISTORY
    for (let index = 0; index < MAX_GRID_HISTORY_ENTRIES + 5; index += 1) {
      const entry = createGridHistoryEntry(
        `Edit ${index}`,
        [
          {
            recordId: record.id,
            fieldId: "name",
            value: `After ${index}`,
            expectedRevision: index + 4,
          },
        ],
        [record],
        [{ recordId: record.id, revision: index + 5 }],
      )!
      history = recordGridHistory(history, entry)
    }
    expect(history.past).toHaveLength(MAX_GRID_HISTORY_ENTRIES)
    expect(history.past[0]?.label).toBe("Edit 5")

    const oversized = createGridHistoryEntry(
      "Very large edit",
      [
        {
          recordId: record.id,
          fieldId: "name",
          value: "x".repeat(MAX_GRID_HISTORY_BYTES),
          expectedRevision: 4,
        },
      ],
      [record],
      [{ recordId: record.id, revision: 5 }],
    )!
    expect(recordGridHistory(history, oversized)).toEqual(
      EMPTY_GRID_EDIT_HISTORY,
    )
  })
})
