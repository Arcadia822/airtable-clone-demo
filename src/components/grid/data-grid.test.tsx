import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { toast } from "sonner"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  DataGrid,
  type GridCellBatchFailure,
  type GridCellBatchResult,
  type GridCellBatchUpdate,
  type GridFieldRenameFailure,
  type GridFieldReorderFailure,
} from "@/components/grid/data-grid"
import type {
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"
import type { ConnectionHealth } from "@/lib/connection-health"

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({
    count,
    estimateSize,
  }: {
    count: number
    estimateSize: (index: number) => number
  }) => {
    const renderedCount = count > 40 ? 24 : count
    const items = Array.from({ length: renderedCount }, (_, index) => ({
      index,
      key: index,
      start: index * estimateSize(index),
      size: estimateSize(index),
      end: (index + 1) * estimateSize(index),
      lane: 0,
    }))
    return {
      getVirtualItems: () => items,
      getTotalSize: () =>
        Array.from({ length: count }, (_, index) =>
          estimateSize(index),
        ).reduce((total, size) => total + size, 0),
      measure: vi.fn(),
      scrollToIndex: vi.fn(),
    }
  },
}))

vi.mock("@/components/grid/cell-editor", () => ({
  CellEditor: ({
    ariaLabel,
    onCommit,
    value,
  }: {
    ariaLabel: string
    onCommit: (value: string) => void
    value: unknown
  }) => (
    <button
      aria-label={`Commit ${ariaLabel}`}
      onClick={() => onCommit(`${String(value)} updated`)}
      type="button"
    >
      {typeof value === "string" ? value : ""}
    </button>
  ),
}))

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)
HTMLElement.prototype.scrollIntoView = vi.fn()
HTMLElement.prototype.setPointerCapture = vi.fn()
HTMLElement.prototype.releasePointerCapture = vi.fn()
HTMLElement.prototype.hasPointerCapture = vi.fn(() => true)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

const fields: FieldDefinition[] = [
  {
    id: "field_internal_name",
    name: "Initiative",
    type: "singleLineText",
    config: {},
    rank: "a",
    width: 240,
    isPrimary: true,
  },
]

const records: GridRecord[] = [
  {
    id: "record_internal_alpha",
    rank: "a",
    values: { field_internal_name: "Alpha launch" },
    revision: 7,
    createdAt: 1,
    createdBy: "A teammate",
    updatedAt: 2,
    updatedBy: "A teammate",
  },
  {
    id: "record_internal_beta",
    rank: "b",
    values: { field_internal_name: "Beta research" },
    revision: 4,
    createdAt: 1,
    createdBy: "A teammate",
    updatedAt: 2,
    updatedBy: "A teammate",
  },
]

function renderGrid(overrides?: {
  canManageSchema?: boolean
  connectionHealth?: ConnectionHealth
  fields?: FieldDefinition[]
  recordGroupCounts?: Readonly<Record<string, number>>
  recordGroupLabels?: Readonly<Record<string, string>>
  records?: GridRecord[]
  syncing?: boolean
  totalRecordCount?: number
  onAddField?: (
    field: Pick<FieldDefinition, "name" | "type" | "config">,
  ) => boolean | void | Promise<boolean | void>
  onDeleteRecords?: (
    records: GridRecord[],
  ) =>
    | boolean
    | void
    | { deletedRecords: GridRecord[] }
    | Promise<boolean | void | { deletedRecords: GridRecord[] }>
  onDuplicateRecords?: (
    records: GridRecord[],
  ) => boolean | void | Promise<boolean | void>
  onBatchUpdateCells?: (
    updates: GridCellBatchUpdate[],
  ) =>
    | GridCellBatchResult
    | GridCellBatchFailure
    | boolean
    | void
    | Promise<
        GridCellBatchResult | GridCellBatchFailure | boolean | void
      >
  onReorderField?: (
    fieldId: string,
    targetIndex: number,
  ) =>
    | boolean
    | void
    | GridFieldReorderFailure
    | Promise<boolean | void | GridFieldReorderFailure>
  onRenameField?: (
    fieldId: string,
    name: string,
  ) =>
    | boolean
    | void
    | GridFieldRenameFailure
    | Promise<boolean | void | GridFieldRenameFailure>
  onResizeField?: (fieldId: string, width: number) => void
}) {
  const onDeleteRecords =
    overrides?.onDeleteRecords ?? vi.fn(() => true)
  const onDuplicateRecords =
    overrides?.onDuplicateRecords ?? vi.fn(() => true)
  const onAddField = overrides?.onAddField ?? vi.fn(() => true)
  const onReorderField = overrides?.onReorderField ?? vi.fn()
  const onRenameField = overrides?.onRenameField
  const onResizeField = overrides?.onResizeField ?? vi.fn()
  render(
    <DataGrid
      canManageSchema={overrides?.canManageSchema ?? false}
      connectionHealth={overrides?.connectionHealth}
      fields={overrides?.fields ?? fields}
      onAddField={onAddField}
      onAddRecord={vi.fn()}
      onBatchUpdateCells={overrides?.onBatchUpdateCells}
      onDeleteField={vi.fn()}
      onDeleteRecords={onDeleteRecords}
      onDuplicateRecords={onDuplicateRecords}
      onReorderField={onReorderField}
      onRenameField={onRenameField}
      onResizeField={onResizeField}
      onUpdateCell={vi.fn()}
      recordGroupCounts={overrides?.recordGroupCounts}
      recordGroupLabels={overrides?.recordGroupLabels}
      records={overrides?.records ?? records}
      syncing={overrides?.syncing}
      totalRecordCount={overrides?.totalRecordCount}
    />,
  )
  return {
    onAddField,
    onDeleteRecords,
    onDuplicateRecords,
    onReorderField,
    onRenameField,
    onResizeField,
  }
}

