export type ConnectionSnapshot = {
  connectionRetries: number
  hasEverConnected: boolean
  inflightMutations: number
  isWebSocketConnected: boolean
  timeOfOldestInflightRequest: Date | null
}

export type ConnectionHealth =
  | {
      kind: "offline"
      label: "Offline"
      description: "Reconnect to keep editing."
      canStartWrite: false
    }
  | {
      kind: "connecting"
      label: "Connecting"
      description: "Opening the live workspace…"
      canStartWrite: false
    }
  | {
      kind: "reconnecting"
      label: "Reconnecting"
      description: "Your saved work is safe. Reconnecting now…"
      canStartWrite: false
    }
  | {
      kind: "delayed"
      label: "Taking longer"
      description: "Still trying to reconnect. Check your connection."
      canStartWrite: false
    }
  | {
      kind: "failed"
      label: "Connection problem"
      description: "We could not reconnect. Reload to try again."
      canStartWrite: false
    }
  | {
      kind: "saving"
      label: "Saving"
      description: "Saving your latest changes…"
      canStartWrite: true
    }
  | {
      kind: "live"
      label: "Live"
      description: "All changes are saved."
      canStartWrite: true
    }

const DELAYED_RETRY_THRESHOLD = 4
const FAILED_RETRY_THRESHOLD = 8
const SLOW_REQUEST_MS = 15_000

export function connectionHealth(
  snapshot: ConnectionSnapshot,
  {
    online,
    pendingWrites = 0,
    now = Date.now(),
  }: {
    online: boolean
    pendingWrites?: number
    now?: number
  },
): ConnectionHealth {
  if (!online) {
    return {
      kind: "offline",
      label: "Offline",
      description: "Reconnect to keep editing.",
      canStartWrite: false,
    }
  }

  if (!snapshot.isWebSocketConnected) {
    if (
      snapshot.hasEverConnected &&
      snapshot.connectionRetries >= FAILED_RETRY_THRESHOLD
    ) {
      return {
        kind: "failed",
        label: "Connection problem",
        description: "We could not reconnect. Reload to try again.",
        canStartWrite: false,
      }
    }

    if (
      snapshot.hasEverConnected &&
      snapshot.connectionRetries >= DELAYED_RETRY_THRESHOLD
    ) {
      return {
        kind: "delayed",
        label: "Taking longer",
        description: "Still trying to reconnect. Check your connection.",
        canStartWrite: false,
      }
    }

    if (snapshot.hasEverConnected) {
      return {
        kind: "reconnecting",
        label: "Reconnecting",
        description: "Your saved work is safe. Reconnecting now…",
        canStartWrite: false,
      }
    }

    return {
      kind: "connecting",
      label: "Connecting",
      description: "Opening the live workspace…",
      canStartWrite: false,
    }
  }

  const oldestRequestAge =
    snapshot.timeOfOldestInflightRequest === null
      ? 0
      : now - snapshot.timeOfOldestInflightRequest.getTime()
  const saving =
    pendingWrites > 0 ||
    snapshot.inflightMutations > 0 ||
    oldestRequestAge >= SLOW_REQUEST_MS

  if (saving) {
    return {
      kind: "saving",
      label: "Saving",
      description: "Saving your latest changes…",
      canStartWrite: true,
    }
  }

  return {
    kind: "live",
    label: "Live",
    description: "All changes are saved.",
    canStartWrite: true,
  }
}
