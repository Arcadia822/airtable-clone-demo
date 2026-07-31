import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ConnectionStatus } from "@/components/connected/connection-status"

describe("ConnectionStatus", () => {
  it("announces a readable saving state without implementation details", () => {
    render(
      <ConnectionStatus
        health={{
          kind: "saving",
          label: "Saving",
          description: "Saving your latest changes…",
          canStartWrite: true,
        }}
      />,
    )

    expect(
      screen.getByRole("status", {
        name: "Saving. Saving your latest changes…",
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/websocket|mutation|retry/i)).not.toBeInTheDocument()
  })
})