describe("DataGrid record workflows", () => {
  it("shows the exact saved-view record count without exposing storage details", () => {
    renderGrid({ totalRecordCount: 1_234 })

    expect(screen.getByLabelText("Record count")).toHaveTextContent(
      "1,234 records",
    )
    expect(document.body).not.toHaveTextContent(/cursor|materialization|index/i)
  })

  it("finds select values by their visible label instead of their stored key", async () => {
    const statusField: FieldDefinition = {
      id: "field_internal_status",
      name: "Status",
      type: "singleSelect",
      config: {
        options: [
          {
            id: "status_in_progress",
            label: "In progress",
            color: "#6d5dfc",
          },
          {
            id: "status_done",
            label: "Done",
            color: "#0ea5a4",
          },
        ],
      },
      rank: "b",
      width: 160,
      isPrimary: false,
    }
    renderGrid({
      fields: [fields[0]!, statusField],
      records: [
        {
          ...records[0]!,
          values: {
            ...records[0]!.values,
            field_internal_status: "status_in_progress",
          },
        },
        {
          ...records[1]!,
          values: {
            ...records[1]!.values,
            field_internal_status: "status_done",
          },
        },
      ],
    })

    const search = screen.getByRole("textbox", {
      name: "Find records in view",
    })
    fireEvent.change(search, { target: { value: "In progress" } })
    await waitFor(() =>
      expect(
        screen.getByRole("grid", { name: "Records grid" }),
      ).toHaveAttribute("aria-rowcount", "2"),
    )

    fireEvent.change(search, { target: { value: "status_in_progress" } })
    await waitFor(() =>
      expect(
        screen.getByRole("grid", { name: "Records grid" }),
      ).toHaveAttribute("aria-rowcount", "1"),
    )
  })

  it("keeps a 1,000 by 50 table bounded while editing the correct far column", async () => {
    const wideFields: FieldDefinition[] = Array.from(
      { length: 50 },
      (_, index) => ({
        id: `field_${index + 1}`,
        name: `Column ${index + 1}`,
        type: "singleLineText",
        config: {},
        rank: String(index),
        width: 140,
        isPrimary: index === 0,
        frozen: index === 0,
      }),
    )
    const wideRecords: GridRecord[] = Array.from(
      { length: 1_000 },
      (_, recordIndex) => ({
        id: `record_${recordIndex + 1}`,
        rank: String(recordIndex),
        values: Object.fromEntries(
          wideFields.map((field, fieldIndex) => [
            field.id,
            `Record ${recordIndex + 1}, column ${fieldIndex + 1}`,
          ]),
        ),
        revision: 1,
        createdAt: 1,
        createdBy: "A teammate",
        updatedAt: 1,
        updatedBy: "A teammate",
      }),
    )
    const onBatchUpdateCells = vi.fn(
      async (
        updates: GridCellBatchUpdate[],
      ): Promise<GridCellBatchResult> => ({
        revisions: [
          ...new Map(
            updates.map((update) => [
              update.recordId,
              update.expectedRevision + 1,
            ]),
          ),
        ].map(([recordId, revision]) => ({ recordId, revision })),
      }),
    )

    renderGrid({
      fields: wideFields,
      records: wideRecords,
      onBatchUpdateCells,
    })

    const grid = screen.getByRole("grid", { name: "Records grid" })
    expect(grid).toHaveAttribute("aria-rowcount", "1001")
    expect(grid).toHaveAttribute("aria-colcount", "52")
    expect(screen.getAllByRole("columnheader").length).toBeLessThan(15)
    expect(screen.getAllByRole("gridcell").length).toBeLessThan(300)
    expect(screen.getByText("Record 1, column 1")).toBeInTheDocument()
    expect(
      screen.queryByText("Record 1000, column 1"),
    ).not.toBeInTheDocument()

    const scrollContainer = document.querySelector<HTMLElement>(
      "[data-grid-scroll-container]",
    )
    expect(scrollContainer).not.toBeNull()
    Object.defineProperty(scrollContainer!, "clientWidth", {
      configurable: true,
      value: 800,
    })
    scrollContainer!.scrollLeft = 6_200
    fireEvent.scroll(scrollContainer!)

    const farEditor = await screen.findByRole("button", {
      name: "Commit Column 50, record 1",
    })
    expect(
      screen.getByRole("columnheader", { name: /Column 1/ }),
    ).toHaveAttribute("aria-colindex", "2")
    expect(
      screen.getByRole("columnheader", { name: /Column 50/ }),
    ).toHaveAttribute("aria-colindex", "51")
    expect(screen.getAllByRole("columnheader").length).toBeLessThan(15)
    expect(screen.getAllByRole("gridcell").length).toBeLessThan(300)
    const farCell = farEditor.closest('[role="gridcell"]')
    expect(farCell).not.toBeNull()
    expect(farCell).toHaveAttribute("aria-colindex", "51")
    fireEvent.pointerDown(farCell!, { button: 0, pointerId: 1 })
    fireEvent.keyDown(grid, { key: "ArrowLeft" })

    const setClipboardData = vi.fn()
    fireEvent.copy(grid, {
      clipboardData: { setData: setClipboardData },
    })
    expect(setClipboardData).toHaveBeenCalledWith(
      "text/plain",
      '"Record 1, column 49"',
    )

    fireEvent.paste(grid, {
      clipboardData: { getData: () => "Far column updated" },
    })
    await waitFor(() =>
      expect(onBatchUpdateCells).toHaveBeenCalledWith([
        {
          recordId: "record_1",
          fieldId: "field_49",
          value: "Far column updated",
          expectedRevision: 1,
        },
      ]),
    )
    expect(document.body).not.toHaveTextContent(/field_49|record_1/)
  })

  it("keeps row numbers and the frozen required column visible while scrolling", () => {
    renderGrid({
      fields: [{ ...fields[0]!, frozen: true }],
    })

    expect(
      screen.getByRole("columnheader", { name: "Select records" }),
    ).toHaveClass("sticky", "left-0")
    expect(
      screen.getByRole("columnheader", { name: /Initiative/ }),
    ).toHaveClass("sticky")
    expect(screen.getAllByRole("rowheader")[0]).toHaveClass(
      "sticky",
      "left-0",
    )
    expect(screen.getAllByRole("gridcell")[0]).toHaveClass("sticky")
    expect(screen.getAllByRole("gridcell")[0]).toHaveStyle({ left: "64px" })
  })

  it("shows a readable offline state without connection internals", () => {
    renderGrid({
      connectionHealth: {
        kind: "offline",
        label: "Offline",
        description: "Reconnect to keep editing.",
        canStartWrite: false,
      },
    })

    expect(
      screen.getByRole("status", {
        name: "Offline. Reconnect to keep editing.",
      }),
    ).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/websocket|mutation|retry/i)
  })

  it("collapses and expands named record groups", () => {
    renderGrid({
      recordGroupCounts: {
        "Status: Planned": 41,
        "Status: Live": 59,
      },
      recordGroupLabels: {
        record_internal_alpha: "Status: Planned",
        record_internal_beta: "Status: Live",
      },
    })

    expect(screen.getByText("Alpha launch")).toBeInTheDocument()
    expect(screen.getByText("Beta research")).toBeInTheDocument()
    expect(screen.getByText("41 records")).toBeInTheDocument()
    expect(screen.getByText("59 records")).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("rowheader", {
        name: "Collapse group Status: Planned",
      }),
    )

    expect(screen.queryByText("Alpha launch")).not.toBeInTheDocument()
    expect(screen.getByText("Beta research")).toBeInTheDocument()
    expect(
      screen.getByRole("rowheader", {
        name: "Expand group Status: Planned",
      }),
    ).toHaveAttribute("aria-expanded", "false")
    const setClipboardData = vi.fn()
    fireEvent.pointerDown(screen.getAllByRole("gridcell")[0]!, {
      button: 0,
      pointerId: 1,
    })
    fireEvent.copy(screen.getByRole("grid", { name: "Records grid" }), {
      clipboardData: { setData: setClipboardData },
    })
    expect(setClipboardData).toHaveBeenCalledWith(
      "text/plain",
      "Beta research",
    )

    fireEvent.click(
      screen.getByRole("rowheader", {
        name: "Expand group Status: Planned",
      }),
    )
    expect(screen.getByText("Alpha launch")).toBeInTheDocument()
  })

  it("selects visible rows and duplicates only the current selection", async () => {
    const { onDuplicateRecords } = renderGrid()

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select record 1" }),
    )
    expect(
      screen.getByRole("checkbox", {
        name: "Select all 2 visible records",
      }),
    ).toHaveAttribute("aria-checked", "mixed")

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select all 2 visible records",
      }),
    )
    expect(
      screen.getByRole("toolbar", {
        name: "Selected record actions",
      }),
    ).toHaveTextContent("2 selected")

    fireEvent.click(
      screen.getByRole("button", {
        name: "Duplicate 2 selected records",
      }),
    )
    await waitFor(() =>
      expect(onDuplicateRecords).toHaveBeenCalledWith(records),
    )

    fireEvent.change(
      screen.getByRole("textbox", { name: "Find records in view" }),
      { target: { value: "Beta" } },
    )
    await waitFor(() =>
      expect(
        screen.getByRole("toolbar", {
          name: "Selected record actions",
        }),
      ).toHaveTextContent("1 selected"),
    )
    expect(
      screen.getByRole("checkbox", {
        name: "Select all 1 visible record",
      }),
    ).toBeChecked()
  })

  it("confirms destructive changes with names and no internal metadata", async () => {
    const onDeleteRecords = vi.fn(async (selected: GridRecord[]) => ({
      deletedRecords: selected,
    }))
    renderGrid({ onDeleteRecords })

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select all 2 visible records",
      }),
    )
    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete 2 selected records",
      }),
    )

    expect(
      screen.getByRole("heading", { name: "Delete 2 records?" }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/“Alpha launch”, “Beta research” will be removed/),
    ).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent("record_internal")
    expect(document.body).not.toHaveTextContent("field_internal")
    expect(document.body).not.toHaveTextContent("revision")

    fireEvent.click(
      screen.getByRole("button", { name: "Delete 2 records" }),
    )
    await waitFor(() =>
      expect(onDeleteRecords).toHaveBeenCalledWith(records),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("toolbar", {
          name: "Selected record actions",
        }),
      ).not.toBeInTheDocument(),
    )
  })
})

