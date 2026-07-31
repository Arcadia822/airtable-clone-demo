import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AssistantDock } from "@/components/assistant/assistant-dock"

describe("AssistantDock", () => {
  afterEach(cleanup)

  it("renders as a non-modal dock without a page backdrop", () => {
    render(
      <AssistantDock
        label="Workspace assistant"
        onOpenChange={() => undefined}
        open
      >
        <p>Live workspace answer</p>
      </AssistantDock>,
    )

    const dock = screen.getByRole("dialog", {
      name: "Workspace assistant",
    })
    expect(dock).toHaveAttribute("aria-modal", "false")
    expect(dock).toHaveAttribute("id", "basecraft-assistant-panel")
    expect(screen.getByText("Live workspace answer")).toBeInTheDocument()
    expect(document.querySelector("[data-slot='sheet-overlay']")).toBeNull()
  })

  it("closes from the dock control and Escape", () => {
    const onOpenChange = vi.fn()
    const view = render(
      <AssistantDock
        label="Workspace assistant"
        onOpenChange={onOpenChange}
        open
      >
        Assistant
      </AssistantDock>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)

    view.rerender(
      <AssistantDock
        label="Workspace assistant"
        onOpenChange={onOpenChange}
        open
      >
        Assistant
      </AssistantDock>,
    )
    fireEvent.keyDown(window, { key: "Escape" })
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it("supports keyboard resizing with a named separator", () => {
    render(
      <AssistantDock
        label="Workspace assistant"
        onOpenChange={() => undefined}
        open
      >
        Assistant
      </AssistantDock>,
    )

    const resizeHandle = screen.getByRole("separator", {
      name: "Resize assistant panel",
    })
    expect(resizeHandle).toHaveAttribute("aria-valuenow", "460")
    fireEvent.keyDown(resizeHandle, { key: "ArrowLeft" })
    expect(resizeHandle).toHaveAttribute("aria-valuenow", "484")
    fireEvent.keyDown(resizeHandle, { key: "Home" })
    expect(resizeHandle).toHaveAttribute("aria-valuenow", "360")
  })
})
