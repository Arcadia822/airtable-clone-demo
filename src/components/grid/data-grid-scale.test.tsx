import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import {
  afterAll,
  afterEach,
  beforeAll,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest"

import {
  DataGrid,
  type GridCellBatchResult,
  type GridCellBatchUpdate,
} from "@/components/grid/data-grid"
import type {
  CellValue,
  FieldDefinition,
  FieldType,
  GridRecord,
} from "@/lib/domain"

const cellRenderMetrics = vi.hoisted(() => ({
  counts: new Map<string, number>(),
}))
vi.mock("@/components/grid/cell-editor", () => ({
  CellEditor: ({
    ariaLabel,
    value,
  }: {
    ariaLabel: string
    value: unknown
  }) => {
    cellRenderMetrics.counts.set(
      ariaLabel,
      (cellRenderMetrics.counts.get(ariaLabel) ?? 0) + 1,
    )
    return (
      <button aria-label={`Edit ${ariaLabel}`} type="button">
        {typeof value === "string" ? value : ""}
      </button>
    )
  },
}))

const originalScrollTo = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollTo",
)
let boundingRect: MockInstance<() => DOMRect> | undefined

beforeAll(() => {
  boundingRect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(
      () =>
        ({
          bottom: 600,
          height: 600,
          left: 0,
          right: 1024,
          top: 0,
          width: 1024,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    )
  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(function (
      this: Element & { scrollLeft: number; scrollTop: number },
      options?: ScrollToOptions,
    ) {
      if (typeof options?.left === "number") this.scrollLeft = options.left
      if (typeof options?.top === "number") this.scrollTop = options.top
    }),
  })
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [
            {
              borderBoxSize: [
                {
                  blockSize: 600,
                  inlineSize: 1024,
                },
              ],
              contentBoxSize: [],
              contentRect: target.getBoundingClientRect(),
              devicePixelContentBoxSize: [],
              target,
            },
          ],
          this as unknown as ResizeObserver,
        )
      }
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  cleanup()
  cellRenderMetrics.counts.clear()
})

afterAll(() => {
  boundingRect?.mockRestore()
  if (originalScrollTo) {
    Object.defineProperty(Element.prototype, "scrollTo", originalScrollTo)
  } else {
    Reflect.deleteProperty(Element.prototype, "scrollTo")
  }
  vi.unstubAllGlobals()
})

