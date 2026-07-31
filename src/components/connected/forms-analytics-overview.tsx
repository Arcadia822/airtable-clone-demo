"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useQuery } from "convex/react"
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Eye,
  FileCheck2,
  FileText,
  ShieldCheck,
} from "lucide-react"
import { useState } from "react"

import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { FormBreadcrumbs } from "@/components/connected/form-breadcrumbs"
import { FormAnalyticsUpgrade } from "@/components/connected/form-analytics"
import { OrganizationAuthGate } from "@/components/connected/organization-auth-gate"
import {
  ConnectedLoading,
  ConnectedTopBar,
} from "@/components/connected/org-states"
import { SearchableSelect } from "@/components/searchable-select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  CardContent,
  Card,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"

type FormWithStats = Doc<"forms"> & {
  stats: {
    views: number
    submissions: number
    conversionRate: number
  }
}

export function ConnectedFormsAnalyticsOverview({
  baseId,
}: {
  baseId: string
}) {
  return (
    <OrganizationAuthGate>
      {({ auth }) =>
        !auth.has({ feature: "form_analytics" }) ? (
          <FormAnalyticsUpgrade baseId={baseId} />
        ) : (
          <FormsAnalyticsOverviewData
            baseId={baseId as Id<"bases">}
          />
        )
      }
    </OrganizationAuthGate>
  )
}

