"use client"

import {
  ArrowRight,
  ChartColumn,
  Database,
  FileText,
  GanttChart,
  LayoutGrid,
  Loader2,
  Search,
  Table2,
  User,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"

interface NameHit {
  id: string
  name: string
  description?: string
}

export interface WorkspaceSearchResult {
  bases: Array<NameHit & { color: string }>
  tables: Array<NameHit & { baseId: string; baseName: string }>
  views: Array<NameHit & { baseId: string; tableId: string; type: string }>
  forms: Array<NameHit & { baseId: string; slug: string; status: string }>
}

export interface RecordSearchHit {
  recordId: string
  tableId: string
  baseId: string
  tableName: string
  baseName: string
  primaryLabel: string
  snippet: string
  matchedFieldIds: string[]
}

const EMPTY_RESULTS: WorkspaceSearchResult = {
  bases: [],
  tables: [],
  views: [],
  forms: [],
}

const VIEW_ICONS: Record<string, typeof Table2> = {
  grid: Table2,
  kanban: ChartColumn,
  timeline: GanttChart,
  calendar: LayoutGrid,
  gallery: LayoutGrid,
  dashboard: ChartColumn,
}

async function readJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  const response = await fetch(url, { cache: "no-store", signal })
  if (!response.ok) return null
  return (await response.json().catch(() => null)) as T | null
}

/**
 * ⌘K palette over `/api/search` (destinations) and `/api/search/records`
 * (cross-field record hits with snippets).
 */
export function GlobalSearchDialog({
  baseId,
  onOpenChange,
  open,
}: {
  baseId?: string
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<WorkspaceSearchResult>(EMPTY_RESULTS)
  const [recordHits, setRecordHits] = useState<RecordSearchHit[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        onOpenChange(false)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onOpenChange, open])

  useEffect(() => {
    const trimmed = query.trim()
    if (!open || !trimmed) {
      setResults(EMPTY_RESULTS)
      setRecordHits([])
      setSearching(false)
      return
    }
    const controller = new AbortController()
    const handle = window.setTimeout(async () => {
      setSearching(true)
      try {
        const params = new URLSearchParams({ q: trimmed })
        const recordParams = new URLSearchParams({ q: trimmed, limit: "12" })
        if (baseId) recordParams.set("baseId", baseId)
        const [destinations, records] = await Promise.all([
          readJson<WorkspaceSearchResult>(`/api/search?${params}`, controller.signal),
          readJson<{ results: RecordSearchHit[] }>(
            `/api/search/records?${recordParams}`,
            controller.signal,
          ),
        ])
        if (controller.signal.aborted) return
        setResults(destinations ?? EMPTY_RESULTS)
        setRecordHits(records?.results ?? [])
      } catch {
        if (!controller.signal.aborted) {
          setResults(EMPTY_RESULTS)
          setRecordHits([])
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, 200)
    return () => {
      controller.abort()
      window.clearTimeout(handle)
    }
  }, [baseId, open, query])

  const destinationCount = useMemo(
    () =>
      results.bases.length +
      results.tables.length +
      results.views.length +
      results.forms.length,
    [results],
  )

  function go(href: string) {
    onOpenChange(false)
    setQuery("")
    router.push(href)
  }

  return (
    <CommandDialog
      description="Search bases, tables, views, forms, and every record."
      onOpenChange={onOpenChange}
      open={open}
      title="Search the workspace"
    >
      <Command label="Workspace search" shouldFilter={false}>
        <CommandInput
          onValueChange={setQuery}
          placeholder="Search tables, views, forms, or any cell…"
          value={query}
        />
        <CommandList>
          {searching ? (
            <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Searching…
            </div>
          ) : null}

          {!searching && query.trim() && !destinationCount && !recordHits.length ? (
            <CommandEmpty>No matches for “{query.trim()}”.</CommandEmpty>
          ) : null}

          {results.bases.length ? (
            <CommandGroup heading="Bases">
              {results.bases.map((base) => (
                <CommandItem
                  key={base.id}
                  onSelect={() => go(`/bases/${base.id}`)}
                  value={base.name}
                >
                  <Database className="size-4 text-muted-foreground" />
                  <span className="truncate">{base.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {results.tables.length ? (
            <CommandGroup heading="Tables">
              {results.tables.map((table) => (
                <CommandItem
                  key={table.id}
                  onSelect={() => go(`/bases/${table.baseId}/tables/${table.id}`)}
                  value={table.name}
                >
                  <Table2 className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{table.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {table.baseName}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {results.views.length ? (
            <CommandGroup heading="Views">
              {results.views.map((view) => {
                const Icon = VIEW_ICONS[view.type] ?? LayoutGrid
                return (
                  <CommandItem
                    key={view.id}
                    onSelect={() => go(`/bases/${view.baseId}/tables/${view.tableId}`)}
                    value={view.name}
                  >
                    <Icon className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{view.name}</span>
                    <span className="text-xs text-muted-foreground">{view.type}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ) : null}

          {results.forms.length ? (
            <CommandGroup heading="Forms">
              {results.forms.map((form) => (
                <CommandItem
                  key={form.id}
                  onSelect={() => go(`/bases/${form.baseId}/forms/${form.id}`)}
                  value={form.name}
                >
                  <FileText className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{form.name}</span>
                  <span className="text-xs text-muted-foreground">{form.status}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {recordHits.length ? (
            <>
              {destinationCount ? <CommandSeparator /> : null}
              <CommandGroup heading="Records">
                {recordHits.map((hit) => (
                  <CommandItem
                    key={`${hit.tableId}-${hit.recordId}`}
                    onSelect={() =>
                      go(
                        `/bases/${hit.baseId}/tables/${hit.tableId}?record=${hit.recordId}`,
                      )
                    }
                    value={`${hit.primaryLabel} ${hit.snippet}`}
                  >
                    <User className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {hit.primaryLabel}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {hit.snippet || hit.tableName}
                      </span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {hit.tableName}
                    </span>
                    <ArrowRight className="size-3.5 text-muted-foreground" />
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

export function GlobalSearchButton({
  className,
  onClick,
}: {
  className?: string
  onClick: () => void
}) {
  return (
    <Button
      aria-label="Search the workspace"
      className={cn("justify-start gap-2 text-muted-foreground", className)}
      onClick={onClick}
      size="sm"
      variant="outline"
    >
      <Search className="size-4" />
      <span className="hidden sm:inline">Search</span>
      <kbd className="ml-auto hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
        ⌘K
      </kbd>
    </Button>
  )
}