it("bounds a real 1,000 record by 50 column grid and keeps logical editing", async () => {
  const fieldTypes: FieldType[] = [
    "singleLineText",
    "number",
    "currency",
    "percent",
    "checkbox",
    "date",
    "email",
    "url",
    "singleSelect",
    "multiSelect",
    "rating",
    "attachment",
  ]
  const fields: FieldDefinition[] = Array.from(
    { length: 50 },
    (_, index) => {
      const type = fieldTypes[index % fieldTypes.length]!
      return {
        id: `scale_field_${index + 1}`,
        name: `Column ${index + 1}`,
        type,
        config:
          type === "singleSelect" || type === "multiSelect"
            ? {
                options: [
                  {
                    id: "option_active",
                    label: "Active",
                    color: "#6d5dfc",
                  },
                  {
                    id: "option_planned",
                    label: "Planned",
                    color: "#0ea5a4",
                  },
                ],
              }
            : type === "currency"
              ? { currency: "USD", precision: 2 }
              : type === "percent"
                ? { precision: 0, min: 0, max: 100 }
                : type === "date"
                  ? { dateStyle: "date" as const }
                  : type === "rating"
                    ? { min: 1, max: 5, precision: 0 }
                    : type === "attachment"
                      ? { attachmentKind: "any" as const }
                      : {},
        rank: String(index),
        width: 140,
        isPrimary: index === 0,
        frozen: index === 0,
      }
    },
  )
  function scaleValue(
    type: FieldType,
    recordNumber: number,
    fieldNumber: number,
  ): CellValue {
    switch (type) {
      case "number":
      case "currency":
        return recordNumber * 100 + fieldNumber
      case "percent":
        return recordNumber % 101
      case "rating":
        return (recordNumber % 5) + 1
      case "checkbox":
        return recordNumber % 2 === 0
      case "date":
        return `2026-07-${String((recordNumber % 28) + 1).padStart(2, "0")}`
      case "email":
        return `person-${recordNumber}@example.com`
      case "url":
        return `https://example.com/records/${recordNumber}`
      case "singleSelect":
        return recordNumber % 2 ? "option_active" : "option_planned"
      case "multiSelect":
        return recordNumber % 2
          ? ["option_active"]
          : ["option_active", "option_planned"]
      case "attachment":
        return [
          {
            id: `attachment_${recordNumber}_${fieldNumber}`,
            name: `brief-${recordNumber}.pdf`,
            mimeType: "application/pdf",
            size: 2048,
          },
        ]
      default:
        return `Record ${recordNumber} column ${fieldNumber}`
    }
  }
  const records: GridRecord[] = Array.from(
    { length: 1_000 },
    (_, recordIndex) => ({
      id: `scale_record_${recordIndex + 1}`,
      rank: String(recordIndex),
      values: Object.fromEntries(
        fields.map((field, fieldIndex) => [
          field.id,
          scaleValue(field.type, recordIndex + 1, fieldIndex + 1),
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

  const renderStartedAt = performance.now()
  const { rerender } = render(
    <DataGrid
      canManageSchema={false}
      fields={fields}
      onAddField={vi.fn()}
      onAddRecord={vi.fn()}
      onBatchUpdateCells={onBatchUpdateCells}
      onDeleteField={vi.fn()}
      onDeleteRecords={vi.fn()}
      onDuplicateRecords={vi.fn()}
      onReorderField={vi.fn()}
      onResizeField={vi.fn()}
      onUpdateCell={vi.fn()}
      records={records}
    />,
  )

  const grid = screen.getByRole("grid", { name: "Records grid" })
  await screen.findByRole("button", { name: "Edit Column 1, record 1" })
  expect(performance.now() - renderStartedAt).toBeLessThan(5_000)
  expect(grid).toHaveAttribute("aria-rowcount", "1001")
  expect(grid).toHaveAttribute("aria-colcount", "52")
  expect(screen.getAllByRole("rowheader").length).toBeLessThan(60)
  expect(screen.getAllByRole("columnheader").length).toBeLessThan(15)
  expect(screen.getAllByRole("gridcell").length).toBeLessThan(600)
  expect(
    screen.queryByText("Record 1000 column 1"),
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
    name: "Edit Column 50, record 1",
  })
  expect(
    screen.getByRole("columnheader", { name: "Column 1" }),
  ).toHaveAttribute("aria-colindex", "2")
  expect(
    screen.getByRole("columnheader", { name: "Column 50" }),
  ).toHaveAttribute("aria-colindex", "51")
  const farCell = farEditor.closest('[role="gridcell"]')
  expect(farCell).toHaveAttribute("aria-colindex", "51")
  fireEvent.pointerDown(farCell!, { button: 0, pointerId: 1 })
  fireEvent.keyDown(grid, { key: "ArrowLeft" })

  const setClipboardData = vi.fn()
  fireEvent.copy(grid, {
    clipboardData: { setData: setClipboardData },
  })
  expect(setClipboardData).toHaveBeenCalledWith(
    "text/plain",
    "Record 1 column 49",
  )

  const scrollLeftBeforeUpdate = scrollContainer!.scrollLeft
  const scrollTopBeforeUpdate = scrollContainer!.scrollTop
  cellRenderMetrics.counts.clear()
  const realtimeRecords = records.map((record, index) =>
    index === 0
      ? {
          ...record,
          values: {
            ...record.values,
            scale_field_49: "Realtime update",
          },
          revision: record.revision + 1,
          updatedAt: record.updatedAt + 1,
        }
      : record,
  )
  rerender(
    <DataGrid
      canManageSchema={false}
      fields={fields}
      onAddField={vi.fn()}
      onAddRecord={vi.fn()}
      onBatchUpdateCells={onBatchUpdateCells}
      onDeleteField={vi.fn()}
      onDeleteRecords={vi.fn()}
      onDuplicateRecords={vi.fn()}
      onReorderField={vi.fn()}
      onResizeField={vi.fn()}
      onUpdateCell={vi.fn()}
      records={realtimeRecords}
    />,
  )
  await waitFor(() =>
    expect(
      cellRenderMetrics.counts.get("Column 49, record 1"),
    ).toBeGreaterThan(0),
  )
  const realtimeCellRenderCount = [...cellRenderMetrics.counts.values()]
    .reduce((total, count) => total + count, 0)
  expect(realtimeCellRenderCount).toBeLessThan(15)
  expect(
    cellRenderMetrics.counts.get("Column 49, record 2") ?? 0,
  ).toBe(0)
  expect(scrollContainer!.scrollLeft).toBe(scrollLeftBeforeUpdate)
  expect(scrollContainer!.scrollTop).toBe(scrollTopBeforeUpdate)

  fireEvent.paste(grid, {
    clipboardData: { getData: () => "Far column updated" },
  })
  await waitFor(() =>
    expect(onBatchUpdateCells).toHaveBeenCalledWith([
      {
        recordId: "scale_record_1",
        fieldId: "scale_field_49",
        value: "Far column updated",
        expectedRevision: 2,
      },
    ]),
  )
  expect(document.body).not.toHaveTextContent(
    /scale_field_|scale_record_/,
  )
})
