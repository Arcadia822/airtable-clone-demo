import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ComponentErrorBoundary } from "@/components/component-error-boundary"

function BrokenSection({ broken }: { broken: boolean }) {
  if (broken) throw new Error("internal_reference_123")
  return <div>Records are ready</div>
}

describe("ComponentErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  it("keeps technical errors private and recovers when its resource changes", () => {
    const { rerender } = render(
      <ComponentErrorBoundary
        description="Refresh this section without leaving your workspace."
        resetKey="view-one"
        title="This view could not open"
      >
        <BrokenSection broken />
      </ComponentErrorBoundary>,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This view could not open",
    )
    expect(document.body).not.toHaveTextContent("internal_reference_123")

    rerender(
      <ComponentErrorBoundary
        description="Refresh this section without leaving your workspace."
        resetKey="view-two"
        title="This view could not open"
      >
        <BrokenSection broken={false} />
      </ComponentErrorBoundary>,
    )
    expect(screen.getByText("Records are ready")).toBeInTheDocument()
  })

  it("offers a clear retry action", () => {
    let broken = true
    function RecoverableSection() {
      if (broken) throw new Error("private failure")
      return <div>Section recovered</div>
    }

    render(
      <ComponentErrorBoundary
        description="Your saved work is safe."
        title="This section needs another try"
      >
        <RecoverableSection />
      </ComponentErrorBoundary>,
    )
    broken = false
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(screen.getByText("Section recovered")).toBeInTheDocument()
  })
})
