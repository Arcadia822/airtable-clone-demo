import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react"
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import AppError from "@/app/error"
import AppLoading from "@/app/loading"
import NotFound from "@/app/not-found"

describe("route-level customer states", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("offers a safe retry without exposing technical details", () => {
    const reset = vi.fn()
    const error = Object.assign(new Error("database_internal_01"), {
      digest: "opaque_internal_02",
    })
    const { container } = render(<AppError error={error} reset={reset} />)

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your saved work is still safe",
    )
    expect(container).not.toHaveTextContent("database_internal_01")
    expect(container).not.toHaveTextContent("opaque_internal_02")
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(reset).toHaveBeenCalledOnce()
  })

  it("provides named loading and missing-page recovery", () => {
    const { rerender } = render(<AppLoading />)
    expect(screen.getByLabelText("Loading page")).toHaveAttribute(
      "aria-busy",
      "true",
    )

    rerender(<NotFound />)
    expect(
      screen.getByRole("heading", {
        name: "We couldn’t find that page",
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Go to workspace" }),
    ).toHaveAttribute("href", "/dashboard")
  })
})
