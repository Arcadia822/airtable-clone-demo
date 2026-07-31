"use client"

import Link from "next/link"
import { useMemo, useState, type ReactNode } from "react"
import {
  SignInButton,
  useAuth,
  useOrganization,
} from "@clerk/nextjs"
import { useConvexAuth } from "convex/react"
import {
  CheckoutButton,
  SubscriptionDetailsButton,
  usePlans,
  useSubscription,
} from "@clerk/nextjs/experimental"
import {
  ArrowRight,
  Building2,
  Check,
  CircleAlert,
  CreditCard,
  Loader2,
  ShieldCheck,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { CLERK_PATHS } from "@/lib/clerk/config"
import {
  clerkPlanSlugMatches,
  getActiveOrganizationPlan,
  type ClerkHas,
} from "@/lib/clerk/entitlements"
import {
  PLAN_DEFINITIONS,
  PLAN_LIST,
  type PlanDefinition,
  type PlanSlug,
} from "@/lib/plans"
import { cn } from "@/lib/utils"

type BillingPeriod = "month" | "annual"
type ClerkPlanPrice = {
  amount: number
  amountFormatted: string
  currency: string
  currencySymbol: string
}
type ClerkPlanSummary = {
  id: string
  slug: string
  fee: ClerkPlanPrice | null
  annualFee: ClerkPlanPrice | null
}
type ViewerState =
  | "loading"
  | "signed-out"
  | "organization-required"
  | "ready"

export function OrganizationPricingTable({
  clerkEnabled,
}: {
  clerkEnabled: boolean
}) {
  if (!clerkEnabled) {
    return <DemoPricingTable />
  }

  return <ConnectedPricingTable />
}

function ConnectedPricingTable() {
  const [period, setPeriod] = useState<BillingPeriod>("month")
  const { isLoaded, orgId, orgRole, has } = useAuth()
  const convexAuth = useConvexAuth()
  const plans = usePlans({
    for: "organization",
    pageSize: 20,
  })

  const viewerState: ViewerState = !isLoaded || convexAuth.isLoading
    ? "loading"
    : !convexAuth.isAuthenticated
      ? "signed-out"
      : !orgId
        ? "organization-required"
        : "ready"

  const currentPlan =
    viewerState === "ready"
      ? getActiveOrganizationPlan(has as ClerkHas)
      : null
  const canManageBilling =
    viewerState === "ready" &&
    orgRole?.replace(/^org:/, "") === "admin"

  const clerkPlansBySlug = useMemo(
    () =>
      Object.fromEntries(
        PLAN_LIST.map((plan) => [
          plan.slug,
          plans.data.find((candidate) =>
            clerkPlanSlugMatches(plan.slug, candidate.slug),
          ),
        ]),
      ) as Partial<Record<PlanSlug, ClerkPlanSummary>>,
    [plans.data],
  )
  const clerkPlanIds = useMemo(
    () =>
      Object.fromEntries(
        PLAN_LIST.map((plan) => [
          plan.slug,
          clerkPlansBySlug[plan.slug]?.id,
        ]),
      ) as Partial<Record<PlanSlug, string>>,
    [clerkPlansBySlug],
  )

  const missingPaidPlans = PLAN_LIST.filter(
    (plan) => plan.slug !== "free" && !clerkPlanIds[plan.slug],
  )
  const catalogNeedsSetup =
    Boolean(plans.error) || (!plans.isLoading && missingPaidPlans.length > 0)

  return (
    <PricingPageShell
      period={period}
      onPeriodChange={setPeriod}
      banner={
        catalogNeedsSetup ? (
          <CatalogSetupNotice missingPlans={missingPaidPlans} />
        ) : null
      }
      subscription={
        <ViewerSubscriptionSummary
          viewerState={viewerState}
          currentPlan={currentPlan}
          canManageBilling={canManageBilling}
        />
      }
    >
      {PLAN_LIST.map((plan) => (
        <PlanCard
          key={plan.slug}
          plan={plan}
          period={period}
          catalogPlan={clerkPlansBySlug[plan.slug]}
          cta={
            <ConnectedPlanCta
              plan={plan}
              period={period}
              viewerState={viewerState}
              currentPlan={currentPlan}
              clerkPlanId={clerkPlanIds[plan.slug]}
              catalogLoading={plans.isLoading}
              canManageBilling={canManageBilling}
            />
          }
        />
      ))}
    </PricingPageShell>
  )
}

function DemoPricingTable() {
  const [period, setPeriod] = useState<BillingPeriod>("month")

  return (
    <PricingPageShell
      period={period}
      onPeriodChange={setPeriod}
      banner={<DemoSetupNotice />}
      subscription={
        <div className="flex items-center gap-3 rounded-2xl border border-dashed bg-background/70 p-4">
          <span className="grid size-9 place-items-center rounded-xl bg-muted text-muted-foreground">
            <CreditCard className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium">Subscription preview</p>
            <p className="text-xs leading-5 text-muted-foreground">
              Current workspace and subscription details appear here after
              billing is connected.
            </p>
          </div>
        </div>
      }
    >
      {PLAN_LIST.map((plan) => (
        <PlanCard
          key={plan.slug}
          plan={plan}
          period={period}
          cta={
            <Button className="w-full" size="lg" disabled>
              {plan.slug === "free"
                ? "Free included after setup"
                : `${plan.name} available after setup`}
            </Button>
          }
        />
      ))}
    </PricingPageShell>
  )
}

function PricingPageShell({
  period,
  onPeriodChange,
  banner,
  subscription,
  children,
}: {
  period: BillingPeriod
  onPeriodChange: (period: BillingPeriod) => void
  banner: ReactNode
  subscription: ReactNode
  children: ReactNode
}) {
  return (
    <main className="min-h-dvh bg-[#f6f6f3] dark:bg-background">
      <div className="app-grid border-b border-foreground/10 bg-background">
        <section className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-16 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Plans for organizations
            </p>
            <h1 className="mt-4 text-balance text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
              One workspace. Three clear plans.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              Realtime tables and public forms are included from day one.
              Choose more capacity, analytics, branding, and AI when your team
              is ready for them.
            </p>
          </div>
          <div
            className="inline-flex w-fit items-center rounded-lg border bg-background p-1"
            role="group"
            aria-label="Billing period"
          >
            <Button
              variant={period === "month" ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={period === "month"}
              onClick={() => onPeriodChange("month")}
            >
              Monthly
            </Button>
            <Button
              variant={period === "annual" ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={period === "annual"}
              onClick={() => onPeriodChange("annual")}
            >
              Annual
              <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                2 months free
              </span>
            </Button>
          </div>
        </section>
      </div>

      <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-12">
        <div className="mx-auto mt-10 max-w-4xl space-y-4">
          {banner}
          {subscription}
        </div>

        <section className="mt-10 grid gap-5 lg:grid-cols-3">{children}</section>

        <section className="mt-12 grid gap-4 rounded-2xl border bg-card/80 p-5 shadow-sm sm:grid-cols-3 sm:p-6">
          <TrustPoint
            icon={<Building2 className="size-4" />}
            title="Billed to your workspace"
            description="Checkout always applies to the workspace you currently have open."
          />
          <TrustPoint
            icon={<ShieldCheck className="size-4" />}
            title="Access updates automatically"
            description="Your plan and included features update as soon as checkout completes."
          />
          <TrustPoint
            icon={<CreditCard className="size-4" />}
            title="Secure hosted checkout"
            description="Payment details stay inside a secure hosted checkout."
          />
        </section>
      </div>
    </main>
  )
}

function PlanCard({
  plan,
  period,
  catalogPlan,
  cta,
}: {
  plan: PlanDefinition
  period: BillingPeriod
  catalogPlan?: Pick<ClerkPlanSummary, "annualFee" | "fee">
  cta: ReactNode
}) {
  const monthlyPrice = catalogPlan?.fee
    ? decimalMoney(catalogPlan.fee)
    : plan.monthlyBasePrice
  const annualPrice = catalogPlan?.annualFee
    ? decimalMoney(catalogPlan.annualFee)
    : plan.annualBasePrice
  const currency =
    catalogPlan?.fee?.currency ??
    catalogPlan?.annualFee?.currency ??
    "USD"
  const monthlyEquivalent =
    period === "month"
      ? monthlyPrice
      : annualPrice / 12
  const extraSeatEquivalent =
    period === "month"
      ? plan.monthlyExtraSeatPrice
      : plan.annualExtraSeatPrice / 12
  const featured = plan.slug === "pro"

  return (
    <Card
      className={cn(
        "relative h-full gap-0 py-0",
        featured &&
          "border-foreground/35 shadow-md",
      )}
    >
      {featured ? (
        <div className="border-b bg-slate-950 px-4 py-2 text-center text-xs font-semibold tracking-wide text-white uppercase dark:bg-slate-100 dark:text-slate-950">
          Includes AI assistant
        </div>
      ) : null}

      <CardHeader className="gap-3 px-6 pt-6">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
            {plan.eyebrow}
          </p>
          <h2 className="mt-2 font-heading text-2xl font-medium tracking-[-0.025em]">
            {plan.name}
          </h2>
        </div>
        <CardDescription className="min-h-12 leading-6">
          {plan.description}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col px-6 pb-6">
        <div className="mt-6 border-y py-5">
          <div className="flex items-end gap-1">
            <span className="text-4xl font-semibold tracking-[-0.04em]">
              {formatPlanMoney(monthlyEquivalent, currency)}
            </span>
            <span className="pb-1 text-sm text-muted-foreground">/ month</span>
          </div>
          <p className="mt-1 min-h-5 text-xs text-muted-foreground">
            {monthlyPrice === 0
              ? "Free forever"
              : period === "annual" && annualPrice > 0
              ? `${formatPlanMoney(annualPrice, currency)} billed annually`
              : "Billed month to month"}
          </p>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Includes {plan.includedSeats}{" "}
            {plan.includedSeats === 1 ? "seat" : "seats"}
            {extraSeatEquivalent > 0
              ? `, then ${formatDollars(extraSeatEquivalent)} per extra seat / month`
              : ""}
          </p>
        </div>

        <div className="mt-6 flex-1">
          <p className="text-xs font-semibold tracking-[0.12em] uppercase">
            What&apos;s included
          </p>
          <ul className="mt-4 space-y-3">
            {plan.highlights.map((highlight) => (
              <li
                key={highlight}
                className="flex items-start gap-2.5 text-sm leading-5"
              >
                <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <Check className="size-3" strokeWidth={2.5} />
                </span>
                {highlight}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-7">{cta}</div>
      </CardContent>
    </Card>
  )
}

function ConnectedPlanCta({
  plan,
  period,
  viewerState,
  currentPlan,
  clerkPlanId,
  catalogLoading,
  canManageBilling,
}: {
  plan: PlanDefinition
  period: BillingPeriod
  viewerState: ViewerState
  currentPlan: PlanSlug | null
  clerkPlanId: string | undefined
  catalogLoading: boolean
  canManageBilling: boolean
}) {
  if (viewerState === "loading") {
    return (
      <Button className="w-full" size="lg" disabled>
        <Loader2 className="animate-spin" />
        Loading
      </Button>
    )
  }

  if (viewerState === "signed-out") {
    return (
      <SignInButton mode="modal" fallbackRedirectUrl={CLERK_PATHS.pricing}>
        <Button
          className="w-full"
          size="lg"
          variant={plan.slug === "pro" ? "default" : "outline"}
        >
          Sign in to choose {plan.name}
          <ArrowRight data-icon="inline-end" />
        </Button>
      </SignInButton>
    )
  }

  if (viewerState === "organization-required") {
    return (
      <Link
        href={CLERK_PATHS.onboarding}
        className={cn(
          buttonVariants({
            variant: plan.slug === "pro" ? "default" : "outline",
            size: "lg",
          }),
          "w-full",
        )}
      >
        Choose an organization
        <ArrowRight data-icon="inline-end" />
      </Link>
    )
  }

  if (currentPlan === plan.slug) {
    return (
      <Button className="w-full" size="lg" variant="secondary" disabled>
        <Check />
        Current plan
      </Button>
    )
  }

  if (plan.slug === "free") {
    return (
      <Button className="w-full" size="lg" variant="outline" disabled>
        Included in every workspace
      </Button>
    )
  }

  if (!canManageBilling) {
    return (
      <Button className="w-full" size="lg" variant="outline" disabled>
        Ask an organization admin
      </Button>
    )
  }

  if (catalogLoading) {
    return (
      <Button className="w-full" size="lg" disabled>
        <Loader2 className="animate-spin" />
        Loading plan
      </Button>
    )
  }

  if (!clerkPlanId) {
    return (
      <Button className="w-full" size="lg" variant="outline" disabled>
        Upgrade unavailable
      </Button>
    )
  }

  return (
    <CheckoutButton
      planId={clerkPlanId}
      planPeriod={period}
      for="organization"
      newSubscriptionRedirectUrl={CLERK_PATHS.pricing}
    >
      <Button
        className="w-full"
        size="lg"
        variant={plan.slug === "pro" ? "default" : "outline"}
      >
        {currentPlan === "free" ? "Choose" : "Switch to"} {plan.name}
        <ArrowRight data-icon="inline-end" />
      </Button>
    </CheckoutButton>
  )
}

function ViewerSubscriptionSummary({
  viewerState,
  currentPlan,
  canManageBilling,
}: {
  viewerState: ViewerState
  currentPlan: PlanSlug | null
  canManageBilling: boolean
}) {
  if (viewerState === "loading") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border bg-background/80 p-4">
        <Loader2 className="size-4 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          Checking your organization subscription…
        </p>
      </div>
    )
  }

  if (viewerState === "signed-out") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border bg-background/80 p-4">
        <CreditCard className="size-4 text-primary" />
        <p className="text-sm text-muted-foreground">
          Sign in to see the active organization&apos;s current subscription.
        </p>
      </div>
    )
  }

  if (viewerState === "organization-required") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4">
        <Building2 className="size-4 text-amber-700 dark:text-amber-400" />
        <p className="text-sm text-muted-foreground">
          Choose or create a workspace before starting checkout.
        </p>
      </div>
    )
  }

  return (
    <CurrentOrganizationSubscription
      currentPlan={currentPlan ?? "free"}
      canManageBilling={canManageBilling}
    />
  )
}

