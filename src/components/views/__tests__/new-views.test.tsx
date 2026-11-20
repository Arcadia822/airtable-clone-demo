import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { DashboardView } from "@/components/views/dashboard-view"
import { MobileRecordList } from "@/components/views/mobile-record-list"
import { TimelineView } from "@/components/views/timeline-view"
import { ViewControlsBar } from "@/components/workspace/view-controls-bar"
import type {
  DashboardWidgetConfig,
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"
import {
  buildDefaultDashboardWidgets,
  computeFieldSummary,
  computeGroupedSeries,
} from "@/lib/table-summary"

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(cleanup)

const nameField: FieldDefinition = {
  id: "field_name",
  name: "Initiative",
  type: "singleLineText",
  config: {},
  rank: "a",
  width: 240,
  isPrimary: true,
}

const statusField: FieldDefinition = {
  id: "field_status",
  name: "Status",
  type: "singleSelect",
  config: {
    options: [
      { id: "option_planned", label: "Planned", color: "#64748B" },
      { id: "option_live", label: "Live", color: "#10B981" },
    ],
  },
  rank: "b",
  width: 160,
  isPrimary: false,
}

const budgetField: FieldDefinition = {
  id: "field_budget",
  name: "Budget",
  type: "currency",
  config: { currency: "USD", precision: 2 },
  rank: "c",
  width: 160,
  isPrimary: false,
}

const startField: FieldDefinition = {
  id: "field_start",
  name: "Kickoff",
  type: "date",
  config: { dateStyle: "date" },
  rank: "d",
  width: 160,
  isPrimary: false,
}

const endField: FieldDefinition = {
  id: "field_end",
  name: "Ship date",
  type: "date",
  config: { dateStyle: "date" },
  rank: "e",
  width: 160,
  isPrimary: false,
}

const reviewField: FieldDefinition = {
  id: "field_review",
  name: "Review date",
  type: "date",
  config: { dateStyle: "date" },
  rank: "f",
  width: 160,
  isPrimary: false,
}

const autoNumberField: FieldDefinition = {
  id: "field_number",
  name: "Ticket",
  type: "autoNumber",
  config: {},
  rank: "g",
  width: 100,
  isPrimary: false,
}

const coverField: FieldDefinition = {
  id: "field_cover",
  name: "Cover image",
  type: "image",
  config: { attachmentKind: "image" },
  rank: "h",
  width: 200,
  isPrimary: false,
}

const fields: FieldDefinition[] = [
  nameField,
  statusField,
  budgetField,
  startField,
  endField,
  reviewField,
  autoNumberField,
  coverField,
]

function makeRecord(
  id: string,
  values: GridRecord["values"],
  revision = 1,
): GridRecord {
  const now = Date.now()
  return {
    id,
    rank: id,
    values,
    revision,
    createdAt: now,
    createdBy: "user_test",
    updatedAt: now,
    updatedBy: "user_test",
  }
}

const atlas = makeRecord(
  "record_atlas",
  {
    field_name: "Atlas launch",
    field_status: "option_planned",
    field_budget: 1200,
    field_start: "2026-03-02",
    field_end: "2026-03-06",
    field_number: 12,
    field_cover: [
      {
        id: "attachment_cover",
        name: "Atlas.png",
        mimeType: "image/png",
        size: 1024,
        url: "https://example.test/atlas.png",
      },
    ],
  },
  4,
)

const beacon = makeRecord("record_beacon", {
  field_name: "Beacon refresh",
  field_status: "option_live",
  field_budget: 800,
  field_start: "2026-03-10",
  field_end: "2026-03-12",
  field_number: 13,
})

const cobalt = makeRecord("record_cobalt", {
  field_name: "Cobalt audit",
  field_status: "option_planned",
  field_budget: null,
  field_start: null,
  field_number: 14,
})

const delta = makeRecord("record_delta", {
  field_name: "Delta migration",
  field_budget: 500,
  field_start: "2026-04-01",
  field_number: 15,
})

const records: GridRecord[] = [atlas, beacon, cobalt, delta]

describe("table summary engine", () => {
  it("summarises currency columns with sums, averages and completeness", () => {
    const summary = computeFieldSummary(records, budgetField)
    expect(summary.count).toBe(4)
    expect(summary.populatedCount).toBe(3)
    expect(summary.emptyCount).toBe(1)
    expect(summary.sum).toBe(2500)
    expect(summary.min).toBe(500)
    expect(summary.max).toBe(1200)
    expect(summary.avg).toBeCloseTo(833.333333, 5)
  })

  it("counts single-select options with their configured colours", () => {
    expect(computeGroupedSeries(records, statusField)).toEqual([
      { label: "Planned", value: 2, color: "#64748B" },
      { label: "Live", value: 1, color: "#10B981" },
      { label: "Unassigned", value: 1, color: "#94A3B8" },
    ])
  })

  it("sums a currency metric inside each select group", () => {
    expect(
      computeGroupedSeries(records, statusField, budgetField, "sum"),
    ).toEqual([
      { label: "Planned", value: 1200, color: "#64748B" },
      { label: "Live", value: 800, color: "#10B981" },
      { label: "Unassigned", value: 500, color: "#94A3B8" },
    ])
    expect(
      computeGroupedSeries(records, statusField, budgetField, "avg")[1],
    ).toEqual({ label: "Live", value: 800, color: "#10B981" })
  })

  it("groups dates by year-month and keeps undated records last", () => {
    const series = computeGroupedSeries(records, startField)
    expect(series.map((point) => point.label)).toEqual([
      "2026-03",
      "2026-04",
      "No date",
    ])
    expect(series.map((point) => point.value)).toEqual([2, 1, 1])
  })

  it("picks smart default widgets for a new dashboard", () => {
    const widgets = buildDefaultDashboardWidgets(fields)
    const metrics = widgets.filter((widget) => widget.kind === "metric")
    const charts = widgets.filter((widget) => widget.kind === "chart")

    expect(metrics).toHaveLength(3)
    expect(metrics.map((widget) => widget.aggregate)).toEqual([
      "count",
      "sum",
      "populated",
    ])
    expect(charts).toHaveLength(2)
    expect(charts[0]).toMatchObject({
      groupByFieldId: statusField.id,
      chartType: "bar",
      aggregate: "count",
    })
    expect(charts[1]).toMatchObject({
      groupByFieldId: startField.id,
      fieldId: budgetField.id,
      chartType: "line",
      aggregate: "sum",
    })
  })
})

describe("TimelineView", () => {
  it("renders scheduled bars, unscheduled records and switches scale", () => {
    const onUpdateCell = vi.fn()
    const onScaleChange = vi.fn()
    const onSelectDateFields = vi.fn()

    render(
      <TimelineView
        endField={endField}
        fields={fields}
        groupField={statusField}
        onScaleChange={onScaleChange}
        onSelectDateFields={onSelectDateFields}
        onUpdateCell={onUpdateCell}
        records={records}
        startField={startField}
      />,
    )

    expect(
      screen.getByRole("region", { name: "Timeline using Kickoff" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Planned" }),
    ).toBeInTheDocument()
    expect(screen.getByText("Unscheduled (1)")).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole("button", {
        name: "Set start date for Cobalt audit to today",
      }),
    )
    expect(onUpdateCell).toHaveBeenCalledWith(
      cobalt.id,
      startField.id,
      expect.any(String),
      cobalt.revision,
    )

    fireEvent.click(screen.getByRole("button", { name: "Month" }))
    expect(onScaleChange).toHaveBeenCalledWith("month")
    expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(screen.getByText("Mar 2026")).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("End date field"), {
      target: { value: reviewField.id },
    })
    expect(onSelectDateFields).toHaveBeenCalledWith(
      startField.id,
      reviewField.id,
    )

    fireEvent.click(screen.getByRole("button", { name: "Open Atlas launch" }))
    expect(
      screen.getByRole("dialog", { name: "Atlas launch" }),
    ).toBeInTheDocument()
  })
})

const dashboardWidgets: DashboardWidgetConfig[] = [
  {
    id: "widget_total",
    kind: "metric",
    title: "Total records",
    aggregate: "count",
    rank: "a0",
  },
  {
    id: "widget_budget",
    kind: "metric",
    title: "Total budget",
    fieldId: budgetField.id,
    aggregate: "sum",
    rank: "a1",
  },
  {
    id: "widget_status",
    kind: "chart",
    title: "Initiatives by status",
    groupByFieldId: statusField.id,
    aggregate: "count",
    chartType: "bar",
    rank: "a2",
  },
]

describe("DashboardView", () => {
  it("renders KPI tiles, charts and persists widget changes", () => {
    const onUpdateWidgets = vi.fn()
    render(
      <DashboardView
        fields={fields}
        onUpdateWidgets={onUpdateWidgets}
        records={records}
        widgets={dashboardWidgets}
      />,
    )

    const total = screen.getByRole("article", { name: "Total records metric" })
    expect(within(total).getByText("4")).toBeInTheDocument()

    const budget = screen.getByRole("article", { name: "Total budget metric" })
    expect(within(budget).getByText("$2,500.00")).toBeInTheDocument()

    const chartTable = screen.getByRole("table", {
      name: "Initiatives by status values",
    })
    expect(within(chartTable).getByText("Planned")).toBeInTheDocument()
    expect(within(chartTable).getByText("2")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Add widget" }))
    const dialog = screen.getByRole("dialog", { name: "Add widget" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Chart" }))
    fireEvent.change(within(dialog).getByLabelText("Group by"), {
      target: { value: statusField.id },
    })
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Add widget" }),
    )

    expect(onUpdateWidgets).toHaveBeenCalledTimes(1)
    const added = onUpdateWidgets.mock.calls[0]![0] as DashboardWidgetConfig[]
    expect(added).toHaveLength(4)
    expect(added[3]).toMatchObject({
      kind: "chart",
      groupByFieldId: statusField.id,
      aggregate: "count",
      chartType: "bar",
    })
    expect(
      screen.getByRole("article", { name: `${added[3]!.title} chart` }),
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Total budget" }),
    )
    expect(onUpdateWidgets).toHaveBeenCalledTimes(2)
    const removed = onUpdateWidgets.mock
      .calls[1]![0] as DashboardWidgetConfig[]
    expect(removed.map((widget) => widget.id)).not.toContain("widget_budget")
  })
})

describe("MobileRecordList", () => {
  it("renders tappable cards, filters them, and opens the record drawer", () => {
    const onAddRecord = vi.fn()
    const { container } = render(
      <MobileRecordList
        fields={fields}
        onAddRecord={onAddRecord}
        onUpdateCell={vi.fn()}
        records={records}
      />,
    )

    const atlasCard = screen.getByRole("button", {
      name: "Open Atlas launch",
    })
    expect(atlasCard).toBeInTheDocument()
    expect(screen.getByText("#12")).toBeInTheDocument()
    expect(within(atlasCard).getByText("Planned")).toBeInTheDocument()
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.test/atlas.png",
    )

    fireEvent.click(screen.getByRole("button", { name: "New record" }))
    expect(onAddRecord).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByLabelText("Search records"), {
      target: { value: "beacon" },
    })
    expect(screen.getByText("1 of 4 records")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Open Atlas launch" }),
    ).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Search records"), {
      target: { value: "" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Open Atlas launch" }))
    expect(
      screen.getByRole("dialog", { name: "Atlas launch" }),
    ).toBeInTheDocument()
  })
})

describe("ViewControlsBar", () => {
  const views = [
    { id: "view_grid", name: "All projects", type: "grid" as const },
    { id: "view_board", name: "Board", type: "kanban" as const },
  ]

  it("switches views, creates, renames and deletes views", () => {
    const onSelectView = vi.fn()
    const onCreateView = vi.fn()
    const onRenameView = vi.fn()
    const onDeleteView = vi.fn()
    const onSearchChange = vi.fn()
    const onOpenGlobalSearch = vi.fn()

    render(
      <ViewControlsBar
        activeViewId="view_grid"
        fields={fields.map((field) => ({
          id: field.id,
          name: field.name,
          type: field.type,
          config: field.config,
        }))}
        onControlsChange={vi.fn()}
        onCreateView={onCreateView}
        onDeleteView={onDeleteView}
        onOpenGlobalSearch={onOpenGlobalSearch}
        onRenameView={onRenameView}
        onSearchChange={onSearchChange}
        onSelectView={onSelectView}
        views={views}
      />,
    )

    expect(
      screen.getByRole("tablist", { name: "Views" }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: "Board" }))
    expect(onSelectView).toHaveBeenCalledWith("view_board")

    fireEvent.click(screen.getByRole("button", { name: "New view" }))
    fireEvent.click(screen.getByRole("button", { name: /Timeline/ }))
    expect(onCreateView).toHaveBeenCalledWith("timeline")

    fireEvent.click(screen.getByRole("button", { name: "Rename view" }))
    fireEvent.change(screen.getByLabelText("View name"), {
      target: { value: "Launch grid" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save name" }))
    expect(onRenameView).toHaveBeenCalledWith("view_grid", "Launch grid")

    fireEvent.click(
      screen.getByRole("button", { name: "Delete current view" }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Delete view" }))
    expect(onDeleteView).toHaveBeenCalledWith("view_grid")

    fireEvent.change(screen.getByLabelText("Search this table"), {
      target: { value: "atlas" },
    })
    expect(onSearchChange).toHaveBeenCalledWith("atlas")

    fireEvent.click(
      screen.getByRole("button", { name: "Open global search" }),
    )
    expect(onOpenGlobalSearch).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText("View settings")).toBeInTheDocument()
  })
})