describe("DataGrid accessibility and feedback", () => {
  const workflowFields: FieldDefinition[] = [
    { ...fields[0]!, frozen: true },
    {
      id: "field_internal_owner",
      name: "Owner",
      type: "singleLineText",
      config: {},
      rank: "b",
      width: 180,
      isPrimary: false,
    },
    {
      id: "field_internal_status",
      name: "Status",
      type: "singleLineText",
      config: {},
      rank: "c",
      width: 160,
      isPrimary: false,
    },
  ]

  it("exposes complete grid semantics and keyboard guidance", async () => {
    renderGrid({
      fields: workflowFields,
      syncing: true,
    })

    const grid = screen.getByRole("grid", { name: "Records grid" })
    expect(grid).toHaveAttribute("aria-rowcount", "3")
    expect(grid).toHaveAttribute("aria-colcount", "5")
    expect(grid).toHaveAttribute("aria-multiselectable", "true")
    expect(grid).toHaveAttribute("aria-busy", "true")
    const instructionsId = grid.getAttribute("aria-describedby")
    expect(instructionsId).toBeTruthy()
    expect(document.getElementById(instructionsId!)).toHaveTextContent(
      /arrow keys to move between cells/i,
    )
    expect(document.getElementById(instructionsId!)).toHaveTextContent(
      /hold Alt.*resize the active column/i,
    )
    expect(
      screen.getByRole("columnheader", { name: /Owner/ }),
    ).toHaveAttribute("aria-colindex", "3")
    expect(
      document.querySelector(
        '[data-grid-row="0"][data-grid-column="1"]',
      ),
    ).toHaveAttribute("aria-colindex", "3")
    expect(screen.getAllByRole("row")[0]).toHaveAttribute(
      "aria-rowindex",
      "1",
    )
    expect(screen.getAllByRole("row")[1]).toHaveAttribute(
      "aria-rowindex",
      "2",
    )
    expect(grid.className).toContain("focus-visible:ring-2")

    grid.focus()
    fireEvent.keyDown(grid, { key: "ArrowRight" })
    await waitFor(() =>
      expect(grid).toHaveAttribute(
        "aria-activedescendant",
        "grid-cell-0-1",
      ),
    )
  })

  it("announces keyboard resize and menu reorder using column names", async () => {
    const onReorderField = vi.fn()
    const onResizeField = vi.fn()
    renderGrid({
      canManageSchema: true,
      fields: workflowFields,
      onReorderField,
      onResizeField,
    })

    const announcer = document.querySelector("[data-grid-announcer]")
    const resize = screen.getByRole("separator", {
      name: "Resize Status column",
    })
    expect(resize).toHaveAttribute("aria-valuetext", "160 pixels")
    fireEvent.keyDown(resize, { key: "ArrowRight" })
    expect(onResizeField).toHaveBeenCalledWith(
      "field_internal_status",
      180,
    )
    expect(announcer).toHaveTextContent("Status width is now 180 pixels.")
    expect(announcer).toHaveAttribute("aria-live", "polite")

    fireEvent.click(
      screen.getByRole("button", { name: "Open Status menu" }),
    )
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Move left" }),
    )
    expect(onReorderField).toHaveBeenCalledWith(
      "field_internal_status",
      1,
    )
    expect(announcer).toHaveTextContent("Status moved to column 2.")
    expect(announcer).not.toHaveTextContent(/field_internal|revision/i)
  })

  it("resizes and reorders the active column without leaving the grid", async () => {
    const onReorderField = vi.fn()
    const onResizeField = vi.fn()
    renderGrid({
      canManageSchema: true,
      fields: workflowFields,
      onReorderField,
      onResizeField,
    })

    const grid = screen.getByRole("grid", { name: "Records grid" })
    grid.focus()
    fireEvent.keyDown(grid, { key: "ArrowRight" })
    fireEvent.keyDown(grid, { key: "ArrowRight" })
    await waitFor(() =>
      expect(grid).toHaveAttribute(
        "aria-activedescendant",
        "grid-cell-0-2",
      ),
    )

    fireEvent.keyDown(grid, { altKey: true, key: "ArrowRight" })
    expect(onResizeField).toHaveBeenCalledWith(
      "field_internal_status",
      180,
    )
    expect(document.querySelector("[data-grid-announcer]")).toHaveTextContent(
      "Status width is now 180 pixels.",
    )

    fireEvent.keyDown(grid, {
      altKey: true,
      shiftKey: true,
      key: "ArrowLeft",
    })
    expect(onReorderField).toHaveBeenCalledWith(
      "field_internal_status",
      1,
    )
    expect(document.querySelector("[data-grid-announcer]")).toHaveTextContent(
      "Status moved to column 2.",
    )
    expect(grid).toHaveFocus()
  })

  it("previews a dragged column width and persists it only once on release", () => {
    const onResizeField = vi.fn()
    renderGrid({
      canManageSchema: true,
      fields: workflowFields,
      onResizeField,
    })

    const resize = screen.getByRole("separator", {
      name: "Resize Status column",
    })
    fireEvent.pointerDown(resize, {
      button: 0,
      clientX: 100,
      pointerId: 7,
    })
    fireEvent.pointerMove(resize, { clientX: 120, pointerId: 7 })
    fireEvent.pointerMove(resize, { clientX: 180, pointerId: 7 })
    fireEvent.pointerMove(resize, { clientX: 240, pointerId: 7 })

    expect(resize).toHaveAttribute("aria-valuenow", "300")
    expect(onResizeField).not.toHaveBeenCalled()

    fireEvent.pointerUp(resize, { clientX: 240, pointerId: 7 })
    expect(onResizeField).toHaveBeenCalledTimes(1)
    expect(onResizeField).toHaveBeenCalledWith(
      "field_internal_status",
      300,
    )
  })

  it("renames a header inline, previews immediately, and rolls back a failed save", async () => {
    let finishRename:
      | ((outcome: boolean | GridFieldRenameFailure) => void)
      | undefined
    const onRenameField = vi.fn(
      () =>
        new Promise<boolean | GridFieldRenameFailure>((resolve) => {
          finishRename = resolve
        }),
    )
    renderGrid({
      canManageSchema: true,
      fields: workflowFields,
      onRenameField,
    })

    fireEvent.doubleClick(
      screen.getByRole("columnheader", { name: /Status/ }),
    )
    const renameInput = screen.getByRole("textbox", {
      name: "Rename Status column",
    })
    fireEvent.change(renameInput, { target: { value: "Phase" } })
    fireEvent.keyDown(renameInput, { key: "Enter" })

    expect(onRenameField).toHaveBeenCalledTimes(1)
    expect(onRenameField).toHaveBeenCalledWith(
      "field_internal_status",
      "Phase",
    )
    expect(
      screen.getByRole("columnheader", { name: /Phase/ }),
    ).toBeInTheDocument()
    expect(document.querySelector("[data-grid-announcer]")).toHaveTextContent(
      "Status renamed to Phase.",
    )

    finishRename?.({
      saved: false,
      message: "A column with this name already exists.",
    })
    await waitFor(() =>
      expect(
        screen.getByRole("columnheader", { name: /Status/ }),
      ).toBeInTheDocument(),
    )
    expect(toast.error).toHaveBeenCalledWith(
      "Column name was not saved",
      expect.objectContaining({
        description: "A column with this name already exists.",
      }),
    )
  })

  it("rejects a duplicate inline name before sending a write", () => {
    const onRenameField = vi.fn()
    renderGrid({
      canManageSchema: true,
      fields: workflowFields,
      onRenameField,
    })

    fireEvent.doubleClick(
      screen.getByRole("columnheader", { name: /Status/ }),
    )
    const renameInput = screen.getByRole("textbox", {
      name: "Rename Status column",
    })
    fireEvent.change(renameInput, { target: { value: " owner " } })
    fireEvent.keyDown(renameInput, { key: "Enter" })

    expect(onRenameField).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      "Column name already used",
      expect.objectContaining({
        description: "Choose a different name.",
      }),
    )
    expect(renameInput).toBeInTheDocument()
  })

  it("shows a stable drop target and rolls back a failed column reorder", async () => {
    let finishReorder: ((saved: boolean) => void) | undefined
    const onReorderField = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishReorder = resolve
        }),
    )
    renderGrid({
      canManageSchema: true,
      fields: workflowFields,
      onReorderField,
    })

    const statusHeader = screen.getByRole("columnheader", {
      name: /Status/,
    })
    const ownerHeader = screen.getByRole("columnheader", {
      name: /Owner/,
    })
    vi.spyOn(ownerHeader, "getBoundingClientRect").mockReturnValue({
      bottom: 40,
      height: 40,
      left: 100,
      right: 300,
      top: 0,
      width: 200,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    })
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => ownerHeader),
    })

    fireEvent.pointerDown(statusHeader, {
      button: 0,
      clientX: 400,
      clientY: 20,
      pointerId: 7,
    })
    fireEvent.pointerMove(statusHeader, {
      clientX: 110,
      clientY: 20,
      pointerId: 7,
    })

    const namedHeaderOrder = () =>
      screen
        .getAllByRole("columnheader")
        .map((header) => header.textContent)
        .filter((label) =>
          ["Initiative", "Owner", "Status"].includes(label ?? ""),
        )
    expect(namedHeaderOrder()).toEqual([
      "Initiative",
      "Owner",
      "Status",
    ])
    expect(ownerHeader.className).toContain("shadow-[")
    expect(onReorderField).not.toHaveBeenCalled()

    fireEvent.pointerUp(window, {
      clientX: 110,
      clientY: 20,
      pointerId: 7,
    })
    expect(onReorderField).toHaveBeenCalledWith(
      "field_internal_status",
      1,
    )
    expect(document.querySelector("[data-grid-announcer]")).toHaveTextContent(
      "Status moved to column 2.",
    )

    finishReorder?.(false)
    await waitFor(() =>
      expect(namedHeaderOrder()).toEqual([
        "Initiative",
        "Owner",
        "Status",
      ]),
    )
    expect(document.querySelector("[data-grid-announcer]")).toHaveTextContent(
      /Column order was not saved.*Status returned to its previous position/i,
    )
    expect(document.body).not.toHaveTextContent(
      /field_internal|revision/i,
    )
  })

  it("moves focus into column customization and restores it on close", async () => {
    renderGrid({
      canManageSchema: true,
      fields: workflowFields,
    })

    const trigger = screen.getByRole("button", { name: "Add column" })
    trigger.focus()
    fireEvent.click(trigger)
    const nameInput = await screen.findByRole("textbox", {
      name: "Column name",
    })
    await waitFor(() => expect(nameInput).toHaveFocus())
    const columnType = screen.getByRole("combobox", {
      name: "Column type",
    })
    expect(columnType).toHaveValue("singleLineText")
    expect(
      screen.getByRole("option", { name: "Short text" }),
    ).toBeInTheDocument()

    fireEvent.change(columnType, { target: { value: "date" } })
    const dateStyle = await screen.findByRole("combobox", {
      name: "Date input",
    })
    expect(dateStyle).toHaveValue("date")
    fireEvent.change(dateStyle, { target: { value: "dateTime" } })
    expect(dateStyle).toHaveValue("dateTime")

    fireEvent.change(columnType, { target: { value: "attachment" } })
    const acceptedFiles = await screen.findByRole("radiogroup", {
      name: "Accepted files",
    })
    expect(
      screen.getByRole("radio", { name: "Any" }),
    ).toHaveAttribute("aria-checked", "true")
    const nonImageFiles = screen.getByRole("radio", {
      name: "Files",
    })
    fireEvent.click(nonImageFiles)
    expect(nonImageFiles).toHaveAttribute("aria-checked", "true")
    expect(acceptedFiles).toHaveTextContent("Files")

    fireEvent.keyDown(nameInput, { key: "Escape" })
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Customize new column" }),
      ).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it("validates and saves friendly text and numeric boundaries for new columns", async () => {
    const onAddField = vi.fn(() => true)
    renderGrid({
      canManageSchema: true,
      fields: workflowFields,
      onAddField,
    })

    fireEvent.click(screen.getByRole("button", { name: "Add column" }))
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Column name" }),
      { target: { value: "Customer note" } },
    )
    const maximumCharacters = screen.getByRole("spinbutton", {
      name: "Maximum characters",
    })
    fireEvent.change(maximumCharacters, { target: { value: "10001" } })
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Maximum characters must be a whole number from 1 to 10,000.",
    )
    expect(
      screen.getByRole("button", { name: "Create column" }),
    ).toBeDisabled()

    fireEvent.change(maximumCharacters, { target: { value: "500" } })
    fireEvent.click(screen.getByRole("button", { name: "Create column" }))
    await waitFor(() =>
      expect(onAddField).toHaveBeenCalledWith({
        name: "Customer note",
        type: "singleLineText",
        config: { maxLength: 500 },
      }),
    )

    fireEvent.click(screen.getByRole("button", { name: "Add column" }))
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Column name" }),
      { target: { value: "Estimate" } },
    )
    const columnType = screen.getByRole("combobox", {
      name: "Column type",
    })
    fireEvent.change(columnType, { target: { value: "number" } })

    fireEvent.change(
      await screen.findByRole("spinbutton", { name: "Minimum allowed" }),
      { target: { value: "20" } },
    )
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Maximum allowed" }),
      { target: { value: "10" } },
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Minimum cannot be greater than maximum.",
    )
    expect(
      screen.getByRole("button", { name: "Create column" }),
    ).toBeDisabled()

    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Maximum allowed" }),
      { target: { value: "100" } },
    )
    fireEvent.click(screen.getByRole("button", { name: "Create column" }))
    await waitFor(() =>
      expect(onAddField).toHaveBeenLastCalledWith({
        name: "Estimate",
        type: "number",
        config: { precision: 0, min: 20, max: 100 },
      }),
    )
    expect(document.body).not.toHaveTextContent(
      /singleLineText|field_internal|maps to/i,
    )
  })

  it("announces successful and failed paste outcomes politely", async () => {
    const onBatchUpdateCells = vi
      .fn<
        (
          updates: GridCellBatchUpdate[],
        ) => Promise<GridCellBatchResult | GridCellBatchFailure>
      >()
      .mockResolvedValueOnce({
        revisions: [
          { recordId: "record_internal_alpha", revision: 8 },
        ],
      })
      .mockResolvedValueOnce({
        saved: false,
        message:
          "Someone else updated this item. Refresh to see their changes, then try again.",
      })
    renderGrid({ onBatchUpdateCells })

    const grid = screen.getByRole("grid", { name: "Records grid" })
    const cell = screen.getAllByRole("gridcell")[0]!
    fireEvent.pointerDown(cell, { button: 0, pointerId: 1 })
    fireEvent.paste(grid, {
      clipboardData: { getData: () => "First update" },
    })
    const announcer = document.querySelector("[data-grid-announcer]")
    await waitFor(() =>
      expect(announcer).toHaveTextContent("1 cell pasted"),
    )

    fireEvent.paste(grid, {
      clipboardData: { getData: () => "Second update" },
    })
    await waitFor(() =>
      expect(announcer).toHaveTextContent(
        /Paste was not saved.*Someone else updated this item/i,
      ),
    )
    expect(announcer).toHaveAttribute("aria-live", "polite")
    expect(announcer).not.toHaveTextContent(
      /record_internal|field_internal|revision/i,
    )
  })
})

