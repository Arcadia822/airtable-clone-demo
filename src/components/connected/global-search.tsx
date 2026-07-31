"use client"

import { useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useQuery } from "convex/react"
import {
  ArrowRight,
  CalendarDays,
  Command as CommandIcon,
  Database,
  FileText,
  FolderKanban,
  GalleryHorizontal,
  LayoutGrid,
  LoaderCircle,
  Plus,
  Rows3,
  Search,
  Star,
  Table2,
} from "lucide-react"

import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { parseConnectedLocation } from "@/components/connected/app-navigation"
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"

type SearchDestination = {
  kind: "base" | "table" | "view" | "form"
  name: string
  context: string
  href: string
  detail?: string
  favorite?: boolean
}

type QuickAction = {
  description: string
  href: string
  icon: typeof Plus
  label: string
}

const destinationGroups = [
  { kind: "base", label: "Bases" },
  { kind: "table", label: "Tables" },
  { kind: "view", label: "Saved views" },
  { kind: "form", label: "Forms" },
] as const

function DestinationIcon({
  destination,
}: {
  destination: SearchDestination
}) {
  if (destination.kind === "base") {
    return <Database className="size-3.5" />
  }
  if (destination.kind === "table") {
    return <Table2 className="size-3.5" />
  }
  if (destination.kind === "form") {
    return <FileText className="size-3.5" />
  }
  if (destination.detail === "Board view") {
    return <LayoutGrid className="size-3.5" />
  }
  if (destination.detail === "Calendar view") {
    return <CalendarDays className="size-3.5" />
  }
  if (destination.detail === "Gallery view") {
    return <GalleryHorizontal className="size-3.5" />
  }
  return <FolderKanban className="size-3.5" />
}

function useDebouncedValue(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timeout)
  }, [delay, value])

  return debounced
}

