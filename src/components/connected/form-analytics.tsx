"use client"

import Link from "next/link"
import { useQuery } from "convex/react"
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  Globe2,
  ListChecks,
  MonitorSmartphone,
  MousePointerClick,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react"
import {
  Component,
  type ReactNode,
  useState,
} from "react"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { ConnectedAssistantSheet } from "@/components/connected/assistant-sheet"
import { FormBreadcrumbs } from "@/components/connected/form-breadcrumbs"
import {
  ConnectedLoading,
  ConnectedTopBar,
} from "@/components/connected/org-states"
import { OrganizationAuthGate } from "@/components/connected/organization-auth-gate"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  analyticsRange,
  createFormAnalyticsCsv,
  customAnalyticsRangeIssue,
  formAnalyticsCsvFileName,
  type AnalyticsRange,
} from "@/lib/form-analytics"

const RANGE_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "custom", label: "Custom dates" },
] as const

type RangeChoice = (typeof RANGE_OPTIONS)[number]["value"]

export function ConnectedFormAnalytics({
  baseId,
  formId,
}: {
  baseId: string
  formId: string
}) {
  return (
    <OrganizationAuthGate>
      {({ auth }) =>
        !auth.has({ feature: "form_analytics" }) ? (
          <FormAnalyticsUpgrade baseId={baseId} />
        ) : (
          <AnalyticsErrorBoundary baseId={baseId}>
            <AnalyticsData
              baseId={baseId as Id<"bases">}
              canUseAi={auth.has({ feature: "ai_assistant" })}
              formId={formId as Id<"forms">}
            />
          </AnalyticsErrorBoundary>
        )
      }
    </OrganizationAuthGate>
  )
}