describe("DataGrid large paste batching", () => {
  const pasteFields: FieldDefinition[] = Array.from(
    { length: 50 },
    (_, index) => ({
      id: `paste_field_${index}`,
      name: `Paste column ${index + 1}`,
      type: "singleLineText",
      config: {},
      rank: String(index),
      width: 120,
      isPrimary: index === 0,
    }),
  )
  const pasteRecords: GridRecord[] = Array.from(
    { length: 12 },
    (_, recordIndex) => ({
      id: `paste_record_${recordIndex}`,
      rank: String(recordIndex),
      values: Object.fromEntries(
        pasteFields.map((field) => [field.id, "Before"]),
      ),
      revision: 1,
      createdAt: 1,
      createdBy: "A teammate",
      updatedAt: 1,
      updatedBy: "A teammate",
    }),
  )
  const clipboard = Array.from({ length: 12 }, (_, rowIndex) =>
    Array.from(
      { length: 50 },
      (_, columnIndex) => `R${rowIndex + 1} C${columnIndex + 1}`,
    ).join("\t"),
  ).join("\n")

  function successfulResult(
    updates: GridCellBatchUpdate[],
  ): GridCellBatchResult {
    return {
      revisions: [
        ...new Map(
          updates.map((update) => [
            update.recordId,
            update.expectedRevision + 1,
          ]),
        ),
      ].map(([recordId, revision]) => ({ recordId, revision })),
    }
  }

  it("saves more than 500 pasted cells in bounded mutations with one summary", async () => {
    const successToast = vi.spyOn(toast, "success")
    const onBatchUpdateCells = vi.fn(async (updates: GridCellBatchUpdate[]) =>
      successfulResult(updates),
    )
    renderGrid({
      fields: pasteFields,
      records: pasteRecords,
      onBatchUpdateCells,
    })
    const grid = screen.getByRole("grid", { name: "Records grid" })
    fireEvent.pointerDown(screen.getAllByRole("gridcell")[0]!, {
      button: 0,
      pointerId: 1,
    })
    fireEvent.paste(grid, {
      clipboardData: { getData: () => clipboard },
    })

    await waitFor(() =>
      expect(onBatchUpdateCells).toHaveBeenCalledTimes(2),
    )
    expect(
      onBatchUpdateCells.mock.calls.map(([updates]) => updates.length),
    ).toEqual([500, 100])
    await waitFor(() =>
      expect(document.querySelector("[data-grid-announcer]")).toHaveTextContent(
        "600 cells pasted",
      ),
    )
    expect(successToast).toHaveBeenCalledTimes(1)
    expect(successToast).toHaveBeenCalledWith("600 cells pasted")
  })

  it("keeps the saved prefix undoable and reports one failed-chunk summary", async () => {
    const errorToast = vi.spyOn(toast, "error")
    const onBatchUpdateCells = vi
      .fn<
        (
          updates: GridCellBatchUpdate[],
        ) => Promise<GridCellBatchResult | GridCellBatchFailure>
      >()
      .mockImplementationOnce(async (updates) => successfulResult(updates))
      .mockResolvedValueOnce({
        saved: false,
        message: "The remaining changes could not be saved.",
      })
    renderGrid({
      fields: pasteFields,
      records: pasteRecords,
      onBatchUpdateCells,
    })
    const grid = screen.getByRole("grid", { name: "Records grid" })
    fireEvent.pointerDown(screen.getAllByRole("gridcell")[0]!, {
      button: 0,
      pointerId: 1,
    })
    fireEvent.paste(grid, {
      clipboardData: { getData: () => clipboard },
    })

    await waitFor(() =>
      expect(document.querySelector("[data-grid-announcer]")).toHaveTextContent(
        /Paste was partly saved.*500 cells were saved.*100 cells were not changed/i,
      ),
    )
    expect(onBatchUpdateCells).toHaveBeenCalledTimes(2)
    expect(errorToast).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole("button", { name: "Undo Paste 500 cells" }),
    ).toBeEnabled()
    expect(document.body).not.toHaveTextContent(
      /paste_record_|paste_field_|revision/i,
    )
  })
})

