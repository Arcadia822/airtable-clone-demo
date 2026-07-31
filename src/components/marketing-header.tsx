"use client"

import Link from "next/link"
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs"
import { useConvexAuth } from "convex/react"
import { ArrowUpRight } from "lucide-react"

import { BrandMark } from "@/components/brand-mark"
import { buttonVariants } from "@/components/ui/button"
import { CLERK_PATHS } from "@/lib/clerk/config"
import { cn } from "@/lib/utils"

type MarketingRoute = "home" | "pricing"

const navigation = [
  { href: "/#product", label: "Product" },
  { href: "/demo", label: "Demo workspace" },
  { href: "/pricing", label: "Pricing", route: "pricing" as const },
]

export function MarketingHeader({
  active = "home",
  authEnabled,
}: {
  active?: MarketingRoute
  authEnabled: boolean
}) {
  return (
    <header className="relative z-30 border-b border-slate-200/90 bg-white/95 text-slate-950 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center px-5 sm:px-8">
        <Link
          href="/"
          aria-label="Basecraft home"
          className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
        >
          <BrandMark treatment="ink" />
        </Link>

        <span
          aria-hidden="true"
          className="mx-5 hidden h-5 w-px bg-slate-200 md:block"
        />
        <nav
          aria-label="Primary navigation"
          className="hidden h-full items-center gap-1 md:flex"
        >
          {navigation.map((item) => {
            const isCurrent = item.route === active

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isCurrent ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-full items-center px-3 text-[13px] font-medium text-slate-500 transition-colors outline-none hover:text-slate-950 focus-visible:text-slate-950",
                  isCurrent &&
                    "text-slate-950 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-slate-950",
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {authEnabled ? <ConnectedHeaderActions /> : <SignedOutActions />}
        </div>
      </div>
    </header>
  )
}

function ConnectedHeaderActions() {
  const { isAuthenticated, isLoading } = useConvexAuth()

  if (isLoading) {
    return (
      <div
        role="status"
        aria-label="Checking your session"
        className="flex items-center gap-2"
      >
        <span className="hidden h-8 w-28 animate-pulse rounded-lg bg-slate-100 sm:block" />
        <span className="size-8 animate-pulse rounded-full bg-slate-100" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <SignedOutActions />
  }

  return (
    <>
      <div className="hidden lg:block">
        <OrganizationSwitcher
          hidePersonal
          afterCreateOrganizationUrl={CLERK_PATHS.afterOrganizationSelection}
          afterSelectOrganizationUrl={CLERK_PATHS.afterOrganizationSelection}
          appearance={{
            elements: {
              rootBox: "max-w-48",
              organizationSwitcherTrigger:
                "h-8 rounded-lg border border-slate-200 bg-white px-2 shadow-none hover:bg-slate-50",
              organizationSwitcherTriggerIcon: "text-slate-500",
            },
          }}
        />
      </div>
      <Link
        href="/dashboard"
        aria-label="Open workspace"
        className={buttonVariants({
          size: "sm",
          className:
            "bg-slate-950 text-white hover:bg-slate-800 focus-visible:ring-slate-950/30",
        })}
      >
        <span className="hidden sm:inline">Open workspace</span>
        <span className="sm:hidden">Workspace</span>
        <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
      </Link>
      <span aria-hidden="true" className="hidden h-5 w-px bg-slate-200 sm:block" />
      <UserButton
        appearance={{
          elements: {
            userButtonAvatarBox:
              "size-8 ring-1 ring-slate-200 ring-offset-1 ring-offset-white",
          },
        }}
      />
    </>
  )
}

function SignedOutActions() {
  return (
    <>
      <Link
        href={CLERK_PATHS.signIn}
        className={buttonVariants({
          variant: "ghost",
          size: "sm",
          className: "hidden text-slate-600 hover:text-slate-950 sm:inline-flex",
        })}
      >
        Sign in
      </Link>
      <Link
        href={CLERK_PATHS.onboarding}
        className={buttonVariants({
          size: "sm",
          className:
            "bg-slate-950 text-white hover:bg-slate-800 focus-visible:ring-slate-950/30",
        })}
      >
        Create workspace
        <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
      </Link>
    </>
  )
}
