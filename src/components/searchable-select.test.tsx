import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SearchableSelect } from "@/components/searchable-select"

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)
HTMLElement.prototype.scrollIntoView = vi.fn()

describe("SearchableSelect", () => {
  it("shows friendly labels while returning the internal value", () => {
    const onValueChange = vi.fn()
    render(
      <SearchableSelect
        onValueChange={onValueChange}
        options={[
          { value: "table_private_123", label: "Customer feedback" },
          { value: "table_private_456", label: "Launch plan" },
        ]}
        searchPlaceholder="Search tables…"
        value=""
      />,
    )

    fireEvent.click(screen.getByRole("combobox"))
    expect(screen.getByText("Customer feedback")).toBeInTheDocument()
    expect(screen.queryByText("table_private_123")).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText("Search tables…"), {
      target: { value: "launch" },
    })
    fireEvent.click(screen.getByText("Launch plan"))

    expect(onValueChange).toHaveBeenCalledWith("table_private_456")
  })
})
