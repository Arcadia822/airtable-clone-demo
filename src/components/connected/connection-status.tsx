"use client"

import { useSyncExternalStore } from "react"
import { useConvexConnectionState } from "convex/react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  connectionHealth,
  type ConnectionHealth,
} from "@/lib/connection-health"

const STATUS_STYLES: Record<ConnectionHealth["kind"], string> = {
  live: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300",
  saving:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
  connecting:
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-300",
  reconnecting:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
  delayed:
    "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/60 dark:text-orange-300",
  failed:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300",
  offline:
    "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
}

const DOT_STYLES: Record<ConnectionHealth["kind"], string> = {
  live: "bg-emerald-500",
  saving: "animate-pulse bg-amber-500 motion-reduce:animate-none",
  connecting: "animate-pulse bg-sky-500 motion-reduce:animate-none",
  reconnecting: "animate-pulse bg-amber-500 motion-reduce:animate-none",
  delayed: "animate-pulse bg-orange-500 motion-reduce:animate-none",
  failed: "bg-red-500",
  offline: "bg-zinc-500",
}

function subscribeToOnlineStatus(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange)
  window.addEventListener("offline", onStoreChange)

  return () => {
    window.removeEventListener("online", onStoreChange)
    window.removeEventListener("offline", onStoreChange)
  }
}

function browserIsOnline() {
  return navigator.onLine
}

function serverIsOnline() {
  return true
}

export function useLiveConnectionHealth(pendingWrites = 0) {
  const connection = useConvexConnectionState()
  const online = useSyncExternalStore(
    subscribeToOnlineStatus,
    browserIsOnline,
    serverIsOnline,
  )

  return connectionHealth(connection, { online, pendingWrites })
}

export function ConnectionStatus({
  className,
  health,
}: {
  className?: string
  health: ConnectionHealth
}) {
  return (
    <Badge
      aria-label={`${health.label}. ${health.description}`}
      className={cn(
        "rounded-full text-[10px] font-medium shadow-none",
        STATUS_STYLES[health.kind],
        className,
      )}
      role="status"
      title={health.description}
      variant="outline"
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", DOT_STYLES[health.kind])}
      />
      {health.label}
    </Badge>
  )
}

export function LiveConnectionStatus({
  className,
  pendingWrites = 0,
}: {
  className?: string
  pendingWrites?: number
}) {
  const health = useLiveConnectionHealth(pendingWrites)

  return <ConnectionStatus className={className} health={health} />
}