export function FormAnalyticsUpgrade({ baseId }: { baseId: string }) {
  return (
    <main className="workspace-shell-offset min-h-dvh bg-muted/20">
      <ConnectedTopBar>
        <Button
          render={<Link href={`/bases/${baseId}/forms`} />}
          size="sm"
          variant="ghost"
        >
          <ArrowLeft />
          Forms
        </Button>
      </ConnectedTopBar>
      <div className="mx-auto max-w-3xl px-5 py-20">
        <FormBreadcrumbs
          className="mb-6"
          items={[
            {
              href: `/bases/${baseId}/forms`,
              label: "Forms",
            },
            { label: "Analytics" },
          ]}
        />
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/30 p-8">
            <div className="mb-5 grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
              <BarChart3 className="size-5" />
            </div>
            <Badge className="mb-2 w-fit rounded-full">Starter feature</Badge>
            <CardTitle className="text-2xl">Unlock form analytics</CardTitle>
            <CardDescription className="max-w-xl leading-6">
              Starter and Pro organizations can see privacy-first views, starts,
              submissions, validation errors, and conversion rates.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 p-8">
            <Button render={<Link href="/pricing" />}>Compare plans</Button>
            <Button
              render={<Link href={`/bases/${baseId}/forms`} />}
              variant="outline"
            >
              Return to forms
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

function AnalyticsData({
  baseId,
  canUseAi,
  formId,
}: {
  baseId: Id<"bases">
  canUseAi: boolean
  formId: Id<"forms">
}) {
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [rangeChoice, setRangeChoice] = useState<RangeChoice>("30")
  const [range, setRange] = useState<AnalyticsRange>(() => analyticsRange(30))
  const [customRange, setCustomRange] = useState<AnalyticsRange>(() =>
    analyticsRange(30),
  )
  const customRangeIssue = customAnalyticsRangeIssue(customRange)
  const analyticsContext = useQuery(api.forms.getAnalyticsContext, { formId })
  const timeZone = analyticsContext?.timeZone ?? "UTC"
  const activeRange =
    rangeChoice === "custom"
      ? range
      : analyticsRange(Number(rangeChoice), new Date(), timeZone)
  const summary = useQuery(
    api.analytics.summary,
    analyticsContext
      ? {
          baseId,
          formId,
          fromDay: activeRange.fromDay,
          toDay: activeRange.toDay,
        }
      : "skip",
  )

  if (summary === undefined) {
    return <ConnectedLoading label="Preparing your form report…" />
  }
  const report = summary

  const maxViews = Math.max(
    1,
    ...summary.series.map((row: AnalyticsRow) => row.views),
  )
  const hasActivity =
    summary.totals.views > 0 ||
    summary.totals.starts > 0 ||
    summary.totals.submissions > 0
  const primaryRate =
    summary.funnel.primaryRate === null
      ? "—"
      : `${(summary.funnel.primaryRate * 100).toFixed(1)}%`

  function chooseRange(value: RangeChoice) {
    setRangeChoice(value)
  }

  function downloadAggregateReport() {
    const url = URL.createObjectURL(
      new Blob([createFormAnalyticsCsv(report)], {
        type: "text/csv;charset=utf-8",
      }),
    )
    const link = document.createElement("a")
    link.href = url
    link.download = formAnalyticsCsvFileName(report)
    link.click()
    URL.revokeObjectURL(url)
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
          Forms
        </Button>
      </ConnectedTopBar>

      <div className="mx-auto max-w-7xl px-5 py-6 md:px-8 md:py-8">
        <FormBreadcrumbs
          className="mb-6"
          items={[
            {
              href: `/bases/${baseId}/forms`,
              label: "Forms",
            },
            {
              href: `/bases/${baseId}/forms/${formId}`,
              label: summary.form.name,
            },
            { label: "Analytics" },
          ]}
        />
        <div className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-[-0.025em]">
                {summary.form.name}
              </h1>
              <Badge className="rounded-md" variant="outline">
                {summary.form.statusLabel}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Privacy-first conversion analytics ·{" "}
              {formatDateRange(summary.fromDay, summary.toDay)} ·{" "}
              {summary.timeZone ?? timeZone}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={rangeChoice}
              onValueChange={(value) => chooseRange(value as RangeChoice)}
            >
              <SelectTrigger
                aria-label="Analytics date range"
                className="w-40 bg-background"
              >
                <SelectValue>
                  {(value) =>
                    RANGE_OPTIONS.find((option) => option.value === value)
                      ?.label ?? "Choose a date range"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={downloadAggregateReport} variant="outline">
              <Download />
              Download CSV
            </Button>
            <Button
              onClick={() => setAssistantOpen(true)}
              variant="outline"
            >
              <Sparkles />
              {canUseAi ? "Ask AI about this form" : "AI insights on Pro"}
            </Button>
          </div>
        </div>

        {rangeChoice === "custom" ? (
          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border bg-background p-4">
            <label className="grid gap-1.5 text-xs font-medium" htmlFor="analytics-from-day">
              Start date
              <Input
                id="analytics-from-day"
                max={customRange.toDay}
                onChange={(event) =>
                  setCustomRange((current) => ({
                    ...current,
                    fromDay: event.target.value,
                  }))
                }
                type="date"
                value={customRange.fromDay}
              />
            </label>
            <label className="grid gap-1.5 text-xs font-medium" htmlFor="analytics-to-day">
              End date
              <Input
                id="analytics-to-day"
                min={customRange.fromDay}
                onChange={(event) =>
                  setCustomRange((current) => ({
                    ...current,
                    toDay: event.target.value,
                  }))
                }
                type="date"
                value={customRange.toDay}
              />
            </label>
            <Button
              disabled={customRangeIssue !== null}
              onClick={() => setRange(customRange)}
            >
              Apply dates
            </Button>
            {customRangeIssue ? (
              <p className="w-full text-xs text-destructive" role="alert">
                {customRangeIssue}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Reports can cover up to 90 days.
              </p>
            )}
          </div>
        ) : null}

        <div className="mt-6 grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard
            comparison={comparisonFor(summary.comparison.metrics, "Unique views")}
            icon={Eye}
            label="Unique views"
            value={summary.totals.views.toLocaleString()}
          />
          <MetricCard
            comparison={comparisonFor(summary.comparison.metrics, "Form starts")}
            icon={MousePointerClick}
            label="Form starts"
            value={summary.totals.starts.toLocaleString()}
          />
          <MetricCard
            comparison={comparisonFor(summary.comparison.metrics, "Submissions")}
            icon={CheckCircle2}
            label="Submissions"
            value={summary.totals.submissions.toLocaleString()}
          />
          <MetricCard
            comparison={rateComparison(summary.comparison.primaryRate)}
            icon={BarChart3}
            label={summary.funnel.primaryRateLabel}
            value={primaryRate}
          />
          <MetricCard
            comparison={comparisonFor(
              summary.comparison.metrics,
              "Validation errors",
            )}
            icon={TriangleAlert}
            label="Validation errors"
            value={summary.totals.validationErrors.toLocaleString()}
          />
          <MetricCard
            comparison={comparisonFor(
              summary.comparison.metrics,
              "Tracked exits",
            )}
            icon={ArrowLeft}
            label="Tracked exits"
            value={summary.totals.abandonments.toLocaleString()}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {summary.comparison.note}{" "}
          {formatDateRange(
            summary.comparison.fromDay,
            summary.comparison.toDay,
          )}
        </p>
        <details className="mt-3 rounded-lg border bg-background px-4 py-3 text-xs">
          <summary className="cursor-pointer font-medium">
            How these metrics work
          </summary>
          <dl className="mt-3 grid gap-3 text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
            <MetricDefinition
              description="One opening per visitor each day, where visit matching is available."
              label="Unique views"
            />
            <MetricDefinition
              description="People who focused or began answering a question."
              label="Form starts"
            />
            <MetricDefinition
              description="Responses that were successfully saved."
              label="Submissions"
            />
            <MetricDefinition
              description="Submitted responses divided by starts, with a view-based fallback when start tracking is unavailable."
              label="Completion"
            />
            <MetricDefinition
              description="Submit attempts that could not continue until the visitor corrected an answer."
              label="Validation errors"
            />
            <MetricDefinition
              description="Best-effort visits that started but left before a successful submission."
              label="Tracked exits"
            />
          </dl>
        </details>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_0.8fr]">
          <Card>
            <CardHeader>
              <CardTitle>Daily activity</CardTitle>
              <CardDescription>
                Deduplicated views compared with completed submissions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {hasActivity ? (
                <div className="overflow-x-auto pb-2">
                  <div
                    aria-hidden="true"
                    className="flex h-64 min-w-[560px] items-end gap-2 border-b px-2"
                  >
                    {summary.series.map((row: AnalyticsRow) => (
                      <div
                        className="group flex min-w-3 flex-1 flex-col items-center justify-end gap-1"
                        key={row.date}
                        title={`${formatFullDate(row.date)}: ${row.views} views, ${row.submissions} submissions`}
                      >
                        <div className="flex h-48 w-full items-end justify-center gap-0.5">
                          <div
                            className="w-2/5 rounded-t bg-primary transition-opacity group-hover:opacity-80"
                            style={{
                              height: `${Math.max(2, (row.views / maxViews) * 100)}%`,
                            }}
                          />
                          <div
                            className="w-2/5 rounded-t bg-cyan-500 transition-opacity group-hover:opacity-80"
                            style={{
                              height: `${Math.max(
                                row.submissions ? 2 : 0,
                                (row.submissions / maxViews) * 100,
                              )}%`,
                            }}
                          />
                        </div>
                        <span className="text-[9px] text-muted-foreground">
                          {formatCompactDate(row.date)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-primary" />
                      Views
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-cyan-500" />
                      Submissions
                    </span>
                  </div>
                  <table className="sr-only">
                    <caption>
                      Daily form views, starts, submissions, and validation
                      errors
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Views</th>
                        <th scope="col">Starts</th>
                      <th scope="col">Submissions</th>
                      <th scope="col">Validation errors</th>
                      <th scope="col">Tracked exits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.series.map((row: AnalyticsRow) => (
                        <tr key={row.date}>
                          <th scope="row">{formatFullDate(row.date)}</th>
                          <td>{row.views}</td>
                          <td>{row.starts}</td>
                          <td>{row.submissions}</td>
                          <td>{row.validationErrors}</td>
                          <td>{row.abandonments}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="grid h-64 place-items-center text-center">
                  <div>
                    <BarChart3 className="mx-auto size-7 text-muted-foreground/60" />
                    <p className="mt-3 text-sm font-medium">No activity yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Metrics appear after a published form receives traffic.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Response funnel</CardTitle>
              <CardDescription>
                See how visitors moved from opening the form to submitting it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {summary.funnel.steps.map(
                (step: FunnelStep, index: number) => (
                  <div key={step.label}>
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium">{step.label}</p>
                        {step.rateFromPrevious !== null && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {(step.rateFromPrevious * 100).toFixed(1)}% from{" "}
                            {summary.funnel.steps[index - 1]?.label.toLowerCase()}
                          </p>
                        )}
                      </div>
                      <p className="font-mono text-xl font-semibold tabular-nums">
                        {step.count.toLocaleString()}
                      </p>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-foreground/80 transition-[width]"
                        style={{
                          width: `${funnelWidth(
                            step.count,
                            summary.funnel.steps[0]?.count ?? 0,
                            index,
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ),
              )}
              <p className="rounded-lg border bg-muted/30 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
                {summary.funnel.note}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <BreakdownCard
            description="Broad categories based on screen width. Browser details are not kept."
            icon={MonitorSmartphone}
            items={summary.breakdowns.devices.items}
            note={summary.breakdowns.devices.note}
            title="Device category"
          />
          <BreakdownCard
            description="Campaign, search, social, and other broad sources without saving referring links."
            icon={Globe2}
            items={summary.breakdowns.trafficSources.items}
            note={summary.breakdowns.trafficSources.note}
            title="Traffic source"
          />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowLeft className="size-4 text-muted-foreground" />
                Question exits
              </CardTitle>
              <CardDescription>
                The last question reached before a tracked visitor left without
                submitting.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {summary.questionAbandonment.items.length ? (
                <div className="space-y-3">
                  {summary.questionAbandonment.items.map((item) => (
                    <BreakdownRow
                      count={item.count}
                      key={item.question}
                      label={item.question}
                      share={item.share}
                    />
                  ))}
                </div>
              ) : (
                <EmptyInsight
                  description={summary.questionAbandonment.note}
                  icon={ArrowLeft}
                  title="No question exits yet"
                />
              )}
              {summary.questionAbandonment.items.length ? (
                <p className="mt-4 border-t pt-3 text-xs leading-5 text-muted-foreground">
                  {summary.questionAbandonment.note}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="size-4 text-muted-foreground" />
                Top answers
              </CardTitle>
              <CardDescription>
                The most common choices in recent responses for this date range.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {summary.topAnswers.length ? (
                <div className="grid gap-6 md:grid-cols-2">
                  {summary.topAnswers.map((question: AnswerInsight) => (
                    <div className="min-w-0" key={question.question}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold">
                            {question.question}
                          </h3>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {question.answerStyle} ·{" "}
                            {question.answeredResponses.toLocaleString()} answered
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 space-y-3">
                        {question.answers.map((answer) => (
                          <div key={answer.answer}>
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className="truncate font-medium">
                                {answer.answer}
                              </span>
                              <span className="shrink-0 tabular-nums text-muted-foreground">
                                {answer.count.toLocaleString()} ·{" "}
                                {(answer.share * 100).toFixed(0)}%
                              </span>
                            </div>
                            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{
                                  width: `${Math.min(100, answer.share * 100)}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyInsight
                  icon={ListChecks}
                  title={
                    summary.responseTiming.analyzedResponses > 0
                      ? "No choice answers to compare"
                      : "Waiting for the first response"
                  }
                  description={
                    summary.responseTiming.analyzedResponses > 0
                      ? "Top answers appear for single- and multiple-choice questions."
                      : "Common answers will appear here after people submit this form."
                  }
                />
              )}
              {summary.responseTiming.sampleLimited && (
                <p className="mt-5 border-t pt-4 text-xs text-muted-foreground">
                  Answer rankings use the latest{" "}
                  {summary.responseTiming.analyzedResponses.toLocaleString()} responses
                  in this date range.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock3 className="size-4 text-muted-foreground" />
                  Response timing
                </CardTitle>
                <CardDescription>
                  A quick read on how recently responses arrived.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <PrivacyRow
                  label="Latest response"
                  value={
                    summary.responseTiming.latestSubmittedAt === null
                      ? "No responses yet"
                      : formatResponseTime(
                          summary.responseTiming.latestSubmittedAt,
                        )
                  }
                />
                <PrivacyRow
                  label="Past 7 days"
                  value={`${summary.responseTiming.responsesInLastSevenDays.toLocaleString()} responses`}
                />
                <PrivacyRow
                  label="Typical gap"
                  value={formatGap(
                    summary.responseTiming.medianGapMinutes,
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-emerald-600" />
                  Privacy
                </CardTitle>
                <CardDescription>
                  Useful trends without keeping a personal browsing history.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <PrivacyRow
                  label="Individual visit logs"
                  value={
                    summary.privacy.rawEventsStored ? "Stored" : "Not stored"
                  }
                />
                <PrivacyRow
                  label="Repeat visits"
                  value={
                    summary.privacy.uniqueVisitorsTracked
                      ? "Once per day"
                      : "Counted separately"
                  }
                />
                <PrivacyRow
                  label="Traffic sources"
                  value="Broad categories only"
                />
                <PrivacyRow
                  label="Referring links"
                  value={
                    summary.privacy.rawReferrersStored
                      ? "Stored"
                      : "Not stored"
                  }
                />
                <PrivacyRow
                  label="Device details"
                  value={
                    summary.privacy.rawDeviceDetailsStored
                      ? "Stored"
                      : "Not stored"
                  }
                />
                <PrivacyRow
                  label="Visit matching"
                  value={`Removed after ${summary.privacy.visitorDedupeRetentionDays} days`}
                />
                <PrivacyRow
                  label="Aggregate counts"
                  value={summary.privacy.aggregateRetention}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <ConnectedAssistantSheet
        canUseAi={canUseAi}
        context={{
          base: { id: baseId },
          form: { id: formId, name: summary.form.name },
        }}
        onOpenChange={setAssistantOpen}
        open={assistantOpen}
        title="Form performance analyst"
      />
    </main>
  )
}

type AnalyticsRow = {
  date: string
  views: number
  starts: number
  submissions: number
  validationErrors: number
  abandonments: number
}

type FunnelStep = {
  label: string
  count: number
  rateFromPrevious: number | null
}

type AnswerInsight = {
  question: string
  answerStyle: string
  answeredResponses: number
  answers: Array<{
    answer: string
    count: number
    share: number
  }>
}

class AnalyticsErrorBoundary extends Component<
  { baseId: string; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <main className="grid min-h-dvh place-items-center bg-muted/20 px-5">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="mb-2 grid size-10 place-items-center rounded-xl border bg-muted/40">
              <BarChart3 className="size-5 text-muted-foreground" />
            </div>
            <h1 className="font-heading text-xl font-medium">
              We couldn’t load this report
            </h1>
            <CardDescription>
              Your form data is safe. Try loading the report again, or return
              to your forms.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={() => window.location.reload()}>
              Try again
            </Button>
            <Button
              render={<Link href={`/bases/${this.props.baseId}/forms`} />}
              variant="outline"
            >
              Return to forms
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }
}

function MetricCard({
  comparison,
  icon: Icon,
  label,
  value,
}: {
  comparison: string
  icon: typeof Eye
  label: string
  value: string
}) {
  return (
    <div
      aria-label={`${label}: ${value}`}
      className="bg-background px-4 py-3.5"
      role="group"
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-muted-foreground">
          {label}
        </p>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="mt-3">
        <p className="text-xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">{comparison}</p>
      </div>
    </div>
  )
}

function comparisonFor(
  metrics: Array<{
    label: string
    current: number
    previous: number
    percentChange: number | null
  }>,
  label: string,
) {
  const metric = metrics.find((item) => item.label === label)
  if (!metric) return "No earlier comparison"
  if (metric.previous === 0) {
    return metric.current === 0 ? "No change" : "New vs previous"
  }
  const change = (metric.percentChange ?? 0) * 100
  return `${change > 0 ? "+" : ""}${change.toFixed(1)}% vs previous`
}

function rateComparison(rate: {
  previous: number | null
  pointChange: number | null
}) {
  if (rate.previous === null || rate.pointChange === null) {
    return "No earlier rate"
  }
  const points = rate.pointChange * 100
  return `${points > 0 ? "+" : ""}${points.toFixed(1)} pts vs previous`
}

function BreakdownCard({
  description,
  icon: Icon,
  items,
  note,
  title,
}: {
  description: string
  icon: typeof Eye
  items: Array<{ label: string; count: number; share: number }>
  note: string
  title: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <div className="space-y-3">
            {items.map((item) => (
              <BreakdownRow key={item.label} {...item} />
            ))}
          </div>
        ) : (
          <EmptyInsight
            description={note}
            icon={Icon}
            title={`No ${title.toLowerCase()} data yet`}
          />
        )}
        {items.length ? (
          <p className="mt-4 border-t pt-3 text-xs leading-5 text-muted-foreground">
            {note}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function BreakdownRow({
  count,
  label,
  share,
}: {
  count: number
  label: string
  share: number
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="truncate font-medium">{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {count.toLocaleString()} · {(share * 100).toFixed(1)}%
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.min(100, share * 100)}%` }}
        />
      </div>
    </div>
  )
}

function EmptyInsight({
  description,
  icon: Icon,
  title,
}: {
  description: string
  icon: typeof Eye
  title: string
}) {
  return (
    <div className="grid min-h-48 place-items-center rounded-xl border border-dashed bg-muted/20 px-6 text-center">
      <div>
        <Icon className="mx-auto size-6 text-muted-foreground/60" />
        <p className="mt-3 text-sm font-medium">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  )
}

function funnelWidth(count: number, views: number, index: number) {
  if (index === 0) return count > 0 ? 100 : 0
  if (views === 0) return count > 0 ? 100 : 0
  return Math.max(count > 0 ? 4 : 0, Math.min(100, (count / views) * 100))
}

function PrivacyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b pb-3 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

function MetricDefinition({
  description,
  label,
}: {
  description: string
  label: string
}) {
  return (
    <div>
      <dt className="font-medium text-foreground">{label}</dt>
      <dd className="mt-0.5 leading-5">{description}</dd>
    </div>
  )
}

function formatResponseTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp))
}

function formatGap(minutes: number | null) {
  if (minutes === null) return "Needs 2 responses"
  if (minutes < 60) return `${Math.max(1, minutes)} min`
  if (minutes < 24 * 60) {
    return `${(minutes / 60).toFixed(minutes < 10 * 60 ? 1 : 0)} hr`
  }
  return `${(minutes / (24 * 60)).toFixed(1)} days`
}

function parseAnalyticsDay(day: string) {
  return new Date(`${day}T12:00:00`)
}

function formatCompactDate(day: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(parseAnalyticsDay(day))
}

function formatFullDate(day: string) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(parseAnalyticsDay(day))
}

function formatDateRange(fromDay: string, toDay: string) {
  return `${formatFullDate(fromDay)} – ${formatFullDate(toDay)}`
}
