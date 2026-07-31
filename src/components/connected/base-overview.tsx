"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery } from "convex/react"
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  Database,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Table2,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { FloatingAssistantLauncher } from "@/components/assistant/floating-assistant-launcher"
import { ConnectedAssistantSheet } from "@/components/connected/assistant-sheet"
import {
  ConnectionStatus,
  useLiveConnectionHealth,
} from "@/components/connected/connection-status"
import {
  ConnectedTopBar,
} from "@/components/connected/org-states"
import { OrganizationAuthGate } from "@/components/connected/organization-auth-gate"
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
import { publicErrorMessage } from "@/lib/public-errors"
import { useUrlAction } from "@/lib/use-url-action"

type NavigationResource = {
  resourceType: "base" | "table" | "form"
  resourceId: string
  name: string
  context: string
  href: string
  isFavorite: boolean
  lastOpenedAt: number | null
}

export function ConnectedBaseOverview({ baseId }: { baseId: string }) {
  return (
    <OrganizationAuthGate>
      {({ auth }) => (
        <BaseOverviewData
          baseId={baseId as Id<"bases">}
          canManage={auth.orgRole?.replace(/^org:/, "") === "admin"}
          canUseAi={auth.has({ feature: "ai_assistant" })}
        />
      )}
    </OrganizationAuthGate>
  )
}

