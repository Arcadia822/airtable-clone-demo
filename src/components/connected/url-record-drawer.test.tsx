import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { UrlRecordDrawer } from "@/components/connected/url-record-drawer"
import type { FieldDefinition, GridRecord } from "@/lib/domain"

const mocks = vi.hoisted(() => ({
  pathname: "/bases/base_internal/tables/table_internal",
  replace: vi.fn(),
  searchParams: new URLSearchParams(
    "view=view_internal&record=record_internal",
  ),
}))

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => mocks.searchParams,
}))

vi.mock("@/components/grid/cell-editor", () => ({
  CellEditor: ({ ariaLabel }: { ariaLabel: string }) => (
    <div>{ariaLabel}</div>
  ),
}))

const fields: FieldDefinition[] = [
  {
    id: "field_primary",
    name: "Campaign name",
    type: "singleLineText",
    config: {},
    rank: "a",
    width: 240,
    isPrimary: true,
  },
  {
    id: "field_status",
    name: "Launch status",
    type: "singleLineText",
    config: {},
    rank: "b",
    width: 180,
    isPrimary: false,
  },
]

const records: GridRecord[] = [
  {
    id: "record_internal",
    createdAt: 1,
    createdBy: "Teammate",
    rank: "a",
    revision: 1,
    updatedAt: 1,
    updatedBy: "Teammate",
    values: {
      field_primary: "Acme rollout",
      field_status: "Ready",
    },
  },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.searchParams = new URLSearchParams(
    "view=view_internal&record=record_internal",
  )
})

describe("UrlRecordDrawer", () => {
  it("opens a loaded record by its friendly name and clears only the record URL value", async () => {
    const { container } = render(
      <UrlRecordDrawer fields={fields} records={records} />,
    )

    expect(
      await screen.findByRole("dialog", { name: "Acme rollout" }),
    ).toBeInTheDocument()
    expect(screen.getByText("Campaign name")).toBeInTheDocument()
    expect(screen.getByText("Launch status")).toBeInTheDocument()
    expect(container.textContent).not.toMatch(
      /record_internal|field_primary|field_status|Id|key|slug/i,
    )

    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(mocks.replace).toHaveBeenCalledWith(
      "/bases/base_internal/tables/table_internal?view=view_internal",
      { scroll: false },
    )
  })

  it("does not open for a record that is not in the loaded results", () => {
    mocks.searchParams = new URLSearchParams("record=record_missing")
    render(<UrlRecordDrawer fields={fields} records={records} />)

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
