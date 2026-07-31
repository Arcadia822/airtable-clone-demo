"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useOrganization } from "@clerk/nextjs"
import { useMutation, useQuery } from "convex/react"
import {
  ArrowUpRight,
  CalendarDays,
  Columns3,
  Database,
  GalleryHorizontal,
  LayoutGrid,
  Plus,
  Sparkles,
  Star,
  Table2,
  Users,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { OrganizationAuthGate } from "@/components/connected/organization-auth-gate"
import { ConnectedTopBar } from "@/components/connected/org-states"
import { useLiveConnectionHealth } from "@/components/connected/connection-status"
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

type DashboardBaseSummary = {
  baseId: Id<"bases">
  name: string
  description: string | null
  color: string | null
  rank: string
  tableCount: number
  formCount: number
  isFavorite: boolean
  lastOpenedAt: number | null
  updatedAt: number
}

export function ConnectedDashboard() {
  const { organization } = useOrganization()

  return (
    <OrganizationAuthGate>
      {({ auth }) => (
        <DashboardData
          canCreate={auth.orgRole?.replace(/^org:/, "") === "admin"}
          organizationName={organization?.name ?? "Organization"}
        />
      )}
    </OrganizationAuthGate>
  )
}

function DashboardData({
  canCreate,
  organizationName,
}: {
  canCreate: boolean
  organizationName: string
}) {
  const router = useRouter()
  const connectionHealth = useLiveConnectionHealth()
  const bases = useQuery(api.bases.listDashboardSummaries) as
    | DashboardBaseSummary[]
    | undefined
  const recentViews = useQuery(api.views.listRecent, { limit: 6 })
  const navigationPreferences = useQuery(
    api.resourcePreferences.listNavigation,
    { favoriteLimit: 6, recentLimit: 12 },
  ) as
    | {
        favorites: NavigationResource[]
        recent: NavigationResource[]
      }
    | undefined
  const createBase = useMutation(api.bases.create)
  const installDemoWorkspace = useMutation(api.demoSeed.install)
  const restoreBase = useMutation(api.bases.restore)
  const [dialogOpen, setDialogOpen] = useUrlAction("new-base")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const latestUpdate = bases?.reduce(
    (latest, base) => Math.max(latest, base.updatedAt),
    0,
  )

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
      const baseId = await createBase({
        name: normalizedName,
        description: description.trim() || undefined,
        color: "#2563eb",
        afterRank: bases?.at(-1)?.rank,
      })
      toast.success(`${normalizedName} created`)
      setDialogOpen(false)
      setName("")
      setDescription("")
      router.push(`/bases/${baseId}`)
    } catch (error) {
      toast.error("Could not create the base", {
        description: publicErrorMessage(error),
      })
    } finally {
      setSaving(false)
    }
  }

  async function seedDemo() {
    if (seeding) return
    if (!connectionHealth.canStartWrite) {
      toast.error("Wait for the workspace connection", {
        description: connectionHealth.description,
      })
      return
    }
    setSeeding(true)
    try {
      const result = await installDemoWorkspace({})
      if (result.state === "missing") {
        throw new Error(
          "The demo install marker exists, but its base was removed directly from the database. Ask a deployment admin to repair it.",
        )
      }
      if (result.state === "deleted") {
        await restoreBase({ baseId: result.baseId })
      }
      toast.success(
        result.state === "created"
          ? "Demo workspace is ready"
          : result.state === "deleted"
            ? "Demo workspace restored"
            : "Demo workspace already loaded",
        {
          description: result.state === "created"
            ? `${result.counts.tables} tables and ${result.counts.records} sample records were added.`
            : "Opening the existing demo workspace.",
        },
      )
      router.push(`/bases/${result.baseId}`)
    } catch (error) {
      toast.error("Could not load the demo workspace", {
        description: publicErrorMessage(error),
      })
    } finally {
      setSeeding(false)
    }
  }

  return (
    <main className="workspace-shell-offset min-h-dvh bg-background">
      <ConnectedTopBar />

      <div className="mx-auto max-w-[88rem] px-5 py-7 md:px-8 md:py-9">
        <header className="border-b border-foreground/10 pb-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-3xl font-semibold tracking-[-0.04em]">
                Bases
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                Tables, forms, and recent activity in {organizationName}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canCreate && bases?.length ? (
                <Button
                  aria-busy={seeding}
                  className="h-8 bg-background px-3"
                  disabled={seeding || !connectionHealth.canStartWrite}
                  onClick={() => void seedDemo()}
                  size="sm"
                  variant="outline"
                >
                  <Sparkles />
                  {seeding ? "Loading demo…" : "Load demo"}
                </Button>
              ) : null}
              <Button
                className="h-8 bg-slate-950 px-3 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
                disabled={
                  !canCreate ||
                  seeding ||
                  !connectionHealth.canStartWrite
                }
                onClick={() => setDialogOpen(true)}
                size="sm"
                title={
                  canCreate
                    ? undefined
                    : "Only organization admins can create bases"
                }
              >
                <Plus />
                New base
              </Button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {bases === undefined
                ? "Loading bases…"
                : `${bases.length} ${bases.length === 1 ? "base" : "bases"}`}
            </span>
            <span>{canCreate ? "Admin access" : "Member access"}</span>
            <span
              aria-label={`${connectionHealth.label}. ${connectionHealth.description}`}
              className="inline-flex items-center gap-1.5"
              role="status"
            >
              <span
                className={`size-1.5 rounded-full ${
                  connectionHealth.canStartWrite
                    ? "bg-emerald-500"
                    : "bg-amber-500"
                }`}
              />
              {connectionHealth.label}
            </span>
            {latestUpdate ? (
              <span>Last change {formatDate(latestUpdate)}</span>
            ) : null}
          </div>
        </header>

        {!canCreate ? (
          <div className="mt-5 flex items-start gap-3 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-100">
            <Users className="mt-0.5 size-4 shrink-0" />
            <div>
              <span className="font-medium">Member workspace.</span>{" "}
              You can collaborate on records; organization admins manage
              structure, forms, people, and billing.
            </div>
          </div>
        ) : null}

        <div className="mt-7 grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <section aria-labelledby="bases-list-heading" className="min-w-0">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <h2
                  className="text-sm font-semibold tracking-[-0.01em]"
                  id="bases-list-heading"
                >
                  All bases
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open a base where you last worked.
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {bases?.length ?? 0} total
              </span>
            </div>

            {bases === undefined ? (
              <div className="overflow-hidden rounded-lg border border-foreground/10 bg-background">
                <div className="hidden h-9 border-b bg-muted/25 md:block" />
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    className="grid min-h-16 animate-pulse grid-cols-[2rem_1fr] items-center gap-3 border-b px-3 py-3 last:border-b-0"
                    key={index}
                  >
                    <div className="size-7 rounded-md bg-foreground/10" />
                    <div>
                      <div className="h-3.5 w-36 rounded bg-foreground/10" />
                      <div className="mt-2 h-3 w-52 max-w-full rounded bg-foreground/5" />
                    </div>
                  </div>
                ))}
              </div>
            ) : bases.length ? (
              <div
                aria-label="Bases"
                className="overflow-hidden rounded-lg border border-foreground/10 bg-background"
                role="list"
              >
                <div
                  aria-hidden="true"
                  className="hidden grid-cols-[minmax(15rem,2fr)_4.5rem_4.5rem_7rem_7rem] gap-3 border-b bg-muted/25 px-3 py-2 text-[11px] font-medium text-muted-foreground md:grid"
                >
                  <span>Base</span>
                  <span>Tables</span>
                  <span>Forms</span>
                  <span>Last opened</span>
                  <span>Updated</span>
                </div>
                {bases.map((base) => {
                  const recentTable = navigationPreferences?.recent.find(
                    (resource) =>
                      resource.resourceType === "table" &&
                      resource.href.startsWith(
                        `/bases/${base.baseId}/tables/`,
                      ),
                  )
                  const href =
                    recentTable?.href ?? `/bases/${base.baseId}`

                  return (
                    <div
                      className="border-b last:border-b-0"
                      key={base.baseId}
                      role="listitem"
                    >
                      <Link
                        aria-label={`${base.name} Base`}
                        className="group grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 outline-none transition-colors hover:bg-[#f8f8f6] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground dark:hover:bg-muted/30 md:grid-cols-[minmax(15rem,2fr)_4.5rem_4.5rem_7rem_7rem]"
                        href={href}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span
                            className="grid size-7 shrink-0 place-items-center rounded-md text-white"
                            style={{ backgroundColor: base.color ?? "#334155" }}
                          >
                            <Database className="size-3.5" />
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium">
                                {base.name}
                              </span>
                              {base.isFavorite ? (
                                <Star
                                  aria-label="Favorite"
                                  className="size-3 shrink-0 fill-amber-400 text-amber-500"
                                />
                              ) : null}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                              {recentTable
                                ? `Resume ${recentTable.name}`
                                : base.description ||
                                  "Collaborative data workspace"}
                            </span>
                            <span className="mt-1 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-muted-foreground md:hidden">
                              <span>
                                {base.tableCount}{" "}
                                {base.tableCount === 1 ? "table" : "tables"}
                              </span>
                              <span>
                                {base.formCount}{" "}
                                {base.formCount === 1 ? "form" : "forms"}
                              </span>
                            </span>
                          </span>
                        </span>
                        <span className="hidden text-xs tabular-nums md:block">
                          {base.tableCount}
                        </span>
                        <span className="hidden text-xs tabular-nums md:block">
                          {base.formCount}
                        </span>
                        <span className="hidden text-xs text-muted-foreground md:block">
                          {base.lastOpenedAt
                            ? formatDate(base.lastOpenedAt)
                            : "Not yet"}
                        </span>
                        <span className="hidden items-center justify-between gap-2 text-xs text-muted-foreground md:flex">
                          {formatDate(base.updatedAt)}
                          <ArrowUpRight className="size-3.5 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
                        </span>
                        <ArrowUpRight className="size-4 text-muted-foreground md:hidden" />
                      </Link>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-foreground/20 bg-background px-5 py-9 sm:px-8">
                <div className="grid size-9 place-items-center rounded-md border bg-muted/30">
                  <LayoutGrid className="size-4" />
                </div>
                <h2 className="mt-5 text-lg font-semibold tracking-[-0.02em]">
                  Create your first base
                </h2>
                <p className="mt-1.5 max-w-xl text-sm leading-6 text-muted-foreground">
                  Start from a blank workspace, or load the demo to explore
                  tables, public forms, and collaborative activity.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    className="bg-slate-950 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
                    disabled={
                      !canCreate ||
                      seeding ||
                      !connectionHealth.canStartWrite
                    }
                    onClick={() => setDialogOpen(true)}
                    size="sm"
                  >
                    <Plus />
                    Create a base
                  </Button>
                  {canCreate ? (
                    <Button
                      aria-busy={seeding}
                      disabled={seeding || !connectionHealth.canStartWrite}
                      onClick={() => void seedDemo()}
                      size="sm"
                      variant="outline"
                    >
                      <Sparkles />
                      {seeding ? "Loading demo…" : "Load demo"}
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </section>

          <section aria-labelledby="recent-views-heading">
            <div className="mb-3">
              <h2
                className="text-sm font-semibold tracking-[-0.01em]"
                id="recent-views-heading"
              >
                Jump back in
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Your recently opened views.
              </p>
            </div>
            {recentViews === undefined ? (
              <div
                aria-label="Loading recent views"
                className="overflow-hidden rounded-lg border bg-background"
              >
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    className="h-14 animate-pulse border-b bg-foreground/[0.02] last:border-b-0"
                    key={index}
                  />
                ))}
              </div>
            ) : recentViews.length ? (
              <div className="overflow-hidden rounded-lg border border-foreground/10 bg-background">
                {recentViews.map((view) => {
                  const baseName =
                    bases?.find((base) => base.baseId === view.baseId)?.name ??
                    "Unavailable base"
                  const tableName =
                    [
                      ...(navigationPreferences?.recent ?? []),
                      ...(navigationPreferences?.favorites ?? []),
                    ].find(
                      (resource) =>
                        resource.resourceType === "table" &&
                        resource.resourceId === view.tableId,
                    )?.name ?? "Table"

                  return (
                    <RecentViewLink
                      baseName={baseName}
                      favorite={view.isFavorite}
                      href={`/bases/${view.baseId}/tables/${view.tableId}?view=${view.viewId}`}
                      key={view.viewId}
                      tableName={tableName}
                      type={view.type}
                      viewName={view.name}
                    />
                  )
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                Open a table and your recent views will appear here.
              </div>
            )}
          </section>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a base</DialogTitle>
            <DialogDescription>
              A base can contain multiple tables and public forms.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="connected-base-name">Name</Label>
              <Input
                autoFocus
                id="connected-base-name"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submit()
                }}
                placeholder="e.g. Product launches"
                value={name}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="connected-base-description">
                Description <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="connected-base-description"
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this base tracks"
                value={description}
              />
            </div>
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
              {saving ? "Creating…" : "Create base"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function RecentViewLink({
  baseName,
  favorite,
  href,
  tableName,
  type,
  viewName,
}: {
  baseName: string
  favorite: boolean
  href: string
  tableName: string
  type: "calendar" | "gallery" | "grid" | "kanban"
  viewName: string
}) {
  return (
    <Link
      aria-label={`Open ${viewName} in ${tableName}`}
      className="group grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2.5 border-b px-3 py-2.5 outline-none transition-colors last:border-b-0 hover:bg-[#f8f8f6] focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground dark:hover:bg-muted/30"
      href={href}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-md border bg-muted/30 text-muted-foreground">
        <RecentViewLayoutIcon type={type} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-xs font-medium">
            {viewName}
          </span>
          {favorite ? (
            <Star
              aria-label="Favorite"
              className="size-3 shrink-0 fill-amber-400 text-amber-500"
            />
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
          {baseName} / {tableName}
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="hidden sm:inline">{recentViewLabel(type)}</span>
        <ArrowUpRight className="size-3 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
      </span>
    </Link>
  )
}

function RecentViewLayoutIcon({
  type,
}: {
  type: "calendar" | "gallery" | "grid" | "kanban"
}) {
  if (type === "kanban") return <Columns3 className="size-3.5" />
  if (type === "calendar") return <CalendarDays className="size-3.5" />
  if (type === "gallery") return <GalleryHorizontal className="size-3.5" />
  return <Table2 className="size-3.5" />
}

function recentViewLabel(type: "calendar" | "gallery" | "grid" | "kanban") {
  if (type === "kanban") return "Board view"
  if (type === "calendar") return "Calendar view"
  if (type === "gallery") return "Gallery view"
  return "Grid view"
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp))
}
