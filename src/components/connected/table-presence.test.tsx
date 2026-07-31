import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConnectedTablePresence } from "@/components/connected/table-presence"

const mocks = vi.hoisted(() => ({
  presence: vi.fn(),
  query: vi.fn(),
}))

vi.mock("@convex-dev/presence/react", () => ({
  default: mocks.presence,
}))

vi.mock("convex/react", () => ({
  useQuery: mocks.query,
}))

describe("ConnectedTablePresence", () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("shows live collaborators and exposes their current cell locations", async () => {
    mocks.query.mockReturnValue({
      userId: "org:user-current",
      name: "Alex Morgan",
    })
    mocks.presence.mockReturnValue([
      {
        userId: "org:user-current",
        online: true,
        lastDisconnected: 0,
        data: {
          name: "Alex Morgan",
          fieldId: "field_status",
          recordId: "record_launch",
        },
      },
      {
        userId: "org:user-collaborator",
        online: true,
        lastDisconnected: 0,
        data: {
          name: "Alex Morgan",
          image: "https://example.com/alex.png",
          fieldId: "field_owner",
          recordId: "record_launch",
        },
      },
    ])
    const onPresenceChange = vi.fn()
    const onReadyChange = vi.fn()

    render(
      <ConnectedTablePresence
        onPresenceChange={onPresenceChange}
        onReadyChange={onReadyChange}
        tableId="table_launch"
      />,
    )

    expect(
      screen.getByRole("status", {
        name: "2 collaborators in this table",
      }),
    ).toBeInTheDocument()
    expect(screen.getByTitle("Alex Morgan (you)")).toBeInTheDocument()
    expect(screen.getByTitle("Alex Morgan")).toBeInTheDocument()
    await waitFor(() => expect(onReadyChange).toHaveBeenCalledWith(true))
    expect(onPresenceChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        fieldId: "field_status",
        isCurrentUser: true,
        recordId: "record_launch",
      }),
      expect.objectContaining({
        fieldId: "field_owner",
        isCurrentUser: false,
        recordId: "record_launch",
      }),
    ])
  })

  it("renders a calm connection placeholder before the viewer is ready", () => {
    mocks.query.mockReturnValue(undefined)

    render(<ConnectedTablePresence tableId="table_launch" />)

    expect(
      screen.getByRole("status", { name: "Connecting collaborators" }),
    ).toBeInTheDocument()
    expect(mocks.presence).not.toHaveBeenCalled()
  })
})
