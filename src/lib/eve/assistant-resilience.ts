export const ASSISTANT_TURN_TIMEOUT_MS = 45_000
export const ASSISTANT_CANCEL_CONFIRM_TIMEOUT_MS = 10_000

export type AssistantTurnOutcome =
  | "cancelled"
  | "completed"
  | "failed"
  | undefined

export function latestActiveTurnId(
  events: readonly unknown[],
): string | undefined {
  let activeTurnId: string | undefined
  for (const event of events) {
    const { turnId, type } = readTurnEvent(event)
    if (type === "turn.started" && turnId) {
      activeTurnId = turnId
      continue
    }
    if (
      turnId &&
      turnId === activeTurnId &&
      (type === "turn.completed" ||
        type === "turn.failed" ||
        type === "turn.cancelled")
    ) {
      activeTurnId = undefined
    }
  }
  return activeTurnId
}

export function latestTurnOutcome(
  events: readonly unknown[],
): AssistantTurnOutcome {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const { type } = readTurnEvent(events[index])
    if (type === "turn.cancelled") return "cancelled"
    if (type === "turn.completed") return "completed"
    if (type === "turn.failed") return "failed"
    if (type === "turn.started") return undefined
  }
  return undefined
}

function readTurnEvent(event: unknown): {
  turnId?: string
  type?: string
} {
  if (event === null || typeof event !== "object") return {}
  const candidate = event as { data?: unknown; type?: unknown }
  const data =
    candidate.data !== null && typeof candidate.data === "object"
      ? (candidate.data as { turnId?: unknown })
      : undefined
  return {
    turnId: typeof data?.turnId === "string" ? data.turnId : undefined,
    type: typeof candidate.type === "string" ? candidate.type : undefined,
  }
}

export async function withAssistantDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Assistant request timed out.")),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}