function CurrentOrganizationSubscription({
  currentPlan,
  canManageBilling,
}: {
  currentPlan: PlanSlug
  canManageBilling: boolean
}) {
  const { organization } = useOrganization()
  const subscription = useSubscription({ for: "organization" })
  const plan = PLAN_DEFINITIONS[currentPlan]

  if (subscription.isLoading) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border bg-background/80 p-4">
        <Loader2 className="size-4 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          Loading {organization?.name ?? "organization"} billing…
        </p>
      </div>
    )
  }

  const isPastDue = subscription.data?.status === "past_due"
  const nextPayment = subscription.data?.nextPayment

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-2xl border bg-background/85 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between",
        isPastDue && "border-destructive/30 bg-destructive/[0.035]",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary",
            isPastDue && "bg-destructive/10 text-destructive",
          )}
        >
          {isPastDue ? (
            <CircleAlert className="size-5" />
          ) : (
            <CreditCard className="size-5" />
          )}
        </span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">
              {organization?.name ?? "Active organization"}
            </p>
            <Badge variant={isPastDue ? "destructive" : "secondary"}>
              {plan.name}
            </Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {isPastDue
              ? "Payment is past due. Some paid features may be temporarily unavailable."
              : nextPayment
                ? `Next payment ${formatMoney(nextPayment.amount)} on ${formatDate(nextPayment.date)}.`
                : currentPlan === "free"
                  ? "Free organization plan — no upcoming payment."
                  : "Subscription is active."}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className={cn(
            "capitalize",
            isPastDue && "border-destructive/30 text-destructive",
          )}
        >
          {subscriptionStatusLabel(subscription.data?.status)}
        </Badge>
        {canManageBilling ? (
          <SubscriptionDetailsButton for="organization">
            <Button size="sm" variant="outline">
              Manage billing
            </Button>
          </SubscriptionDetailsButton>
        ) : (
          <span className="text-xs text-muted-foreground">
            Admin-managed billing
          </span>
        )}
      </div>
    </div>
  )
}

