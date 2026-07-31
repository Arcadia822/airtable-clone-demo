import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AppCommandPalette,
  CommandPaletteButton,
} from "@/components/app-command-palette"

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)
HTMLElement.prototype.scrollIntoView = vi.fn()
afterEach(cleanup)

describe("AppCommandPalette", () => {
  it("searches and runs named actions without displaying internal keys", () => {
    const run = vi.fn()
    const onOpenChange = vi.fn()
    const { container } = render(
      <AppCommandPalette
        actions={[
          {
            id: "action_internal_create_form",
            label: "Create a form",
            description: "Collect responses in Customer feedback",
            group: "Quick actions",
            keywords: ["survey"],
            run,
          },
        ]}
        onOpenChange={onOpenChange}
        open
      />,
    )

    fireEvent.change(
      screen.getByPlaceholderText(
        "Search bases, tables, views, and actions…",
      ),
      { target: { value: "survey" } },
    )
    fireEvent.click(screen.getByRole("option", { name: /Create a form/ }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(run).toHaveBeenCalledOnce()
    expect(container.textContent).not.toContain("action_internal")
  })

  it("opens with the standard keyboard shortcut and has a clear trigger", () => {
    const onOpenChange = vi.fn()
    render(
      <>
        <CommandPaletteButton onClick={() => onOpenChange(true)} />
        <AppCommandPalette
          actions={[]}
          onOpenChange={onOpenChange}
          open={false}
        />
      </>,
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Search and quick actions" }),
    )
    expect(onOpenChange).toHaveBeenCalledWith(true)
    fireEvent.keyDown(window, { key: "k", metaKey: true })
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
  })
})
