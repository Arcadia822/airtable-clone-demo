"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart3,
  ChevronDown,
  CircleHelp,
  CircleDollarSign,
  Database,
  FileText,
  FormInput,
  Grid2X2,
  Menu,
  Plus,
  Search,
  Sparkles,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"

import { BrandMark } from "@/components/brand-mark"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { DEMO_BASES, DEMO_TABLES } from "@/lib/demo-data"
import type { BaseSummary, TableSummary } from "@/lib/domain"
import { cn } from "@/lib/utils"

function WorkspaceSidebar({
  pathname,
  bases,
  activeBaseId,
  onCreateBase,
  onSelectBase,
  onNavigate,
}: {
  pathname: string
  bases: BaseSummary[]
  activeBaseId: string
  onCreateBase: (name: string) => void
  onSelectBase: (baseId: string) => void
  onNavigate?: () => void
}) {
  const [newBaseOpen, setNewBaseOpen] = useState(false)
  const [newBaseName, setNewBaseName] = useState("")
  const [baseQuery, setBaseQuery] = useState("")
  const visibleBases = bases.filter((base) =>
    base.name.toLowerCase().includes(baseQuery.trim().toLowerCase()),
  )

  function createBase() {
    const name = newBaseName.trim()
    if (!name) return
    onCreateBase(name)
    setNewBaseName("")
    setNewBaseOpen(false)
    toast.success(`${name} created`, {
      description: "A required Name column and ready-to-use table view were added.",
    })
  }

  return (
    <div className="flex h-full flex-col bg-[#f3f2ee] dark:bg-sidebar">
      <div className="flex h-12 items-center border-b border-foreground/10 px-3">
        <BrandMark treatment="ink" />
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label="Switch organization"
          onClick={() =>
            toast.info("Sign in to switch workspaces.")
          }
        >
          <ChevronDown />
        </Button>
      </div>
      <div className="p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search bases"
            className="h-8 bg-background pl-8 text-xs"
            placeholder="Search bases"
            value={baseQuery}
            onChange={(event) => setBaseQuery(event.target.value)}
          />
        </div>
      </div>
      <nav className="space-y-0.5 px-2 text-xs">
        <Link
          aria-current={pathname === "/demo" ? "page" : undefined}
          href="/demo"
          onClick={onNavigate}
          className={cn(
            "flex h-8 items-center gap-2 rounded-md px-2.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
            pathname === "/demo" &&
              "bg-background font-medium text-foreground ring-1 ring-border/70",
          )}
        >
          <Grid2X2 className="size-3.5" />
          All bases
        </Link>
        <Link
          aria-current={
            pathname.startsWith("/demo/forms") ? "page" : undefined
          }
          href="/demo/forms"
          onClick={onNavigate}
          className={cn(
            "flex h-8 items-center gap-2 rounded-md px-2.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
            pathname.startsWith("/demo/forms") &&
              "bg-background font-medium text-foreground ring-1 ring-border/70",
          )}
        >
          <FormInput className="size-3.5" />
          Forms
        </Link>
        <Link
          aria-current={
            pathname.startsWith("/demo/analytics") ? "page" : undefined
          }
          href="/demo/analytics"
          onClick={onNavigate}
          className={cn(
            "flex h-8 items-center gap-2 rounded-md px-2.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
            pathname.startsWith("/demo/analytics") &&
              "bg-background font-medium text-foreground ring-1 ring-border/70",
          )}
        >
          <BarChart3 className="size-3.5" />
          Analytics
          <Badge className="ml-auto h-4 rounded px-1.5 text-[9px]">
            Starter
          </Badge>
        </Link>
        <Link
          aria-current={pathname.startsWith("/pricing") ? "page" : undefined}
          href="/pricing"
          onClick={onNavigate}
          className={cn(
            "flex h-8 items-center gap-2 rounded-md px-2.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
            pathname.startsWith("/pricing") &&
              "bg-background font-medium text-foreground ring-1 ring-border/70",
          )}
        >
          <CircleDollarSign className="size-3.5" />
          Plans
        </Link>
      </nav>
      <div className="mx-3 my-3 h-px bg-border" />
      <div className="flex items-center px-4 pb-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Bases
        </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto"
            aria-label="Create base"
            onClick={() => setNewBaseOpen(true)}
          >
          <Plus />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {visibleBases.map((base) => (
          <button
            key={base.id}
            type="button"
            aria-current={base.id === activeBaseId ? "page" : undefined}
            onClick={() => {
              onSelectBase(base.id)
              onNavigate?.()
            }}
            className={cn(
              "mb-0.5 flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
              base.id === activeBaseId &&
                "bg-background font-medium text-foreground ring-1 ring-border/70",
            )}
          >
            <span
              className="size-2.5 rounded-[3px]"
              style={{ background: base.color }}
            />
            <span className="truncate">{base.name}</span>
          </button>
        ))}
        {visibleBases.length === 0 ? (
          <p className="px-2.5 py-3 text-xs text-muted-foreground" role="status">
            No bases match “{baseQuery.trim()}”.
          </p>
        ) : null}
      </div>
      <div className="border-t p-2">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-background"
          onClick={() =>
            toast.info("Sign in to manage your account and workspace.")
          }
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">
              SC
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">Your team</span>
            <span className="block truncate text-[10px] text-muted-foreground">
              Demo workspace
            </span>
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </div>
      <Dialog open={newBaseOpen} onOpenChange={setNewBaseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a base</DialogTitle>
            <DialogDescription>
              A base starts with one table and a required Name column.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="new-base-name">Base name</Label>
            <Input
              id="new-base-name"
              autoFocus
              value={newBaseName}
              placeholder="e.g. Customer operations"
              onChange={(event) => setNewBaseName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") createBase()
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewBaseOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createBase} disabled={!newBaseName.trim()}>
              Create base
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export type DemoWorkspaceSelection = {
  activeBase: BaseSummary
  activeTable: TableSummary
}

export function WorkspaceShell({
  children,
  section = "table",
  onOpenAssistant,
}: {
  children:
    | ReactNode
    | ((selection: DemoWorkspaceSelection) => ReactNode)
  section?: "table" | "forms" | "analytics"
  onOpenAssistant?: () => void
}) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [bases, setBases] = useState<BaseSummary[]>(DEMO_BASES)
  const [tables, setTables] = useState<TableSummary[]>(DEMO_TABLES)
  const [activeBaseId, setActiveBaseId] = useState(DEMO_BASES[0].id)
  const [activeTableId, setActiveTableId] = useState(DEMO_TABLES[0].id)
  const [newTableOpen, setNewTableOpen] = useState(false)
  const [newTableName, setNewTableName] = useState("")
  const activeBase =
    bases.find((base) => base.id === activeBaseId) ?? bases[0]!
  const visibleTables = tables.filter(
    (table) => table.baseId === activeBase.id,
  )
  const activeTable =
    visibleTables.find((table) => table.id === activeTableId) ??
    visibleTables[0]!

  function selectBase(baseId: string) {
    const nextTables = tables.filter((table) => table.baseId === baseId)
    if (!nextTables[0]) return
    setActiveBaseId(baseId)
    setActiveTableId(nextTables[0].id)
  }

  function createBase(name: string) {
    const baseId = `local_base_${crypto.randomUUID()}`
    const tableId = `local_table_${crypto.randomUUID()}`
    setBases((current) => [
      ...current,
      {
        id: baseId,
        name,
        color: "#2563eb",
        tableCount: 1,
        recordCount: 0,
        updatedAt: Date.now(),
      },
    ])
    setTables((current) => [
      ...current,
      {
        id: tableId,
        baseId,
        name: "Grid",
        color: "#2563eb",
        rank: "0000",
      },
    ])
    setActiveBaseId(baseId)
    setActiveTableId(tableId)
  }

  function createTable() {
    const name = newTableName.trim()
    if (!name) return
    const tableId = `local_table_${crypto.randomUUID()}`
    setTables((current) => [
      ...current,
      {
        id: tableId,
        baseId: activeBase.id,
        name,
        color: "#2563eb",
        rank: `${visibleTables.length.toString().padStart(4, "0")}`,
      },
    ])
    setBases((current) =>
      current.map((base) =>
        base.id === activeBase.id
          ? {
              ...base,
              tableCount: base.tableCount + 1,
              updatedAt: Date.now(),
            }
          : base,
      ),
    )
    setActiveTableId(tableId)
    setNewTableName("")
    setNewTableOpen(false)
    toast.success(`${name} table created`, {
      description: "It starts with a required Name column.",
    })
  }

  return (
    <div className="flex h-dvh min-h-[620px] overflow-hidden bg-[#f6f5f1] dark:bg-background">
      <aside className="hidden w-[232px] shrink-0 border-r lg:block">
        <WorkspaceSidebar
          activeBaseId={activeBase.id}
          bases={bases}
          onCreateBase={createBase}
          onSelectBase={selectBase}
          pathname={pathname}
        />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="fixed left-2 top-2 z-50 border bg-background/95 lg:hidden"
              aria-label="Open navigation"
            />
          }
        >
          <Menu />
        </SheetTrigger>
        <SheetContent side="left" className="w-[250px] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Workspace navigation</SheetTitle>
          </SheetHeader>
          <WorkspaceSidebar
            activeBaseId={activeBase.id}
            bases={bases}
            onCreateBase={createBase}
            onSelectBase={selectBase}
            pathname={pathname}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-foreground/10 bg-background px-3 pl-12 lg:pl-3">
          <div className="flex min-w-0 items-center gap-2 px-2 py-1">
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <Database className="size-3.5" />
            </span>
            <span className="truncate text-sm font-semibold">
              {activeBase.name}
            </span>
          </div>
          <Badge
            variant="outline"
            className="hidden rounded border-border bg-muted/60 text-[10px] text-muted-foreground sm:inline-flex"
          >
            Demo data
          </Badge>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Help"
              onClick={() =>
                toast.info("Demo changes stay on this page until you refresh.")
              }
            >
              <CircleHelp />
            </Button>
            {onOpenAssistant ? (
              <>
                <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
                <Button
                  size="sm"
                  aria-label="Ask Basecraft"
                  onClick={onOpenAssistant}
                >
                  <Sparkles />
                  <span className="hidden sm:inline">Ask Basecraft</span>
                </Button>
              </>
            ) : null}
          </div>
        </header>

        <div className="flex h-10 shrink-0 items-end gap-1 border-b bg-[#f3f2ee] px-2 dark:bg-muted/25">
          {visibleTables.map((table) => (
            <button
              key={table.id}
              type="button"
              aria-current={
                section === "table" && table.id === activeTable.id
                  ? "page"
                  : undefined
              }
              onClick={() => setActiveTableId(table.id)}
              className={cn(
                "relative flex h-9 items-center gap-1.5 rounded-t-md px-3 text-xs text-muted-foreground hover:bg-background/70 hover:text-foreground",
                section === "table" &&
                  table.id === activeTable.id &&
                  "bg-background font-medium text-foreground shadow-[0_-1px_0_var(--border),1px_0_0_var(--border),-1px_0_0_var(--border)]",
              )}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: table.color }}
              />
              {table.name}
            </button>
          ))}
          <Button
            variant="ghost"
            size="icon-sm"
            className="mb-1"
            aria-label="Create table"
            onClick={() => setNewTableOpen(true)}
          >
            <Plus />
          </Button>
          <div className="ml-auto mb-1 flex items-center gap-1">
            <Link
              href="/demo/forms"
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-background hover:text-foreground",
                section === "forms" && "bg-background font-medium text-foreground",
              )}
            >
              <FileText className="size-3.5" />
              Forms
            </Link>
            <Link
              href="/demo/analytics"
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-background hover:text-foreground",
                section === "analytics" && "bg-background font-medium text-foreground",
              )}
            >
              <BarChart3 className="size-3.5" />
              Analytics
            </Link>
          </div>
        </div>
        {typeof children === "function"
          ? children({ activeBase, activeTable })
          : children}
      </div>
      <Dialog open={newTableOpen} onOpenChange={setNewTableOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a table</DialogTitle>
            <DialogDescription>
              Add another table to {activeBase.name}. It starts with a
              required Name column.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="new-table-name">Table name</Label>
            <Input
              id="new-table-name"
              autoFocus
              value={newTableName}
              placeholder="e.g. Campaigns"
              onChange={(event) => setNewTableName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") createTable()
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewTableOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createTable} disabled={!newTableName.trim()}>
              Create table
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
