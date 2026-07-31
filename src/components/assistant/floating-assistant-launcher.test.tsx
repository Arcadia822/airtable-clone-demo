import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { FloatingAssistantLauncher } from "@/components/assistant/floating-assistant-launcher"

describe("FloatingAssistantLauncher", () => {
  afterEach(cleanup)

  it("opens the live workspace assistant from an accessible native button", () => {
    const onClick = vi.fn()

    render(
      <FloatingAssistantLauncher
        canUseAi
        onClick={onClick}
        open={false}
      />,
    )

    const button = screen.getByRole("button", { name: "Ask Basecraft AI" })
    expect(button).toHaveAttribute("aria-controls", "basecraft-assistant-panel")
    expect(button).toHaveAttribute("aria-expanded", "false")
    expect(button).toHaveAttribute("aria-haspopup", "dialog")
    expect(button).toHaveAttribute("type", "button")
    expect(screen.getByText("Live")).toBeInTheDocument()
    expect(button.className).not.toMatch(/gradient|indigo|violet/)

    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("clearly labels the plan preview when AI is not included", () => {
    render(
      <FloatingAssistantLauncher
        canUseAi={false}
        onClick={() => undefined}
      />,
    )

    expect(
      screen.getByRole("button", {
        name: "Open Basecraft AI plan preview",
      }),
    ).toBeInTheDocument()
    expect(screen.getByText("Pro")).toBeInTheDocument()
    expect(screen.queryByText("Live")).not.toBeInTheDocument()
  })

  it("exposes its open state to assistive technology", () => {
    render(
      <FloatingAssistantLauncher
        canUseAi
        onClick={() => undefined}
        open
      />,
    )

    expect(
      screen.getByRole("button", { name: "Basecraft AI is open" }),
    ).toHaveAttribute("aria-expanded", "true")
  })
})
