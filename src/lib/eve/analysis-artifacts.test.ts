import { describe, expect, it } from "vitest"

import {
  assistantChartFromToolPart,
  assistantCitationFromToolPart,
  assistantCitationsFromToolPart,
  collectAssistantReportSources,
} from "./analysis-artifacts"

const tableSource = {
  kind: "table",
  base: { id: "base_private_123", name: "Product operations" },
  table: { id: "table_private_456", name: "Product roadmap" },
  fields: [
    { id: "field_status_private", name: "Status" },
    { id: "field_owner_private", name: "Owner" },
  ],
}

function summarizedTablePart() {
  return {
    type: "dynamic-tool",
    toolCallId: "call_private",
    toolName: "summarize_table",
    state: "output-available",
    input: {
      baseId: "base_private_123",
      tableId: "table_private_456",
      fieldIds: ["field_status_private"],
      groupByFieldId: "field_status_private",
    },
    output: {
      recordCount: 7,
      summaries: [],
      grouped: [
        { group: "Planned", count: 4 },
        { group: "Shipped", count: 3 },
      ],
      source: tableSource,
      truncated: false,
    },
  }
}

describe("assistant analysis artifacts", () => {
  it("builds a clickable citation from friendly resource names, never raw IDs", () => {
    const citation = assistantCitationFromToolPart(summarizedTablePart())

    expect(citation).toEqual({
      kind: "table",
      label: "Table · Product roadmap",
      href: "/bases/base_private_123/tables/table_private_456",
    })
    expect(citation?.label).not.toMatch(/base_private|table_private|Id/)
  })

  it("merges field provenance for the same named source", () => {
    const firstPart = summarizedTablePart()
    const secondPart = {
      ...firstPart,
      toolCallId: "call_private_2",
      output: {
        ...firstPart.output,
        source: {
          ...tableSource,
          fields: [{ id: "field_owner_private", name: "Owner" }],
        },
      },
    }

    expect(
      collectAssistantReportSources([
        { role: "assistant", parts: [firstPart, secondPart] },
      ]),
    ).toEqual([
      {
        kind: "table",
        baseId: "base_private_123",
        tableId: "table_private_456",
        fieldIds: ["field_status_private", "field_owner_private"],
        recordIds: [],
        queryDescriptions: [],
      },
    ])
  })

  it("links every inspected record by friendly name and retains the bounded query", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "list_records",
      state: "output-available",
      output: {
        records: [
          { id: "record_private_1", version: 1, values: {} },
          { id: "record_private_2", version: 1, values: {} },
        ],
        source: {
          ...tableSource,
          records: [
            { id: "record_private_1", name: "Atlas launch" },
            { id: "record_private_2", name: "Beacon launch" },
          ],
          query: {
            kind: "recordList",
            description:
              "Returned 2 records from Product roadmap using Status and Owner.",
            rowLimit: 25,
          },
        },
      },
    }

    expect(assistantCitationsFromToolPart(part)).toEqual([
      {
        kind: "table",
        label:
          "Query · Returned 2 records from Product roadmap using Status and Owner.",
        href: "/bases/base_private_123/tables/table_private_456",
      },
      {
        kind: "table",
        label: "Record · Atlas launch",
        href: "/bases/base_private_123/tables/table_private_456?record=record_private_1",
      },
      {
        kind: "table",
        label: "Record · Beacon launch",
        href: "/bases/base_private_123/tables/table_private_456?record=record_private_2",
      },
    ])
    expect(
      collectAssistantReportSources([
        { role: "assistant", parts: [part] },
      ]),
    ).toEqual([
      {
        kind: "table",
        baseId: "base_private_123",
        tableId: "table_private_456",
        fieldIds: ["field_status_private", "field_owner_private"],
        recordIds: ["record_private_1", "record_private_2"],
        queryDescriptions: [
          "Returned 2 records from Product roadmap using Status and Owner.",
        ],
      },
    ])
    const visibleLabels = assistantCitationsFromToolPart(part)
      .map((citation) => citation.label)
      .join(" ")
    expect(visibleLabels).not.toMatch(
      /base_private|table_private|field_status_private|record_private/,
    )
  })

  it("creates a chart only from supported structured aggregates", () => {
    expect(assistantChartFromToolPart(summarizedTablePart())).toEqual({
      type: "bar",
      title: "Product roadmap by Status",
      xLabel: "Status",
      yLabel: "Records",
      data: [
        { label: "Planned", value: 4 },
        { label: "Shipped", value: 3 },
      ],
    })

    expect(
      assistantChartFromToolPart({
        type: "dynamic-tool",
        toolName: "list_records",
        state: "output-available",
        output: {
          records: [{ id: "record_private", values: {} }],
          source: tableSource,
        },
      }),
    ).toBeUndefined()
  })

  it("builds a submissions trend from form analytics", () => {
    expect(
      assistantChartFromToolPart({
        type: "dynamic-tool",
        toolName: "form_analytics",
        state: "output-available",
        output: {
          series: [
            {
              date: "2026-07-29",
              views: 10,
              starts: 8,
              submissions: 6,
            },
            {
              date: "2026-07-30",
              views: 12,
              starts: 9,
              submissions: 7,
            },
          ],
          source: {
            kind: "formAnalytics",
            base: { id: "base_private_123", name: "Product operations" },
            table: {
              id: "table_private_456",
              name: "Customer feedback",
            },
            form: { id: "form_private_789", name: "Feedback intake" },
            fields: [],
          },
        },
      }),
    ).toEqual({
      type: "line",
      title: "Feedback intake submissions",
      xLabel: "Date",
      yLabel: "Submissions",
      data: [
        { label: "2026-07-29", value: 6 },
        { label: "2026-07-30", value: 7 },
      ],
    })
  })
})
