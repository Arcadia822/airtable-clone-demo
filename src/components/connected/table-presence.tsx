"use client"

import usePresence, {
  type PresenceState,
} from "@convex-dev/presence/react"
import { useQuery } from "convex/react"
import { useEffect, useMemo } from "react"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

export type WorkspacePresenceEntry = {
  fieldId?: string
  image?: string
  isCurrentUser: boolean
  name: string
  online: boolean
  recordId?: string
  userId: string
}

type PresenceViewer = {
  userId: string
  name: string
  image?: string
}

function presenceData(entry: PresenceState) {
  return typeof entry.data === "object" &&
    entry.data !== null &&
    !Array.isArray(entry.data)
    ? (entry.data as Record<string, unknown>)
    : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "WM"
  )
}

function PresenceSession({
  className,
  onPresenceChange,
  onReadyChange,
  tableId,
  viewer,
}: {
  className?: string
  onPresenceChange?: (entries: WorkspacePresenceEntry[]) => void
  onReadyChange?: (ready: boolean) => void
  tableId: string
  viewer: PresenceViewer
}) {
  const state = usePresence(
    api.presence,
    `table:${tableId}`,
    viewer.userId,
    12_000,
  )
  const entries = useMemo<WorkspacePresenceEntry[]>(
    () =>
      (state ?? [])
        .filter((entry) => entry.online)
        .map((entry) => {
          const data = presenceData(entry)
          const current = entry.userId === viewer.userId
          return {
            userId: entry.userId,
            online: entry.online,
            isCurrentUser: current,
            name:
              (current ? viewer.name : undefined) ??
              entry.name ??
              optionalString(data?.name) ??
              "Workspace member",
            image:
              (current ? viewer.image : undefined) ??
              entry.image ??
              optionalString(data?.image),
            fieldId: optionalString(data?.fieldId),
            recordId: optionalString(data?.recordId),
          }
        }),
    [state, viewer.image, viewer.name, viewer.userId],
  )
  const ready = entries.some((entry) => entry.isCurrentUser)

  useEffect(() => {
    onPresenceChange?.(entries)
  }, [entries, onPresenceChange])

  useEffect(() => {
    onReadyChange?.(ready)
  }, [onReadyChange, ready])

  const visible = entries.slice(0, 4)
  const hiddenCount = Math.max(0, entries.length - visible.length)

  return (
    <div
      aria-label={
        entries.length === 1
          ? "1 collaborator in this table"
          : `${entries.length} collaborators in this table`
      }
      className={cn("flex min-w-0 items-center gap-2", className)}
      role="status"
    >
      <AvatarGroup className="isolate">
        {visible.map((entry) => (
          <Avatar
            className="size-6 bg-background ring-2 ring-background"
            key={entry.userId}
            size="sm"
            title={`${entry.name}${entry.isCurrentUser ? " (you)" : ""}`}
          >
            {entry.image ? (
              <AvatarImage alt="" src={entry.image} />
            ) : null}
            <AvatarFallback className="bg-primary/10 text-[8px] font-semibold text-primary">
              {initials(entry.name)}
            </AvatarFallback>
            <AvatarBadge className="border-2 border-background bg-emerald-500" />
          </Avatar>
        ))}
        {hiddenCount ? (
          <AvatarGroupCount className="size-6 text-[9px]">
            +{hiddenCount}
          </AvatarGroupCount>
        ) : null}
      </AvatarGroup>
      <span className="hidden text-[11px] tabular-nums text-muted-foreground 2xl:inline">
        {entries.length ? `${entries.length} here` : "Connecting…"}
      </span>
    </div>
  )
}

export function ConnectedTablePresence({
  className,
  onPresenceChange,
  onReadyChange,
  tableId,
}: {
  className?: string
  onPresenceChange?: (entries: WorkspacePresenceEntry[]) => void
  onReadyChange?: (ready: boolean) => void
  tableId: string
}) {
  const viewer = useQuery(api.presence.viewer) as PresenceViewer | undefined

  if (!viewer) {
    return (
      <div
        aria-label="Connecting collaborators"
        className={cn("flex items-center", className)}
        role="status"
      >
        <div className="size-6 animate-pulse rounded-full border bg-muted" />
      </div>
    )
  }

  return (
    <PresenceSession
      className={className}
      onPresenceChange={onPresenceChange}
      onReadyChange={onReadyChange}
      tableId={tableId as Id<"tables">}
      viewer={viewer}
    />
  )
}