export function ConnectedGlobalSearch({
  className,
}: {
  className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const location = parseConnectedLocation(pathname)
  const [open, setOpen] = useState(false)
  const [queryText, setQueryText] = useState("")
  const normalizedQuery = queryText.trim().replace(/\s+/g, " ")
  const debouncedQuery = useDebouncedValue(normalizedQuery, 180)
  const shouldSearch =
    open &&
    normalizedQuery.length >= 2 &&
    debouncedQuery === normalizedQuery
  const searchResults = useQuery(
    api.search.destinations,
    shouldSearch
      ? {
          query: debouncedQuery,
          limit: 20,
        }
      : "skip",
  ) as SearchDestination[] | undefined
  const recentResults = useQuery(
    api.search.recent,
    open && normalizedQuery.length < 2 ? { limit: 6 } : "skip",
  ) as SearchDestination[] | undefined
  const activeBase = useQuery(
    api.bases.get,
    location.baseId
      ? { baseId: location.baseId as Id<"bases"> }
      : "skip",
  ) as Doc<"bases"> | undefined
  const activeTables = useQuery(
    api.tables.list,
    location.baseId
      ? { baseId: location.baseId as Id<"bases"> }
      : "skip",
  ) as Doc<"tables">[] | undefined
  const activeTable = activeTables?.find(
    (table) => table._id === location.tableId,
  )
  const waitingForSearch =
    normalizedQuery.length >= 2 &&
    (debouncedQuery !== normalizedQuery || searchResults === undefined)
  const results = useMemo(
    () => (shouldSearch ? (searchResults ?? []) : []),
    [searchResults, shouldSearch],
  )

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (
        event.key.toLocaleLowerCase() === "k" &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  }, [])

  const activeView = searchParams.get("view")
  const groupedResults = useMemo(
    () =>
      destinationGroups.map((group) => ({
        ...group,
        results: results.filter(
          (destination) => destination.kind === group.kind,
        ),
      })),
    [results],
  )
  const quickActions = useMemo<QuickAction[]>(() => {
    const actions: QuickAction[] = [
      {
        description: "Start a new collection of tables",
        href: "/dashboard?action=new-base",
        icon: Database,
        label: "New base",
      },
    ]
    if (location.baseId) {
      actions.push(
        {
          description: `Add a table to ${activeBase?.name ?? "this base"}`,
          href: `/bases/${location.baseId}?action=new-table`,
          icon: Table2,
          label: "New table",
        },
        {
          description: `Build a public form in ${activeBase?.name ?? "this base"}`,
          href: `/bases/${location.baseId}/forms?action=new-form`,
          icon: FileText,
          label: "New form",
        },
      )
    }
    if (location.baseId && location.tableId) {
      const currentParams = new URLSearchParams(searchParams.toString())
      currentParams.delete("record")
      currentParams.set("action", "new-view")
      actions.push({
        description: `Create a named view for ${activeTable?.name ?? "this table"}`,
        href: `${pathname}?${currentParams.toString()}`,
        icon: LayoutGrid,
        label: "New view",
      })
      currentParams.set("action", "new-record")
      actions.push({
        description: `Add a row to ${activeTable?.name ?? "this table"}`,
        href: `${pathname}?${currentParams.toString()}`,
        icon: Rows3,
        label: "New record",
      })
    }
    return actions
  }, [
    activeBase?.name,
    activeTable?.name,
    location.baseId,
    location.tableId,
    pathname,
    searchParams,
  ])
  const matchingQuickActions = useMemo(() => {
    if (normalizedQuery.length < 2) return quickActions
    const terms = normalizedQuery.toLocaleLowerCase()
    return quickActions.filter((action) =>
      `${action.label} ${action.description}`
        .toLocaleLowerCase()
        .includes(terms),
    )
  }, [normalizedQuery, quickActions])

  function isActive(destination: SearchDestination) {
    const [destinationPath, rawSearch = ""] =
      destination.href.split("?")
    if (pathname !== destinationPath) return false
    const destinationView = new URLSearchParams(rawSearch).get("view")
    return destinationView === null || destinationView === activeView
  }

  function navigate(href: string) {
    setOpen(false)
    setQueryText("")
    router.push(href)
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) setQueryText("")
  }

  return (
    <>
      <Button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        aria-label="Search workspace"
        className={cn(
          "h-8 w-8 justify-center border-foreground/10 bg-[#f8f8f6] px-0 text-muted-foreground shadow-none hover:bg-muted hover:text-foreground dark:bg-muted/40 min-[920px]:w-44 min-[920px]:justify-between min-[920px]:px-2.5",
          className,
        )}
        onClick={() => setOpen(true)}
        size="sm"
        variant="outline"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Search className="size-3.5" />
          <span className="hidden truncate text-xs min-[920px]:inline">
            Search workspace
          </span>
        </span>
        <kbd className="hidden rounded border border-foreground/10 bg-background px-1.5 py-0.5 font-mono text-[9px] font-normal text-muted-foreground min-[1080px]:inline">
          ⌘K
        </kbd>
      </Button>

      <CommandDialog
        className="right-2 bottom-2 left-2 top-auto max-h-[min(38rem,calc(100dvh-1rem))] w-auto max-w-none translate-x-0 overflow-hidden rounded-2xl! border border-foreground/10 shadow-2xl sm:right-auto sm:bottom-auto sm:left-1/2 sm:top-1/3 sm:w-full sm:max-w-2xl sm:-translate-x-1/2"
        description="Search named bases, tables, saved views, and forms in this workspace."
        onOpenChange={handleOpenChange}
        open={open}
        title="Search workspace"
      >
        <Command
          label="Search workspace destinations"
          shouldFilter={false}
        >
          <div className="flex items-center gap-3 border-b px-3 py-2.5">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background">
              <CommandIcon className="size-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-[-0.01em]">
                Find anything
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                Search this organization by name
              </p>
            </div>
          </div>
          <CommandInput
            aria-label="Search by name"
            autoFocus
            onValueChange={setQueryText}
            placeholder="Search by base, table, view, or form name…"
            value={queryText}
          />
          <CommandList className="max-h-[min(27rem,calc(100dvh-12rem))] p-1">
            {normalizedQuery.length < 2 ? (
              <>
                <CommandGroup heading="Go to">
                  <SearchDestinationItem
                    active={pathname === "/dashboard"}
                    destination={{
                      kind: "base",
                      name: "All bases",
                      context: "Workspace home",
                      href: "/dashboard",
                    }}
                    onSelect={navigate}
                  />
                </CommandGroup>
                <CommandGroup heading="Quick actions">
                  {matchingQuickActions.map((action) => (
                    <QuickActionItem
                      action={action}
                      key={action.label}
                      onSelect={navigate}
                    />
                  ))}
                </CommandGroup>
                {recentResults === undefined ? (
                  <div
                    aria-label="Loading recent destinations"
                    className="flex items-center gap-2 px-3 py-6 text-xs text-muted-foreground"
                  >
                    <LoaderCircle className="size-3.5 animate-spin" />
                    Loading recent views…
                  </div>
                ) : recentResults.length ? (
                  <CommandGroup heading="Recently opened">
                    {recentResults.map((destination) => (
                      <SearchDestinationItem
                        active={isActive(destination)}
                        destination={destination}
                        key={destination.href}
                        onSelect={navigate}
                      />
                    ))}
                  </CommandGroup>
                ) : (
                  <div className="px-3 py-7 text-center">
                    <p className="text-sm font-medium">
                      Search your workspace
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Type at least two letters from a name.
                    </p>
                  </div>
                )}
              </>
            ) : waitingForSearch ? (
              <div
                aria-label="Searching workspace"
                className="flex items-center gap-2 px-3 py-10 text-xs text-muted-foreground"
              >
                <LoaderCircle className="size-3.5 animate-spin" />
                Looking for “{normalizedQuery}”…
              </div>
            ) : results.length || matchingQuickActions.length ? (
              <>
                {matchingQuickActions.length ? (
                  <CommandGroup heading="Quick actions">
                    {matchingQuickActions.map((action) => (
                      <QuickActionItem
                        action={action}
                        key={action.label}
                        onSelect={navigate}
                      />
                    ))}
                  </CommandGroup>
                ) : null}
                {groupedResults.map((group) =>
                  group.results.length ? (
                    <CommandGroup heading={group.label} key={group.kind}>
                      {group.results.map((destination) => (
                        <SearchDestinationItem
                          active={isActive(destination)}
                          destination={destination}
                          key={destination.href}
                          onSelect={navigate}
                        />
                      ))}
                    </CommandGroup>
                  ) : null,
                )}
              </>
            ) : (
              <div className="px-6 py-10 text-center">
                <p className="text-sm font-medium">No names matched</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Try a different base, table, saved view, or form name.
                </p>
              </div>
            )}
          </CommandList>
          <div className="flex items-center justify-between border-t px-3 py-2 text-[10px] text-muted-foreground">
            <span>Names and workspace context only</span>
            <span className="hidden items-center gap-1 sm:flex">
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">
                Esc
              </kbd>
              to close
            </span>
          </div>
        </Command>
      </CommandDialog>
    </>
  )
}