function DemoSetupNotice() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-dashed border-primary/35 bg-primary/[0.045] p-4">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
      <div>
        <p className="text-sm font-medium">Upgrades are not available yet</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          You can compare every plan, but checkout is disabled until billing is
          ready for this workspace.
        </p>
      </div>
    </div>
  )
}

function CatalogSetupNotice({
  missingPlans,
}: {
  missingPlans: PlanDefinition[]
}) {
  const names =
    missingPlans.length > 0
      ? missingPlans.map((plan) => plan.name).join(" and ")
      : "Starter and Pro"

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
      <div>
        <p className="text-sm font-medium">
          Some upgrades are temporarily unavailable
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {names} checkout is not ready for this workspace. Your current plan is
          unchanged, and the plan comparison remains available.
        </p>
      </div>
    </div>
  )
}

function subscriptionStatusLabel(status: string | undefined) {
  const labels: Record<string, string> = {
    active: "Active",
    canceled: "Canceled",
    ended: "Ended",
    incomplete: "Action required",
    incomplete_expired: "Expired",
    past_due: "Payment overdue",
    paused: "Paused",
    trialing: "Trial",
    unpaid: "Payment required",
  }

  return status ? (labels[status] ?? "Status unavailable") : "Active"
}

function TrustPoint({
  icon,
  title,
  description,
}: {
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  )
}

function formatDollars(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function decimalMoney(amount: ClerkPlanPrice) {
  const formatted = Number(amount.amountFormatted.replaceAll(",", ""))
  return Number.isFinite(formatted) ? formatted : amount.amount / 100
}

function formatPlanMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatMoney(amount: {
  amountFormatted: string
  currency: string
  currencySymbol: string
}) {
  return `${amount.currencySymbol}${amount.amountFormatted} ${amount.currency}`
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(date)
}
