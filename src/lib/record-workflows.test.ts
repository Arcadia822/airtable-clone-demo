import { describe, expect, it } from "vitest"

import type {
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"
import {
  chunkBulkRecords,
  duplicateRecordValues,
  pruneRecordSelection,
  recordDeletionDescription,
  selectedVisibleRecords,
  toggleRecordSelection,
  toggleVisibleRecordSelection,
} from "@/lib/record-workflows"

const fields: FieldDefinition[] = [
  {
    id: "name",
    name: "Name",
    type: "singleLineText",
    config: {},
    rank: "a",
    width: 220,
    isPrimary: true,
  },
  {
    id: "status",
    name: "Status",
    type: "multiSelect",
    config: {},
    rank: "b",
    width: 180,
    isPrimary: false,
  },
  {
    id: "files",
    name: "Files",
    type: "attachment",
    config: {},
    rank: "c",
    width: 180,
    isPrimary: false,
  },
  {
    id: "creator",
    name: "Created by",
    type: "createdBy",
    config: {},
    rank: "d",
    width: 180,
    isPrimary: false,
  },
]

function record(id: string, name: string): GridRecord {
  return {
    id,
    rank: id,
    values: {
      name,
      status: ["planned", "priority"],
      files: [
        {
          id: `attachment-${id}`,
          name: "brief.pdf",
          mimeType: "application/pdf",
          size: 1024,
        },
      ],
      creator: "A teammate",
    },
    revision: 3,
    createdAt: 1,
    createdBy: "A teammate",
    updatedAt: 2,
    updatedBy: "A teammate",
  }
}

describe("record selection workflows", () => {
  it("selects only visible records and prunes rows hidden by search", () => {
    const records = [
      record("alpha", "Alpha"),
      record("beta", "Beta"),
      record("gamma", "Gamma"),
    ]
    const selected = toggleVisibleRecordSelection(
      new Set(),
      records.map((item) => item.id),
      true,
    )
    expect(selectedVisibleRecords(records, selected)).toEqual(records)

    const visibleIds = new Set(["beta"])
    expect([...pruneRecordSelection(selected, visibleIds)]).toEqual(["beta"])
    expect(
      [...toggleRecordSelection(selected, "beta", false)],
    ).toEqual(["alpha", "gamma"])
  })

  it("copies writable values without files or generated metadata", () => {
    expect(duplicateRecordValues(record("alpha", "Alpha"), fields)).toEqual({
      name: "Alpha",
      status: ["planned", "priority"],
    })
  })

  it("chunks large selections to the Convex mutation boundary", () => {
    const records = Array.from({ length: 205 }, (_, index) => index)
    expect(chunkBulkRecords(records).map((chunk) => chunk.length)).toEqual([
      100,
      100,
      5,
    ])
  })

  it("writes human-readable confirmation copy without internal metadata", () => {
    const description = recordDeletionDescription([
      "Alpha",
      "Beta",
      "Gamma",
      "Delta",
    ])
    expect(description).toBe(
      "“Alpha”, “Beta”, “Gamma” and 1 more will be removed from this table for every collaborator.",
    )
    expect(description).not.toMatch(/revision|record[_-]|id/i)
  })
})