function QuickActionItem({
  action,
  onSelect,
}: {
  action: QuickAction
  onSelect: (href: string) => void
}) {
  const Icon = action.icon
  return (
    <CommandItem
      className="min-h-14 px-2.5 py-2"
      onSelect={() => onSelect(action.href)}
      value={`${action.label} ${action.description}`}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background">
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {action.label}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {action.description}
        </span>
      </span>
      <Plus className="size-3.5 text-muted-foreground" />
    </CommandItem>
  )
}

function SearchDestinationItem({
  active,
  destination,
  onSelect,
}: {
  active: boolean
  destination: SearchDestination
  onSelect: (href: string) => void
}) {
  return (
    <CommandItem
      aria-current={active ? "page" : undefined}
      className="min-h-14 px-2.5 py-2"
      onSelect={() => onSelect(destination.href)}
      value={`${destination.name} ${destination.context} ${destination.detail ?? ""}`}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-foreground/10 bg-[#f8f8f6] text-foreground dark:bg-muted/40">
        <DestinationIcon destination={destination} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">
            {destination.name}
          </span>
          {destination.favorite ? (
            <Star
              aria-label="Favorite"
              className="size-3 fill-amber-400 text-amber-500"
            />
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {destination.context}
          {destination.detail ? ` · ${destination.detail}` : ""}
        </span>
      </span>
      {active ? (
        <span className="rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          Current
        </span>
      ) : (
        <ArrowRight className="size-3.5 text-muted-foreground" />
      )}
    </CommandItem>
  )
}