describe("DataGrid edit history", () => {
  it("undoes and redoes a cell edit with expected revisions and keyboard shortcuts", async () => {
    const onBatchUpdateCells = vi.fn(
      async (
        updates: GridCellBatchUpdate[],
      ): Promise<GridCellBatchResult> => ({
        revisions: [
          ...new Map(
            updates.map((update) => [
              update.recordId,
              update.expectedRevision + 1,
            ]),
          ),
        ].map(([recordId, revision]) => ({ recordId, revision })),
      }),
    )
    renderGrid({ onBatchUpdateCells })

    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled()
    fireEvent.click(
      screen.getByRole("button", {
        name: "Commit Initiative, record 1",
      }),
    )

    await waitFor(() =>
      expect(onBatchUpdateCells).toHaveBeenNthCalledWith(1, [
        {
          recordId: "record_internal_alpha",
          fieldId: "field_internal_name",
          value: "Alpha launch updated",
          expectedRevision: 7,
        },
      ]),
    )
    expect(
      screen.getByRole("button", { name: "Undo Edit Initiative" }),
    ).toBeEnabled()
    expect(document.body).not.toHaveTextContent("record_internal")
    expect(document.body).not.toHaveTextContent("field_internal")
    expect(document.body).not.toHaveTextContent("revision")

    fireEvent.keyDown(screen.getByRole("grid", { name: "Records grid" }), {
      key: "z",
      ctrlKey: true,
    })
    await waitFor(() =>
      expect(onBatchUpdateCells).toHaveBeenNthCalledWith(2, [
        {
          recordId: "record_internal_alpha",
          fieldId: "field_internal_name",
          value: "Alpha launch",
          expectedRevision: 8,
        },
      ]),
    )
    expect(
      screen.getByRole("button", { name: "Redo Edit Initiative" }),
    ).toBeEnabled()

    fireEvent.keyDown(screen.getByRole("grid", { name: "Records grid" }), {
      key: "y",
      ctrlKey: true,
    })
    await waitFor(() =>
      expect(onBatchUpdateCells).toHaveBeenNthCalledWith(3, [
        {
          recordId: "record_internal_alpha",
          fieldId: "field_internal_name",
          value: "Alpha launch updated",
          expectedRevision: 9,
        },
      ]),
    )
  })

  it("records a paste as one undoable spreadsheet action", async () => {
    const onBatchUpdateCells = vi.fn(
      async (
        updates: GridCellBatchUpdate[],
      ): Promise<GridCellBatchResult> => ({
        revisions: [
          {
            recordId: updates[0]!.recordId,
            revision: updates[0]!.expectedRevision + 1,
          },
        ],
      }),
    )
    renderGrid({ onBatchUpdateCells })
    const grid = screen.getByRole("grid", { name: "Records grid" })
    fireEvent.pointerDown(screen.getAllByRole("gridcell")[0]!, {
      button: 0,
      pointerId: 1,
    })
    fireEvent.paste(grid, {
      clipboardData: { getData: () => "Pasted value" },
    })

    await waitFor(() =>
      expect(onBatchUpdateCells).toHaveBeenNthCalledWith(1, [
        {
          recordId: "record_internal_alpha",
          fieldId: "field_internal_name",
          value: "Pasted value",
          expectedRevision: 7,
        },
      ]),
    )
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Undo Paste 1 cell",
      }),
    )
    await waitFor(() =>
      expect(onBatchUpdateCells).toHaveBeenNthCalledWith(2, [
        {
          recordId: "record_internal_alpha",
          fieldId: "field_internal_name",
          value: "Alpha launch",
          expectedRevision: 8,
        },
      ]),
    )
  })

  it("records clearing selected cells as one undoable spreadsheet action", async () => {
    const onBatchUpdateCells = vi.fn(
      async (
        updates: GridCellBatchUpdate[],
      ): Promise<GridCellBatchResult> => ({
        revisions: [
          {
            recordId: updates[0]!.recordId,
            revision: updates[0]!.expectedRevision + 1,
          },
        ],
      }),
    )
    renderGrid({ onBatchUpdateCells })
    const grid = screen.getByRole("grid", { name: "Records grid" })
    fireEvent.pointerDown(screen.getAllByRole("gridcell")[0]!, {
      button: 0,
      pointerId: 1,
    })
    fireEvent.keyDown(grid, { key: "Delete" })

    await waitFor(() =>
      expect(onBatchUpdateCells).toHaveBeenNthCalledWith(1, [
        {
          recordId: "record_internal_alpha",
          fieldId: "field_internal_name",
          value: null,
          expectedRevision: 7,
        },
      ]),
    )
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Undo Clear 1 cell",
      }),
    )
    await waitFor(() =>
      expect(onBatchUpdateCells).toHaveBeenNthCalledWith(2, [
        {
          recordId: "record_internal_alpha",
          fieldId: "field_internal_name",
          value: "Alpha launch",
          expectedRevision: 8,
        },
      ]),
    )
  })

  it("retires stale history and explains that newer teammate data was kept", async () => {
    const conflictMessage =
      "Someone else updated this item. Refresh to see their changes, then try again."
    const onBatchUpdateCells = vi
      .fn<
        (
          updates: GridCellBatchUpdate[],
        ) => Promise<GridCellBatchResult | GridCellBatchFailure>
      >()
      .mockResolvedValueOnce({
        revisions: [
          { recordId: "record_internal_alpha", revision: 8 },
        ],
      })
      .mockResolvedValueOnce({
        saved: false,
        message: conflictMessage,
      })
    const errorToast = vi.spyOn(toast, "error")
    renderGrid({ onBatchUpdateCells })

    fireEvent.click(
      screen.getByRole("button", {
        name: "Commit Initiative, record 1",
      }),
    )
    const undo = await screen.findByRole("button", {
      name: "Undo Edit Initiative",
    })
    await waitFor(() => expect(undo).toBeEnabled())
    fireEvent.click(undo)

    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith("Undo stopped", {
        description: conflictMessage,
      }),
    )
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled()
  })
})
