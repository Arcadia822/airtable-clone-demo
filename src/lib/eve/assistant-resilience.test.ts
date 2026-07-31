import { describe, expect, it, vi } from "vitest"

import {
  latestActiveTurnId,
  latestTurnOutcome,
  withAssistantDeadline,
} from "./assistant-resilience"

describe("assistant turn resilience", () => {
  it("tracks only the currently active durable turn", () => {
    const running = [
      { type: "session.started", data: {} },
      { type: "turn.started", data: { turnId: "turn_private_1" } },
      { type: "message.received", data: { turnId: "turn_private_1" } },
    ]
    expect(latestActiveTurnId(running)).toBe("turn_private_1")
    expect(latestTurnOutcome(running)).toBeUndefined()

    const cancelled = [
      ...running,
      { type: "turn.cancelled", data: { turnId: "turn_private_1" } },
      { type: "session.waiting", data: {} },
    ]
    expect(latestActiveTurnId(cancelled)).toBeUndefined()
    expect(latestTurnOutcome(cancelled)).toBe("cancelled")
  })

  it("ends a stalled cancellation check at a bounded deadline", async () => {
    vi.useFakeTimers()
    const stalled = new Promise<never>(() => {})
    const result = withAssistantDeadline(stalled, 1_000)
    const rejection = expect(result).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(1_000)
    await rejection
    vi.useRealTimers()
  })
})