function BaseOverviewData({
  baseId,
  canManage,
  canUseAi,
}: {
  baseId: Id<"bases">
  canManage: boolean
  canUseAi: boolean
}) {
  const router = useRouter()
  const connectionHealth = useLiveConnectionHealth()
  const base = useQuery(api.bases.get, { baseId }) as
    | Doc<"bases">
    | undefined
  const tables = useQuery(api.tables.list, { baseId }) as
    | Doc<"tables">[]
    | undefined
  const forms = useQuery(api.forms.list, { baseId }) as
    | Doc<"forms">[]
    | undefined
  const navigationPreferences = useQuery(
    api.resourcePreferences.listNavigation,
    { favoriteLimit: 6, recentLimit: 12 },
  ) as
    | {
        favorites: NavigationResource[]
        recent: NavigationResource[]
      }
    | undefined
  const createTable = useMutation(api.tables.create)
  const [dialogOpen, setDialogOpen] = useUrlAction("new-table")
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const redirectStarted = useRef(false)
  const publishedForms =
    forms?.filter((form) => form.status === "published").length ?? 0
  const recentTableRoute =
    tables && navigationPreferences
      ? navigationPreferences.recent.find(
          (resource) =>
            resource.resourceType === "table" &&
            resource.href.startsWith(`/bases/${baseId}/tables/`) &&
            tables.some(
              (table) =>
                resource.resourceId === table._id ||
                resource.href.includes(`/tables/${table._id}`),
            ),
        )
      : undefined
  const redirectTarget =
    tables && navigationPreferences && tables.length > 0
      ? recentTableRoute?.href ??
        `/bases/${baseId}/tables/${tables[0]._id}`
      : undefined

  useEffect(() => {
    if (!redirectTarget || dialogOpen || redirectStarted.current) return
    redirectStarted.current = true
    router.replace(redirectTarget)
  }, [dialogOpen, redirectTarget, router])

  async function submit() {
    const normalizedName = name.trim()
    if (!normalizedName || saving) return
    if (!connectionHealth.canStartWrite) {
      toast.error("Wait for the workspace connection", {
        description: connectionHealth.description,
      })
      return
    }
    setSaving(true)
    try {
      const result = await createTable({
        baseId,
        name: normalizedName,
        afterRank: tables?.at(-1)?.rank,
      })
      toast.success(`${normalizedName} table created`)
      setDialogOpen(false)
      setName("")
      router.push(`/bases/${baseId}/tables/${result.tableId}`)
    } catch (error) {
      toast.error("Could not create the table", {
        description: publicErrorMessage(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="workspace-shell-offset min-h-dvh bg-background">
      <ConnectedTopBar />

      <div className="mx-auto max-w-5xl px-5 py-6 md:px-8 md:py-8">
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 items-center gap-1.5 border-b border-foreground/10 pb-4 text-xs text-muted-foreground"
        >
          <Link
            className="inline-flex items-center gap-1.5 rounded outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            href="/dashboard"
          >
            <ArrowLeft className="size-3.5" />
            Bases
          </Link>
          <ChevronRight className="size-3" />
          <span className="truncate text-foreground">
            {base?.name ?? "Loading base"}
          </span>
        </nav>

        {base === undefined ||
        tables === undefined ||
        navigationPreferences === undefined ? (
          <div
            aria-label="Loading base"
            className="mt-7 animate-pulse"
          >
            <div className="h-8 w-full max-w-xs rounded bg-foreground/10" />
            <div className="mt-3 h-4 w-full max-w-lg rounded bg-foreground/5" />
            <div className="mt-7 h-44 rounded-lg border bg-background" />
          </div>
        ) : redirectTarget && !dialogOpen ? (
          <section className="flex min-h-[50vh] items-center justify-center py-16 text-center">
            <div>
              <span
                className="mx-auto grid size-10 place-items-center rounded-lg text-white"
                style={{ backgroundColor: base.color ?? "#334155" }}
              >
                <Database className="size-4" />
              </span>
              <h1 className="mt-4 text-lg font-semibold tracking-[-0.02em]">
                Opening {recentTableRoute?.name ?? tables[0].name}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Returning to your workspace.
              </p>
              <LoaderCircle className="mx-auto mt-4 size-4 animate-spin text-muted-foreground" />
            </div>
          </section>
        ) : (
          <>
            <header className="mt-6 flex flex-col gap-5 border-b border-foreground/10 pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg text-white"
                  style={{ backgroundColor: base.color ?? "#334155" }}
                >
                  <Database className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-2xl font-semibold tracking-[-0.035em]">
                      {base.name}
                    </h1>
                    <ConnectionStatus health={connectionHealth} />
                  </div>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {base.description ||
                      "A collaborative workspace for tables and forms."}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  className="bg-background"
                  render={<Link href={`/bases/${baseId}/forms`} />}
                  size="sm"
                  variant="outline"
                >
                  <FileText />
                  Forms
                  {forms !== undefined ? (
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {forms.length}
                    </span>
                  ) : null}
                </Button>
                <Button
                  className="bg-slate-950 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
                  disabled={!canManage}
                  onClick={() => setDialogOpen(true)}
                  size="sm"
                  title={
                    canManage
                      ? undefined
                      : "Only organization admins can create tables"
                  }
                >
                  <Plus />
                  New table
                </Button>
              </div>
            </header>

            {!canManage ? (
              <div className="mt-5 flex items-start gap-3 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-100">
                <LockKeyhole className="mt-0.5 size-4 shrink-0" />
                <p>
                  You can work with records. An organization admin manages this
                  base&apos;s structure.
                </p>
              </div>
            ) : null}

            {tables.length ? (
              <div className="mt-7 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
                <section aria-labelledby="tables-heading">
                  <div className="mb-3 flex items-end justify-between">
                    <div>
                      <h2
                        className="text-sm font-semibold"
                        id="tables-heading"
                      >
                        Tables
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Choose where to continue.
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {tables.length} total
                    </span>
                  </div>
                  <div className="overflow-hidden rounded-lg border bg-background">
                    {tables.map((table) => (
                      <Link
                        className="group grid min-h-14 grid-cols-[1.75rem_minmax(0,1fr)_7rem_auto] items-center gap-3 border-b px-3 py-2.5 outline-none transition-colors last:border-b-0 hover:bg-[#f8f8f6] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground dark:hover:bg-muted/30"
                        href={`/bases/${baseId}/tables/${table._id}`}
                        key={table._id}
                      >
                        <span className="grid size-7 place-items-center rounded-md border bg-muted/30">
                          <Table2 className="size-3.5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {table.name}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                            {table.primaryFieldId
                              ? "Ready to edit"
                              : "Choose a main column"}
                          </span>
                        </span>
                        <span className="hidden text-xs text-muted-foreground sm:block">
                          {formatDate(table.updatedAt)}
                        </span>
                        <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                      </Link>
                    ))}
                  </div>
                </section>

                <aside className="rounded-lg border bg-background">
                  <div className="border-b px-4 py-3">
                    <h2 className="text-sm font-medium">Public forms</h2>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {forms === undefined
                        ? "Loading form status…"
                        : publishedForms
                          ? `${publishedForms} live form${publishedForms === 1 ? "" : "s"} collecting responses.`
                          : "No forms are published yet."}
                    </p>
                  </div>
                  <Link
                    className="flex items-center justify-between px-4 py-3 text-xs font-medium outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    href={`/bases/${baseId}/forms`}
                  >
                    Manage forms
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                </aside>
              </div>
            ) : (
              <section className="mt-7 rounded-lg border border-dashed border-foreground/20 bg-background px-5 py-9 sm:px-8">
                <span className="grid size-9 place-items-center rounded-md border bg-muted/30">
                  <Table2 className="size-4" />
                </span>
                <h2 className="mt-5 text-lg font-semibold tracking-[-0.02em]">
                  No tables yet
                </h2>
                <p className="mt-1.5 max-w-xl text-sm leading-6 text-muted-foreground">
                  Create a table to start adding fields and records. A Name
                  field and Grid view are added automatically.
                </p>
                <Button
                  className="mt-5 bg-slate-950 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
                  disabled={!canManage}
                  onClick={() => setDialogOpen(true)}
                  size="sm"
                >
                  <Plus />
                  Create first table
                </Button>
              </section>
            )}
          </>
        )}
      </div>

      {!redirectTarget || dialogOpen ? (
        <FloatingAssistantLauncher
          canUseAi={canUseAi}
          onClick={() => setAssistantOpen(true)}
          open={assistantOpen}
        />
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a table</DialogTitle>
            <DialogDescription>
              A main “Name” column is created automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="connected-table-name">Table name</Label>
            <Input
              autoFocus
              id="connected-table-name"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit()
              }}
              placeholder="e.g. Campaigns"
              value={name}
            />
          </div>
          <DialogFooter>
            <Button onClick={() => setDialogOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={
                !name.trim() ||
                saving ||
                !connectionHealth.canStartWrite
              }
              onClick={() => void submit()}
            >
              {saving ? "Creating…" : "Create table"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConnectedAssistantSheet
        canUseAi={canUseAi}
        context={{
          base: { id: baseId, name: base?.name },
        }}
        onOpenChange={setAssistantOpen}
        open={assistantOpen}
        title="Base analyst"
      />
    </main>
  )
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp))
}
