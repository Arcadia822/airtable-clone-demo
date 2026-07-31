"use client"

import { PanelRightClose } from "lucide-react"
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const DEFAULT_DOCK_WIDTH = 460
const MIN_DOCK_WIDTH = 360
const MAX_DOCK_WIDTH = 720

function constrainedDockWidth(width: number) {
  if (typeof window === "undefined") {
    return Math.min(MAX_DOCK_WIDTH, Math.max(MIN_DOCK_WIDTH, width))
  }
  const viewportMaximum = Math.max(
    MIN_DOCK_WIDTH,
    window.innerWidth - 96,
  )
  return Math.min(
    MAX_DOCK_WIDTH,
    viewportMaximum,
    Math.max(MIN_DOCK_WIDTH, width),
  )
}

export function AssistantDock({
  children,
  className,
  label,
  onOpenChange,
  open,
}: {
  children: ReactNode
  className?: string
  label: string
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const [width, setWidth] = useState(DEFAULT_DOCK_WIDTH)
  const [resizing, setResizing] = useState(false)
  const resizingRef = useRef(false)

  useEffect(() => {
    if (!open) return

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false)
      }
    }

    function keepWidthInViewport() {
      setWidth((current) => constrainedDockWidth(current))
    }

    window.addEventListener("keydown", closeOnEscape)
    window.addEventListener("resize", keepWidthInViewport)
    return () => {
      window.removeEventListener("keydown", closeOnEscape)
      window.removeEventListener("resize", keepWidthInViewport)
    }
  }, [onOpenChange, open])

  if (!open) return null

  function resizeFromPointer(event: PointerEvent<HTMLDivElement>) {
    if (!resizingRef.current) return
    setWidth(constrainedDockWidth(window.innerWidth - event.clientX))
  }

  function finishPointerResize(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    resizingRef.current = false
    setResizing(false)
  }

  function resizeFromKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 64 : 24
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      setWidth((current) => constrainedDockWidth(current + step))
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      setWidth((current) => constrainedDockWidth(current - step))
    } else if (event.key === "Home") {
      event.preventDefault()
      setWidth(MIN_DOCK_WIDTH)
    } else if (event.key === "End") {
      event.preventDefault()
      setWidth(constrainedDockWidth(MAX_DOCK_WIDTH))
    }
  }

  return (
    <aside
      aria-label={label}
      aria-modal="false"
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-background text-foreground shadow-[-12px_0_32px_rgba(15,23,42,0.09)] outline-none sm:w-auto",
        !resizing && "transition-[width] duration-150 ease-out",
        className,
      )}
      id="basecraft-assistant-panel"
      role="dialog"
      style={{
        width: `min(${width}px, 100vw)`,
      }}
    >
      <div
        aria-label="Resize assistant panel"
        aria-orientation="vertical"
        aria-valuemax={MAX_DOCK_WIDTH}
        aria-valuemin={MIN_DOCK_WIDTH}
        aria-valuenow={Math.round(width)}
        className={cn(
          "absolute inset-y-0 left-0 z-20 hidden w-2 -translate-x-1/2 cursor-col-resize touch-none outline-none sm:block",
          "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border",
          "hover:after:w-0.5 hover:after:bg-primary focus-visible:after:w-0.5 focus-visible:after:bg-primary",
          resizing && "after:w-0.5 after:bg-primary",
        )}
        onDoubleClick={() => setWidth(DEFAULT_DOCK_WIDTH)}
        onKeyDown={resizeFromKeyboard}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          resizingRef.current = true
          setResizing(true)
        }}
        onPointerCancel={finishPointerResize}
        onPointerMove={resizeFromPointer}
        onPointerUp={finishPointerResize}
        role="separator"
        tabIndex={0}
      />

      <Button
        aria-label="Close assistant"
        className="absolute top-3 right-3 z-30 border bg-background shadow-sm sm:-left-10 sm:right-auto"
        onClick={() => onOpenChange(false)}
        size="icon-sm"
        type="button"
        variant="outline"
      >
        <PanelRightClose />
      </Button>

      <div className="min-h-0 flex-1">{children}</div>
    </aside>
  )
}
