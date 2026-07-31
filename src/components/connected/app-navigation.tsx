"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth } from "@clerk/nextjs"
import { useMutation, useQuery } from "convex/react"
import {
  BarChart3,
  CircleDollarSign,
  Clock3,
  FileText,
  FolderKanban,
  Layers3,
  Star,
  Table2,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { Badge } from "@/components/ui/badge"
import {
  getActiveOrganizationPlan,
  type ClerkHas,
} from "@/lib/clerk/entitlements"
import { publicErrorMessage } from "@/lib/public-errors"
import { cn } from "@/lib/utils"

export type ConnectedLocation = {
  baseId?: string
  formId?: string
  tableId?: string
}

type NavigationResource = {
  resourceType: "base" | "table" | "form"
  resourceId: string
  name: string
  context: string
  href: string
  isFavorite: boolean
  lastOpenedAt: number | null
}

export function parseConnectedLocation(pathname: string): ConnectedLocation {
  const segments = pathname.split("/").filter(Boolean)
  if (segments[0] !== "bases" || !segments[1]) {
    return {}
  }
  const location: ConnectedLocation = { baseId: segments[1] }
  if (segments[2] === "tables" && segments[3]) {
    location.tableId = segments[3]
  }
  if (
    segments[2] === "forms" &&
    segments[3] &&
    segments[3] !== "analytics"
  ) {
    location.formId = segments[3]
  }
  return location
}

export function ConnectedAppNavigation({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const auth = useAuth()
  const location = parseConnectedLocation(pathname)
  const bases = useQuery(api.bases.list) as Doc<"bases">[] | undefined
  const tables = useQuery(
    api.tables.list,
    location.baseId
      ? { baseId: location.baseId as Id<"bases"> }
      : "skip",
  ) as Doc<"tables">[] | undefined
  const forms = useQuery(
    api.forms.list,
    location.baseId
      ? { baseId: location.baseId as Id<"bases"> }
      : "skip",
  ) as Doc<"forms">[] | undefined
  const navigationPreferences = useQuery(
    api.resourcePreferences.listNavigation,
    { favoriteLimit: 6, recentLimit: 8 },
  ) as
    | {
        favorites: NavigationResource[]
        recent: NavigationResource[]
      }
    | undefined
  const trackRouteOpen = useMutation(
    api.resourcePreferences.trackRouteOpen,
  )
  const setResourceFavorite = useMutation(
    api.resourcePreferences.setFavorite,
  )
  const trackedRouteRef = useRef<string | undefined>(undefined)
  const [favoritePending, setFavoritePending] = useState<string>()
  const activeBase = bases?.find((base) => base._id === location.baseId)
  const activeForm = forms?.find((form) => form._id === location.formId)
  const analyticsPath =
    location.baseId && location.formId
      ? `/bases/${location.baseId}/forms/${location.formId}/analytics`
      : undefined
  const analyticsOverviewPath = location.baseId
    ? `/bases/${location.baseId}/forms/analytics`
    : undefined
  const onFormsRoute =
    Boolean(location.baseId) &&
    pathname.startsWith(`/bases/${location.baseId}/forms`)
  const onAnalyticsOverview =
    Boolean(analyticsOverviewPath) && pathname === analyticsOverviewPath
  const onFormAnalytics =
    Boolean(location.formId) && pathname.endsWith("/analytics")
  const currentPlan =
    auth.isLoaded && auth.orgId
      ? getActiveOrganizationPlan(auth.has as ClerkHas)
      : null
  const favoriteByResource = useMemo(() => {
    const resources = [
      ...(navigationPreferences?.recent ?? []),
      ...(navigationPreferences?.favorites ?? []),
    ]
    return new Map(
      resources.map((resource) => [
        `${resource.resourceType}:${resource.resourceId}`,
        resource.isFavorite,
      ]),
    )
  }, [navigationPreferences])

  useEffect(() => {
    if (!location.baseId) return
    const routeKey = [
      location.baseId,
      location.tableId ?? "",
      location.formId ?? "",
    ].join(":")
    if (trackedRouteRef.current === routeKey) return
    trackedRouteRef.current = routeKey
    void Promise.resolve(
      trackRouteOpen({
        baseId: location.baseId as Id<"bases">,
        ...(location.tableId
          ? { tableId: location.tableId as Id<"tables"> }
          : {}),
        ...(location.formId
          ? { formId: location.formId as Id<"forms"> }
          : {}),
      }),
    ).catch(() => {
      if (trackedRouteRef.current === routeKey) {
        trackedRouteRef.current = undefined
      }
    })
  }, [
    location.baseId,
    location.formId,
    location.tableId,
    trackRouteOpen,
  ])

  async function toggleFavorite(
    resourceType: NavigationResource["resourceType"],
    resourceId: string,
    name: string,
    favorite: boolean,
  ) {
    const resourceKey = `${resourceType}:${resourceId}`
    if (favoritePending) return
    setFavoritePending(resourceKey)
    try {
      await setResourceFavorite({
        resourceType,
        resourceId,
        favorite,
      })
      toast.success(
        favorite
          ? `${name} added to favorites`
          : `${name} removed from favorites`,
      )
    } catch (error) {
      toast.error("Favorite was not updated", {
        description: publicErrorMessage(error),
      })
    } finally {
      setFavoritePending(undefined)
    }
  }

  function resourceIsFavorite(
    resourceType: NavigationResource["resourceType"],
    resourceId: string,
  ) {
    return (
      favoriteByResource.get(`${resourceType}:${resourceId}`) ?? false
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      {!collapsed ? (
        <div className="border-b border-sidebar-border px-3 py-3">
          <p className="text-[10px] font-medium text-sidebar-foreground/55">
            Current base
          </p>
          <div className="mt-1 flex min-w-0 items-center gap-1">
            <p className="min-w-0 flex-1 truncate text-sm font-semibold tracking-[-0.01em]">
              {activeBase?.name ?? "Workspace overview"}
            </p>
            {activeBase ? (
              <FavoriteButton
                favorite={resourceIsFavorite("base", activeBase._id)}
                loading={favoritePending === `base:${activeBase._id}`}
                name={activeBase.name}
                onToggle={(favorite) =>
                  void toggleFavorite(
                    "base",
                    activeBase._id,
                    activeBase.name,
                    favorite,
                  )
                }
              />
            ) : null}
          </div>
        </div>
      ) : null}

      <nav
        aria-label="App navigation"
        className={cn(
          "min-h-0 flex-1 overflow-y-auto py-2",
          collapsed ? "px-2" : "px-2",
        )}
      >
        <div className="space-y-0.5">
          <NavigationLink
            active={pathname === "/dashboard"}
            collapsed={collapsed}
            href="/dashboard"
            icon={FolderKanban}
            label="Bases"
            onNavigate={onNavigate}
          />
          {location.baseId ? (
            <>
              <NavigationLink
                active={pathname === `/bases/${location.baseId}`}
                collapsed={collapsed}
                description={
                  tables === undefined
                    ? "Loading tables…"
                    : `${tables.length} ${tables.length === 1 ? "table" : "tables"}`
                }
                href={`/bases/${location.baseId}`}
                icon={Layers3}
                label="Tables"
                onNavigate={onNavigate}
              />
              <NavigationLink
                active={
                  onFormsRoute &&
                  !onAnalyticsOverview &&
                  !onFormAnalytics
                }
                collapsed={collapsed}
                description={
                  forms === undefined
                    ? "Loading forms…"
                    : `${forms.length} ${forms.length === 1 ? "form" : "forms"}`
                }
                href={`/bases/${location.baseId}/forms`}
                icon={FileText}
                label="Forms"
                onNavigate={onNavigate}
              />
              {analyticsOverviewPath ? (
                <NavigationLink
                  active={onAnalyticsOverview}
                  collapsed={collapsed}
                  description="All forms in this base"
                  href={analyticsOverviewPath}
                  icon={BarChart3}
                  label="Form analytics"
                  onNavigate={onNavigate}
                />
              ) : null}
              {analyticsPath ? (
                <NavigationLink
                  active={onFormAnalytics}
                  collapsed={collapsed}
                  description={activeForm?.name ?? "Current form"}
                  href={analyticsPath}
                  icon={BarChart3}
                  label="Analytics"
                  onNavigate={onNavigate}
                />
              ) : null}
            </>
          ) : null}
        </div>

        {location.baseId && !collapsed ? (
          <section
            aria-labelledby="workspace-tables-heading"
            className="mt-5 border-t border-foreground/10 pt-4"
          >
            <div className="mb-2 flex items-center gap-2 px-2">
              <h2
                className="font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground"
                id="workspace-tables-heading"
              >
                Tables in {activeBase?.name ?? "this base"}
              </h2>
              {tables ? (
                <Badge
                  className="ml-auto h-4 rounded-full px-1.5 font-mono text-[8px]"
                  variant="outline"
                >
                  {tables.length}
                </Badge>
              ) : null}
            </div>
            <div className="space-y-0.5">
              {tables?.map((table) => (
                <ResourceNavigationRow
                  active={table._id === location.tableId}
                  favorite={resourceIsFavorite("table", table._id)}
                  href={`/bases/${location.baseId}/tables/${table._id}`}
                  icon={Table2}
                  key={table._id}
                  loading={favoritePending === `table:${table._id}`}
                  name={table.name}
                  onNavigate={onNavigate}
                  onToggle={(favorite) =>
                    void toggleFavorite(
                      "table",
                      table._id,
                      table.name,
                      favorite,
                    )
                  }
                />
              ))}
              {tables?.length === 0 ? (
                <p className="px-2.5 py-2 text-xs leading-5 text-muted-foreground">
                  No tables in this base yet.
                </p>
              ) : null}
              {tables === undefined ? (
                <div
                  aria-label="Loading table navigation"
                  className="space-y-1.5 px-2 py-1"
                >
                  <div className="h-7 animate-pulse rounded-lg bg-foreground/5" />
                  <div className="h-7 animate-pulse rounded-lg bg-foreground/5" />
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {location.baseId && !collapsed ? (
          <ResourceCollection
            activeResourceId={location.formId}
            emptyLabel="No forms in this base yet."
            heading={`Forms in ${activeBase?.name ?? "this base"}`}
            headingId="workspace-forms-heading"
            icon={FileText}
            loading={forms === undefined}
            onNavigate={onNavigate}
            resources={(forms ?? []).map((form) => ({
              favorite: resourceIsFavorite("form", form._id),
              href: `/bases/${location.baseId}/forms/${form._id}`,
              id: form._id,
              loading: favoritePending === `form:${form._id}`,
              name: form.name,
              onToggle: (favorite: boolean) =>
                void toggleFavorite(
                  "form",
                  form._id,
                  form.name,
                  favorite,
                ),
            }))}
          />
        ) : null}

        {!collapsed && navigationPreferences?.favorites.length ? (
          <PreferenceNavigationSection
            heading="Favorites"
            icon={Star}
            onNavigate={onNavigate}
            onToggle={toggleFavorite}
            pendingKey={favoritePending}
            resources={navigationPreferences.favorites}
          />
        ) : null}

        {!collapsed && navigationPreferences?.recent.length ? (
          <PreferenceNavigationSection
            heading="Recent"
            icon={Clock3}
            onNavigate={onNavigate}
            onToggle={toggleFavorite}
            pendingKey={favoritePending}
            resources={navigationPreferences.recent}
          />
        ) : null}
      </nav>

      {currentPlan && currentPlan !== "pro" ? (
        <div className="border-t border-foreground/10 p-2">
          <NavigationLink
            active={pathname.startsWith("/pricing")}
            collapsed={collapsed}
            description={
              currentPlan === "starter"
                ? "Compare with Pro"
                : "Compare workspace plans"
            }
            href="/pricing"
            icon={CircleDollarSign}
            label="Upgrade"
            onNavigate={onNavigate}
          />
        </div>
      ) : null}
    </div>
  )
}

function NavigationLink({
  active,
  collapsed = false,
  description,
  href,
  icon: Icon,
  label,
  onNavigate,
}: {
  active: boolean
  collapsed?: boolean
  description?: string
  href: string
  icon: typeof FolderKanban
  label: string
  onNavigate?: () => void
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex min-h-9 items-center rounded-md text-sm text-sidebar-foreground/65 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        collapsed
          ? "justify-center px-2"
          : "gap-2.5 px-2.5 py-1.5",
        active &&
          "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
      )}
      href={href}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
    >
      <Icon className="size-4 shrink-0" />
      <span className={cn("min-w-0 flex-1", collapsed && "sr-only")}>
        <span className="block truncate text-[13px]">{label}</span>
        {description ? (
          <span className="block truncate text-[10px] font-normal text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </Link>
  )
}

function ResourceCollection({
  activeResourceId,
  emptyLabel,
  heading,
  headingId,
  icon,
  loading,
  onNavigate,
  resources,
}: {
  activeResourceId?: string
  emptyLabel: string
  heading: string
  headingId: string
  icon: typeof FolderKanban
  loading: boolean
  onNavigate?: () => void
  resources: Array<{
    favorite: boolean
    href: string
    id: string
    loading: boolean
    name: string
    onToggle: (favorite: boolean) => void
  }>
}) {
  return (
    <section
      aria-labelledby={headingId}
      className="mt-5 border-t border-foreground/10 pt-4"
    >
      <div className="mb-2 flex items-center gap-2 px-2">
        <h2
          className="font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground"
          id={headingId}
        >
          {heading}
        </h2>
        {!loading ? (
          <Badge
            className="ml-auto h-4 rounded-full px-1.5 font-mono text-[8px]"
            variant="outline"
          >
            {resources.length}
          </Badge>
        ) : null}
      </div>
      <div className="space-y-0.5">
        {resources.map((resource) => (
          <ResourceNavigationRow
            active={resource.id === activeResourceId}
            favorite={resource.favorite}
            href={resource.href}
            icon={icon}
            key={resource.id}
            loading={resource.loading}
            name={resource.name}
            onNavigate={onNavigate}
            onToggle={resource.onToggle}
          />
        ))}
        {!loading && resources.length === 0 ? (
          <p className="px-2.5 py-2 text-xs leading-5 text-muted-foreground">
            {emptyLabel}
          </p>
        ) : null}
        {loading ? (
          <div
            aria-label={`Loading ${heading.toLowerCase()}`}
            className="space-y-1.5 px-2 py-1"
          >
            <div className="h-7 animate-pulse rounded-lg bg-foreground/5" />
            <div className="h-7 animate-pulse rounded-lg bg-foreground/5" />
          </div>
        ) : null}
      </div>
    </section>
  )
}

function PreferenceNavigationSection({
  heading,
  icon: Icon,
  onNavigate,
  onToggle,
  pendingKey,
  resources,
}: {
  heading: string
  icon: typeof FolderKanban
  onNavigate?: () => void
  onToggle: (
    resourceType: NavigationResource["resourceType"],
    resourceId: string,
    name: string,
    favorite: boolean,
  ) => Promise<void>
  pendingKey?: string
  resources: NavigationResource[]
}) {
  return (
    <section className="mt-5 border-t border-foreground/10 pt-4">
      <h2 className="mb-2 px-2 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {heading}
      </h2>
      <div className="space-y-0.5">
        {resources.map((resource) => (
          <ResourceNavigationRow
            description={resource.context}
            favorite={resource.isFavorite}
            href={resource.href}
            icon={Icon}
            key={`${resource.resourceType}:${resource.resourceId}`}
            loading={
              pendingKey ===
              `${resource.resourceType}:${resource.resourceId}`
            }
            name={resource.name}
            onNavigate={onNavigate}
            onToggle={(favorite) =>
              void onToggle(
                resource.resourceType,
                resource.resourceId,
                resource.name,
                favorite,
              )
            }
          />
        ))}
      </div>
    </section>
  )
}

function ResourceNavigationRow({
  active = false,
  description,
  favorite,
  href,
  icon: Icon,
  loading,
  name,
  onNavigate,
  onToggle,
}: {
  active?: boolean
  description?: string
  favorite: boolean
  href: string
  icon: typeof FolderKanban
  loading: boolean
  name: string
  onNavigate?: () => void
  onToggle: (favorite: boolean) => void
}) {
  return (
    <div
      className={cn(
        "group flex min-w-0 items-center rounded-lg text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
        active && "bg-background font-medium text-foreground shadow-sm",
      )}
    >
      <Link
        aria-current={active ? "page" : undefined}
        className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href={href}
        onClick={onNavigate}
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{name}</span>
          {description ? (
            <span className="block truncate text-[9px] font-normal text-muted-foreground">
              {description}
            </span>
          ) : null}
        </span>
      </Link>
      <FavoriteButton
        favorite={favorite}
        loading={loading}
        name={name}
        onToggle={onToggle}
      />
    </div>
  )
}

function FavoriteButton({
  favorite,
  loading,
  name,
  onToggle,
}: {
  favorite: boolean
  loading: boolean
  name: string
  onToggle: (favorite: boolean) => void
}) {
  return (
    <button
      aria-label={
        favorite
          ? `Remove ${name} from favorites`
          : `Add ${name} to favorites`
      }
      aria-pressed={favorite}
      className="mr-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-70 outline-none transition hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-40 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 aria-pressed:text-amber-600 aria-pressed:opacity-100"
      disabled={loading}
      onClick={() => onToggle(!favorite)}
      type="button"
    >
      <Star
        aria-hidden="true"
        className={cn("size-3.5", favorite && "fill-current")}
      />
    </button>
  )
}
