import { describe, expect, it } from "vitest"

import {
  connectionHealth,
  type ConnectionSnapshot,
} from "@/lib/connection-health"

const connected: ConnectionSnapshot = {
  connectionRetries: 0,
  hasEverConnected: true,
  inflightMutations: 0,
  isWebSocketConnected: true,
  timeOfOldestInflightRequest: null,
}

describe("connectionHealth", () => {
  it("blocks new changes while the browser is offline", () => {
    expect(connectionHealth(connected, { online: false })).toEqual({
      kind: "offline",
      label: "Offline",
      description: "Reconnect to keep editing.",
      canStartWrite: false,
    })
  })

  it("distinguishes an initial connection from a reconnect", () => {
    expect(
      connectionHealth(
        {
          ...connected,
          hasEverConnected: false,
          isWebSocketConnected: false,
        },
        { online: true },
      ).kind,
    ).toBe("connecting")

    expect(
      connectionHealth(
        {
          ...connected,
          connectionRetries: 1,
          isWebSocketConnected: false,
        },
        { online: true },
      ).kind,
    ).toBe("reconnecting")
  })

  it("uses plain language when reconnecting takes several attempts", () => {
    const health = connectionHealth(
      {
        ...connected,
        connectionRetries: 4,
        isWebSocketConnected: false,
      },
      { online: true },
    )

    expect(health).toMatchObject({
      kind: "delayed",
      label: "Taking longer",
      canStartWrite: false,
    })
    expect(health.description).not.toMatch(/websocket|retry|request/i)
  })

  it("offers a clear recovery state after repeated reconnect failures", () => {
    const health = connectionHealth(
      {
        ...connected,
        connectionRetries: 8,
        isWebSocketConnected: false,
      },
      { online: true },
    )

    expect(health).toEqual({
      kind: "failed",
      label: "Connection problem",
      description: "We could not reconnect. Reload to try again.",
      canStartWrite: false,
    })
  })

  it("shows Saving for local or live database writes", () => {
    expect(
      connectionHealth(connected, { online: true, pendingWrites: 1 }).kind,
    ).toBe("saving")
    expect(
      connectionHealth(
        { ...connected, inflightMutations: 1 },
        { online: true },
      ).kind,
    ).toBe("saving")
  })

  it("shows Live only when connected and fully saved", () => {
    expect(connectionHealth(connected, { online: true })).toEqual({
      kind: "live",
      label: "Live",
      description: "All changes are saved.",
      canStartWrite: true,
    })
  })
})
