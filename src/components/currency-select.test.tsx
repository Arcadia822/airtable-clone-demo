import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CurrencySelect } from "@/components/currency-select"

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)
afterEach(cleanup)

describe("CurrencySelect", () => {
  it("shows the currency name instead of only its stored code", () => {
    render(<CurrencySelect onValueChange={vi.fn()} value="USD" />)

    expect(screen.getByRole("combobox")).toHaveTextContent(
      "US Dollar ($) · USD",
    )
  })

  it("does not expose an unknown stored value", () => {
    render(
      <CurrencySelect
        onValueChange={vi.fn()}
        value="currency_private_123"
      />,
    )

    const currency = screen.getByRole("combobox")
    expect(currency).toHaveTextContent("Unavailable currency")
    expect(currency).not.toHaveTextContent("currency_private_123")
  })
})
