import { describe, expect, it } from "vitest"

import { createRecordsCsv, csvFileName } from "@/lib/csv-export"
import type { FieldDefinition, GridRecord } from "@/lib/domain"

const fields: FieldDefinition[] = [
  {
    id: "field_name",
    name: "Project name",
    type: "singleLineText",
    config: {},
    rank: "a",
    width: 200,
    isPrimary: true,
  },
  {
    id: "field_status",
    name: "Status",
    type: "singleSelect",
    config: {
      options: [
        { id: "option_private", label: "In progress", color: "#2563eb" },
      ],
    },
    rank: "b",
    width: 160,
    isPrimary: false,
  },
  {
    id: "field_files",
    name: "Files",
    type: "attachment",
    config: {},
    rank: "c",
    width: 200,
    isPrimary: false,
  },
]

const records: GridRecord[] = [
  {
    id: "record_private",
    rank: "a",
    revision: 1,
    createdAt: 0,
    createdBy: "Maya",
    updatedAt: 0,
    updatedBy: "Maya",
    values: {
      field_name: 'Launch, "phase two"',
      field_status: "option_private",
      field_files: [
        {
          id: "attachment_private",
          name: "brief.pdf",
          mimeType: "application/pdf",
          size: 42,
        },
      ],
    },
  },
]

describe("CSV export", () => {
  it("exports friendly names and values without internal references", () => {
    const csv = createRecordsCsv(fields, records)
    expect(csv).toContain("Project name,Status,Files")
    expect(csv).toContain('"Launch, ""phase two"""')
    expect(csv).toContain("In progress")
    expect(csv).toContain("brief.pdf")
    expect(csv).not.toMatch(/field_|record_|option_private|attachment_private/)
  })

  it("creates a safe, readable filename", () => {
    expect(csvFileName("Launch planning / Q3")).toBe(
      "launch-planning-q3.csv",
    )
    expect(csvFileName("   ")).toBe("records.csv")
  })
})
