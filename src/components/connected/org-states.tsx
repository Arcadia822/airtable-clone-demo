"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs"
import { useQuery } from "convex/react"
import {
  ArrowRight,
  Building2,
  ChevronRight,
  LoaderCircle,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react"
import { useEffect, useState } from "react"

import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { BrandMark } from "@/components/brand-mark"
import {
  ConnectedAppNavigation,
  parseConnectedLocation,
} from "@/components/connected/app-navigation"
import { LiveConnectionStatus } from "@/components/connected/connection-status"
import { ConnectedGlobalSearch } from "@/components/connected/global-search"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

export function ConnectedLoading({ label = "Opening workspace…" }: { label?: string }) {
  return (
    <main className="min-h-dvh bg-[#f6f6f3] dark:bg-background">
      <div className="h-14 border-b border-foreground/10 bg-background">
        <div className="mx-auto flex h-full max-w-[1600px] items-center gap-3 px-4 md:px-6">
          <div className="size-8 animate-pulse rounded-lg bg-foreground/10" />
          <div className="h-3.5 w-20 animate-pulse rounded bg-foreground/10" />
          <div className="mx-1 h-5 w-px bg-border" />
          <div className="h-7 w-36 animate-pulse rounded-md bg-foreground/5" />
          <div className="ml-auto size-7 animate-pulse rounded-full bg-foreground/10" />
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-5 py-10 md:px-8 md:py-14">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin text-foreground" />
          {label}
        </div>
        <div className="mt-6 h-9 w-48 animate-pulse rounded-md bg-foreground/10" />
        <div className="mt-3 h-4 w-full max-w-md animate-pulse rounded bg-foreground/5" />
        <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div className="h-24 animate-pulse bg-background p-4" key={index}>
              <div className="h-2.5 w-16 rounded bg-foreground/5" />
              <div className="mt-5 h-5 w-24 rounded bg-foreground/10" />
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}

export function ActiveOrganizationRequired() {
  return (
    <main className="min-h-dvh bg-[#f6f6f3] dark:bg-background">
      <div className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 md:px-8">
          <Link aria-label="Basecraft home" href="/">
            <BrandMark treatment="ink" />
          </Link>
          <UserButton />
        </div>
      </div>
      <div className="app-grid border-b border-foreground/10">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-[minmax(0,1fr)_24rem] md:px-8 md:py-20">
          <div className="max-w-xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Choose a workspace
            </p>
            <h1 className="mt-5 text-balance text-4xl font-semibold tracking-[-0.045em] md:text-5xl">
              Choose where this work belongs.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
              Your bases, tables, forms, and billing stay with the workspace
              you select.
            </p>
          </div>
          <Card className="self-start border-foreground/10 bg-background shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
            <CardHeader className="border-b">
              <div className="mb-3 grid size-10 place-items-center rounded-lg bg-foreground text-background">
                <Building2 className="size-4" />
              </div>
              <CardTitle>Select an organization</CardTitle>
              <CardDescription>
                Continue with an existing workspace or create a new one.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-[#f8f8f6] p-3 dark:bg-muted/30">
                <OrganizationSwitcher />
              </div>
              <Button
                className="w-full justify-between"
                render={<Link href="/onboarding" />}
                variant="outline"
              >
                Create or join an organization
                <ArrowRight />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}

export function SignedOutState() {
  return (
    <main className="min-h-dvh bg-[#f6f6f3] dark:bg-background">
      <div className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 md:px-8">
          <Link aria-label="Basecraft home" href="/">
            <BrandMark treatment="ink" />
          </Link>
          <UserButton />
        </div>
      </div>
      <div className="app-grid grid min-h-[calc(100dvh-3.5rem)] place-items-center px-5 py-12">
        <Card className="w-full max-w-md border-foreground/10 bg-background shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
          <CardHeader className="border-b">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Secure workspace
            </p>
            <CardTitle className="mt-2 text-xl">Sign in to Basecraft</CardTitle>
            <CardDescription className="leading-6">
              Continue to your shared bases, forms, and activity.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="h-9 w-full justify-between bg-slate-950 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
              render={<Link href="/sign-in" />}
            >
              Continue to sign in
              <ArrowRight />
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

export function OrganizationConnectionRecovery({
  onReload,
  onRetry,
}: {
  onReload: () => void
  onRetry: () => void
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f6f6f3] px-5 py-12 dark:bg-background">
      <Card className="w-full max-w-lg border-foreground/10 bg-background shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
        <CardHeader className="border-b">
          <div className="mb-3 grid size-10 place-items-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300">
            <Building2 className="size-4" />
          </div>
          <CardTitle>Workspace is taking longer to open</CardTitle>
          <CardDescription className="leading-6">
            We couldn&apos;t finish connecting the selected workspace. Your
            work is safe. Try again, choose a different workspace, or reload
            this page.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          <Button onClick={onRetry}>
            Try again
            <ArrowRight />
          </Button>
          <Button onClick={onReload} variant="outline">
            Reload page
          </Button>
          <Button
            className="sm:col-span-2"
            render={<Link href="/onboarding" />}
            variant="ghost"
          >
            Choose another workspace
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}

export function ConnectedTopBar({
  children,
}: {
  children?: React.ReactNode
}) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [navigationCollapsed, setNavigationCollapsed] = useState(false)
  const [navigationPreferenceLoaded, setNavigationPreferenceLoaded] =
    useState(false)

  useEffect(() => {
    const collapsed =
      window.localStorage.getItem("basecraft:workspace-navigation") ===
      "collapsed"
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      document.documentElement.style.setProperty(
        "--workspace-sidebar-width",
        collapsed ? "4rem" : "15rem",
      )
      setNavigationCollapsed(collapsed)
      setNavigationPreferenceLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--workspace-sidebar-width",
      navigationCollapsed ? "4rem" : "15rem",
    )
    if (!navigationPreferenceLoaded) return
    window.localStorage.setItem(
      "basecraft:workspace-navigation",
      navigationCollapsed ? "collapsed" : "expanded",
    )
  }, [navigationCollapsed, navigationPreferenceLoaded])

  return (
    <>
      <header className="workspace-topbar sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex h-12 items-center gap-2 px-3 sm:px-4">
          <Button
            aria-label="Open workspace navigation"
            className="lg:hidden"
            onClick={() => setMobileNavigationOpen(true)}
            size="icon-sm"
            variant="ghost"
          >
            <Menu />
          </Button>

          <Link
            aria-label="Basecraft workspace"
            className="shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            href="/dashboard"
          >
            <BrandMark
              className="[&>span:last-child]:hidden sm:[&>span:last-child]:inline"
              treatment="ink"
            />
          </Link>

          <ConnectedShellBreadcrumbs className="hidden min-w-0 flex-1 sm:flex" />

          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            <ConnectedGlobalSearch />
            <LiveConnectionStatus className="hidden 2xl:inline-flex" />
            {children ? (
              <div className="flex min-w-0 items-center">{children}</div>
            ) : null}
            <UserButton />
          </div>
        </div>
      </header>

      <aside className="workspace-sidebar fixed inset-y-0 left-0 z-50 hidden overflow-hidden border-r border-sidebar-border bg-sidebar transition-[width] duration-200 lg:flex lg:flex-col">
        <div
          className={cn(
            "flex h-12 shrink-0 items-center border-b border-sidebar-border",
            navigationCollapsed
              ? "justify-center px-2"
              : "justify-between px-3",
          )}
        >
          {navigationCollapsed ? (
            <Button
              aria-label="Expand workspace navigation"
              className="w-full"
              onClick={() => setNavigationCollapsed(false)}
              size="icon-sm"
              variant="ghost"
            >
              <PanelLeftOpen />
            </Button>
          ) : (
            <>
              <Link
                aria-label="Basecraft workspace"
                className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                href="/dashboard"
              >
                <BrandMark
                  className="[&>span:first-child]:size-7 [&>span:first-child]:rounded-md"
                  treatment="ink"
                />
              </Link>
              <Button
                aria-label="Collapse workspace navigation"
                onClick={() => setNavigationCollapsed(true)}
                size="icon-sm"
                variant="ghost"
              >
                <PanelLeftClose />
              </Button>
            </>
          )}
        </div>
        <div
          className={cn(
            "shrink-0 border-b border-sidebar-border",
            navigationCollapsed ? "px-2 py-2" : "px-3 py-2.5",
          )}
        >
          <div
            className={cn(
              "overflow-hidden",
              navigationCollapsed ? "w-9" : "w-full",
            )}
          >
            <OrganizationSwitcher
              appearance={{
                elements: {
                  rootBox: navigationCollapsed
                    ? "w-9 overflow-hidden"
                    : "w-full",
                  organizationPreviewTextContainer:
                    navigationCollapsed ? "hidden" : "",
                  organizationSwitcherTrigger:
                    "h-9 w-full justify-start rounded-md border border-sidebar-border bg-sidebar-accent/50 px-2 shadow-none hover:bg-sidebar-accent",
                },
              }}
            />
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <ConnectedAppNavigation collapsed={navigationCollapsed} />
        </div>
      </aside>

      <Sheet
        onOpenChange={setMobileNavigationOpen}
        open={mobileNavigationOpen}
      >
        <SheetContent
          className="flex w-[min(19rem,calc(100vw-2rem))] flex-col overflow-hidden p-0"
          side="left"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Workspace navigation</SheetTitle>
          </SheetHeader>
          <div className="flex h-12 items-center justify-between border-b px-3">
            <BrandMark
              className="[&>span:first-child]:size-7 [&>span:first-child]:rounded-md"
              treatment="ink"
            />
          </div>
          <div className="border-b px-3 py-2">
            <OrganizationSwitcher />
          </div>
          <div className="min-h-0 flex-1">
            <ConnectedAppNavigation
              onNavigate={() => setMobileNavigationOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function ConnectedShellBreadcrumbs({
  className,
}: {
  className?: string
}) {
  const pathname = usePathname()
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
  const activeBase = bases?.find((base) => base._id === location.baseId)
  const activeTable = tables?.find(
    (table) => table._id === location.tableId,
  )
  const activeForm = forms?.find((form) => form._id === location.formId)
  const items: Array<{ href?: string; label: string }> = [
    { href: "/dashboard", label: "Bases" },
  ]

  if (activeBase) {
    items.push({
      href: `/bases/${activeBase._id}`,
      label: activeBase.name,
    })
  }
  if (activeTable) {
    items.push({ label: activeTable.name })
  } else if (activeForm) {
    items.push({
      href: `/bases/${location.baseId}/forms`,
      label: "Forms",
    })
    items.push({ label: activeForm.name })
  } else if (location.baseId && pathname.endsWith("/forms")) {
    items.push({ label: "Forms" })
  } else if (location.baseId && pathname.includes("/forms/analytics")) {
    items.push({ label: "Form analytics" })
  }

  if (pathname.endsWith("/analytics") && activeForm) {
    items.push({ label: "Analytics" })
  }

  return (
    <nav
      aria-label="Workspace breadcrumb"
      className={cn("min-w-0 items-center", className)}
    >
      <ol className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        {items.map((item, index) => {
          const current = index === items.length - 1
          return (
            <li
              className="flex min-w-0 items-center gap-1.5"
              key={`${item.href ?? "current"}:${item.label}`}
            >
              {index ? (
                <ChevronRight className="size-3 shrink-0 opacity-55" />
              ) : null}
              {item.href && !current ? (
                <Link
                  className="max-w-44 truncate rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  href={item.href}
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={current ? "page" : undefined}
                  className="max-w-52 truncate font-medium text-foreground"
                >
                  {item.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