function FormsAnalyticsOverviewData({
  baseId,
}: {
  baseId: Id<"bases">
}) {
  const router = useRouter()
  const base = useQuery(api.bases.get, { baseId })
  const forms = useQuery(api.forms.list, { baseId }) as
    | FormWithStats[]
    | undefined
  const tables = useQuery(api.tables.list, { baseId }) as
    | Doc<"tables">[]
    | undefined
  const [selectedFormId, setSelectedFormId] = useState("")

  if (base === undefined || forms === undefined || tables === undefined) {
    return <ConnectedLoading label="Preparing form analytics…" />
  }

  const totals = forms.reduce(
    (sum, form) => ({
      views: sum.views + form.stats.views,
      submissions: sum.submissions + form.stats.submissions,
    }),
    { views: 0, submissions: 0 },
  )
  const conversion =
    totals.views > 0
      ? `${((totals.submissions / totals.views) * 100).toFixed(1)}%`
      : "—"
  const liveForms = forms.filter(
    (form) => form.status === "published",
  ).length
  const tableNames = new Map(
    tables.map((table) => [table._id, table.name]),
  )

  function openFormReport(formId: string) {
    setSelectedFormId(formId)
    router.push(`/bases/${baseId}/forms/${formId}/analytics`)
  }

  return (
    <main className="workspace-shell-offset min-h-dvh bg-muted/20">
      <ConnectedTopBar>
        <Button
          render={<Link href={`/bases/${baseId}/forms`} />}
          size="sm"
          variant="ghost"
        >
          <ArrowLeft />
          Public forms
        </Button>
      </ConnectedTopBar>

      <div className="mx-auto max-w-7xl px-5 py-6 md:px-8 md:py-8">
        <FormBreadcrumbs
          className="mb-6"
          items={[
            {
              href: `/bases/${baseId}`,
              label: base.name,
            },
            {
              href: `/bases/${baseId}/forms`,
              label: "Forms",
            },
            { label: "Analytics" },
          ]}
        />
        <div className="flex flex-col gap-4 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.025em]">
              Form analytics
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Performance across every public form in {base.name}.
            </p>
          </div>

          {forms.length ? (
            <div className="grid min-w-72 gap-1.5">
              <Label
                className="text-xs text-muted-foreground"
                htmlFor="form-report-selector"
              >
                Jump to a report
              </Label>
              <SearchableSelect
                id="form-report-selector"
                onValueChange={openFormReport}
                options={forms.map((form) => ({
                  value: form._id,
                  label: form.name,
                  description: `${statusLabel(form.status)} · ${form.stats.submissions.toLocaleString()} responses`,
                }))}
                placeholder="Choose a form by name"
                searchPlaceholder="Search forms by name…"
                value={selectedFormId}
              />
            </div>
          ) : null}
        </div>

        <section
          aria-label="All forms summary"
          className="mt-6 grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 xl:grid-cols-4"
        >
          <OverviewMetric
            detail={`${liveForms} currently accepting responses`}
            icon={FileText}
            label="Forms"
            value={forms.length.toLocaleString()}
          />
          <OverviewMetric
            detail="Privacy-safe recorded visits"
            icon={Eye}
            label="Views"
            value={totals.views.toLocaleString()}
          />
          <OverviewMetric
            detail="Records created from forms"
            icon={FileCheck2}
            label="Responses"
            value={totals.submissions.toLocaleString()}
          />
          <OverviewMetric
            detail={
              totals.views
                ? "Responses divided by recorded views"
                : "Starts after the first recorded view"
            }
            icon={BarChart3}
            label="Overall conversion"
            value={conversion}
          />
        </section>

        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-4" />
          Counts are scoped to this organization and do not reveal visitor
          identity.
        </div>

        {forms.length ? (
          <section className="mt-5 overflow-hidden rounded-lg border bg-background">
            <div className="hidden h-9 grid-cols-[minmax(14rem,1.6fr)_minmax(8rem,1fr)_6rem_7rem_7rem_2rem] items-center gap-3 border-b bg-muted/45 px-4 text-[11px] font-medium text-muted-foreground md:grid">
              <span>Form</span>
              <span>Response table</span>
              <span className="text-right">Views</span>
              <span className="text-right">Responses</span>
              <span className="text-right">Conversion</span>
              <span />
            </div>
            <div className="divide-y">
              {forms.map((form) => {
                const tableName =
                  tableNames.get(form.tableId) ?? "Response table"
                const conversionRate = form.stats.views
                  ? `${(form.stats.conversionRate * 100).toFixed(1)}%`
                  : "—"
                return (
                  <Link
                    aria-label={`View ${form.name} analytics`}
                    className="group grid min-h-16 items-center gap-2 px-4 py-3 outline-none transition-colors hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid-cols-[minmax(14rem,1.6fr)_minmax(8rem,1fr)_6rem_7rem_7rem_2rem] md:gap-3"
                    href={`/bases/${baseId}/forms/${form._id}/analytics`}
                    key={form._id}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {form.name}
                        </span>
                        <Badge
                          className="h-5 rounded-md px-1.5 text-[10px] shadow-none"
                          variant="secondary"
                        >
                          {statusLabel(form.status)}
                        </Badge>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {form.title}
                      </span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {tableName}
                    </span>
                    <NamedStat
                      label="Views"
                      value={form.stats.views.toLocaleString()}
                    />
                    <NamedStat
                      label="Responses"
                      value={form.stats.submissions.toLocaleString()}
                    />
                    <NamedStat
                      label="Conversion"
                      value={conversionRate}
                    />
                    <ArrowRight className="hidden size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 md:block" />
                  </Link>
                )
              })}
            </div>
          </section>
        ) : (
          <Card className="mt-8 border-dashed">
            <CardContent className="grid place-items-center px-6 py-16 text-center">
              <div>
                <FileText className="mx-auto size-6 text-muted-foreground" />
                <h2 className="mt-4 font-semibold">No forms to report on</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create a public form, then activity will appear here by name.
                </p>
                <Button
                  className="mt-5"
                  render={<Link href={`/bases/${baseId}/forms`} />}
                >
                  Create a form
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  )
}

function OverviewMetric({
  detail,
  icon: Icon,
  label,
  value,
}: {
  detail: string
  icon: typeof FileText
  label: string
  value: string
}) {
  return (
    <div className="bg-background p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">
            {label}
          </p>
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <p className="text-xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">
          {detail}
        </p>
    </div>
  )
}

function NamedStat({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs md:block md:text-right">
      <p className="font-medium tabular-nums">{value}</p>
      <p className="text-muted-foreground md:sr-only">{label}</p>
    </div>
  )
}

function statusLabel(status: Doc<"forms">["status"]): string {
  if (status === "published") return "Published"
  if (status === "closed") return "Closed"
  if (status === "draft") return "Draft"
  return "Archived"
}
