"use client"

import { ConnectionStatus } from "@/components/connected/connection-status"
import type { ConnectionHealth } from "@/lib/connection-health"
import { cn } from "@/lib/utils"

export function formWriteRetryGuidance(
  health: ConnectionHealth,
  hasUnsavedDraft = false,
) {
  const draftGuidance = hasUnsavedDraft
    ? "Keep this tab open—your unsaved draft stays here."
    : "Nothing new was sent."

  if (health.kind === "failed") {
    return `${draftGuidance} Check your connection, then reload only after copying any text you still need.`
  }

  if (health.kind === "offline") {
    return `${draftGuidance} Reconnect, wait for the status to say Live, then try again.`
  }

  return `${draftGuidance} Wait for the status to say Live, then try again.`
}

export function FormWriteStatus({
  className,
  hasUnsavedDraft = false,
  health,
}: {
  className?: string
  hasUnsavedDraft?: boolean
  health: ConnectionHealth
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <ConnectionStatus health={health} />
      {!health.canStartWrite ? (
        <p
          aria-live="polite"
          className="min-w-0 text-xs leading-5 text-muted-foreground"
          role="status"
        >
          Form changes are paused.{" "}
          {formWriteRetryGuidance(health, hasUnsavedDraft)}
        </p>
      ) : null}
    </div>
  )
}
