import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CalendarView } from "@/components/views/calendar-view"
import { GalleryView } from "@/components/views/gallery-view"
import { KanbanView } from "@/components/views/kanban-view"
import type {
  FieldDefinition,
  GridRecord,
} from "@/lib/domain"

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)
afterEach(cleanup)

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
  {
    id: "field_internal_status",
    name: "Delivery status",
    type: "singleSelect",
    config: {
      options: [
        {
          id: "option_internal_planned",
          label: "Planned",
          color: "#64748B",
        },
        {
          id: "option_internal_live",
          label: "Live",
          color: "#10B981",
        },
      ],
    },
    rank: "b",
    width: 180,
    isPrimary: false,
  },
  {
    id: "field_internal_date",
    name: "Target date",
    type: "date",
    config: { dateStyle: "date" },
    rank: "c",
    width: 180,
    isPrimary: false,
  },
  {
    id: "field_internal_cover",
    name: "Launch image",
    type: "attachment",
    config: { attachmentKind: "image" },
    rank: "d",
    width: 220,
    isPrimary: false,
  },
]

const record: GridRecord = {
  id: "record_internal_launch",
  rank: "a",
  revision: 4,
  values: {
    field_internal_name: "New customer launch",
    field_internal_status: "option_internal_live",
    field_internal_date: Date.now(),
    field_internal_cover: [
      {
        id: "attachment_internal_cover",
        name: "Launch cover.png",
        mimeType: "image/png",
        size: 120,
        url: "https://example.test/cover.png",
      },
    ],
  },
  createdAt: Date.now(),
  createdBy: "user_internal_creator",
  updatedAt: Date.now(),
  updatedBy: "user_internal_creator",
}

describe("alternative data views", () => {
  it("moves Kanban cards through named lanes and opens a named record drawer", () => {
    const onUpdateCell = vi.fn()
    const { container } = render(
      <KanbanView
        fields={fields}
        groupField={fields[1]!}
        onUpdateCell={onUpdateCell}
        records={[record]}
        summaryFields={[fields[2]!]}
      />,
    )
    const card = screen.getByRole("button", {
      name: "Open New customer launch",
    })
    const transfer = {
      effectAllowed: "",
      setData: vi.fn(),
      getData: vi.fn(() => record.id),
    }
    fireEvent.dragStart(card, { dataTransfer: transfer })
    fireEvent.drop(
      screen.getByRole("region", { name: "Planned, 0 records" }),
      { dataTransfer: transfer },
    )
    expect(onUpdateCell).toHaveBeenCalledWith(
      record.id,
      fields[1]!.id,
      "option_internal_planned",
      4,
    )
    expect(screen.getByText("Target date:")).toBeInTheDocument()
    fireEvent.change(
      screen.getByLabelText(
        "Move New customer launch to another group",
      ),
      { target: { value: "option_internal_planned" } },
    )
    expect(onUpdateCell).toHaveBeenLastCalledWith(
      record.id,
      fields[1]!.id,
      "option_internal_planned",
      4,
    )

    fireEvent.click(card)
    expect(
      screen.getByRole("dialog", { name: "New customer launch" }),
    ).toBeInTheDocument()
    expect(screen.getByText("Delivery status")).toBeInTheDocument()
    expect(container.textContent).not.toContain("field_internal")
    expect(container.textContent).not.toContain("option_internal")
  })

  it("renders a calendar using the friendly date-column name", () => {
    const onDisplayChange = vi.fn()
    const onUpdateCell = vi.fn()
    const { container } = render(
      <CalendarView
        dateField={fields[2]!}
        fields={fields}
        onDisplayChange={onDisplayChange}
        onUpdateCell={onUpdateCell}
        records={[record]}
      />,
    )
    expect(
      screen.getByLabelText("Calendar using Target date"),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Agenda" }))
    expect(onDisplayChange).toHaveBeenCalledWith("agenda")
    expect(
      screen.getByLabelText("Agenda using Target date"),
    ).toBeInTheDocument()
    expect(screen.getByText("1 record")).toBeInTheDocument()
    expect(screen.getByText("All day")).toBeInTheDocument()
    fireEvent.change(
      screen.getByLabelText("Move New customer launch to date"),
      { target: { value: "2026-08-02" } },
    )
    expect(onUpdateCell).toHaveBeenCalledWith(
      record.id,
      fields[2]!.id,
      expect.any(Number),
      4,
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Open New customer launch" }),
    )
    expect(
      screen.getByRole("dialog", { name: "New customer launch" }),
    ).toBeInTheDocument()
    expect(container.textContent).not.toContain("field_internal")
  })

  it("renders gallery covers and named record details", () => {
    const { container } = render(
      <GalleryView
        coverField={fields[3]}
        fields={fields}
        onUpdateCell={vi.fn()}
        records={[record]}
        summaryFields={[fields[2]!]}
      />,
    )
    expect(screen.getByAltText("Launch cover.png")).toBeInTheDocument()
    expect(screen.getByText("Target date")).toBeInTheDocument()
    expect(screen.queryByText("Delivery status")).not.toBeInTheDocument()
    expect(container.textContent).not.toContain("option_internal")
  })
})
