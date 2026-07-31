"use client"

import { MessageSquareText } from "lucide-react"

import { cn } from "@/lib/utils"

export function FloatingAssistantLauncher({
  canUseAi,
  className,
  onClick,
  open = false,
}: {
  canUseAi: boolean
  className?: string
  onClick: () => void
  open?: boolean
}) {
  const accessibleLabel = open
    ? "Basecraft AI is open"
    : canUseAi
      ? "Ask Basecraft AI"
      : "Open Basecraft AI plan preview"

  return (
    <button
      aria-controls="basecraft-assistant-panel"
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={accessibleLabel}
      className={cn(
        "group fixed z-40 flex h-11 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-foreground shadow-[0_8px_24px_rgba(15,23,42,0.12)] outline-none",
        "right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))]",
        "transition-[box-shadow,background-color,border-color] duration-150",
        "hover:border-foreground/20 hover:bg-muted/60 hover:shadow-[0_10px_28px_rgba(15,23,42,0.15)]",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "motion-reduce:transition-none",
        className,
      )}
      onClick={onClick}
      type="button"
    >
      <span
        aria-hidden="true"
        className="relative grid size-7 shrink-0 place-items-center rounded-md bg-foreground text-background"
      >
        <MessageSquareText className="size-3.5" strokeWidth={2} />
        {canUseAi ? (
          <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full border-2 border-background bg-emerald-500" />
        ) : null}
      </span>

      <span className="min-w-0 text-[13px] font-medium tracking-[-0.01em]">
        Ask AI
      </span>
      <span className="hidden items-center gap-1.5 border-l pl-2 text-[10px] text-muted-foreground sm:flex">
        {canUseAi ? (
          <>
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-emerald-500"
            />
            Live
          </>
        ) : (
          "Preview"
        )}
      </span>

      {!canUseAi ? (
        <span className="rounded border bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
          Pro
        </span>
      ) : null}
    </button>
  )
}
