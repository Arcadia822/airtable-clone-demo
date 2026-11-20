"use client"

import { useMemo, useState } from "react"
import { ChartBar, ChartLine, Plus, Trash2 } from "lucide-react"
import { nanoid } from "nanoid"

import {
  ChartView,
  type ChartViewType,
} from "@/components/charts/chart-view"
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
import type {
  DashboardWidgetConfig,
  FieldDefinition,
  FieldType,
  GridRecord,
} from "@/lib/domain"
import {
  computeFieldSummary,
  computeGroupedSeries,
  formatSummaryValue,
  type SummaryAggregate,
} from "@/lib/table-summary"
import { cn } from "@/lib/utils"

const NUMERIC_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  "number",
  "currency",
  "percent",
  "rating",
  "autoNumber",
])

const AGGREGATE_LABELS: Record<SummaryAggregate, string> = {
  count: "Record count",
  populated: "Filled values",
  sum: "Sum",
  avg: "Average",
  min: "Minimum",
  max: "Maximum",
}

function sortWidgets(
  widgets: readonly DashboardWidgetConfig[],
): DashboardWidgetConfig[] {
  return [...widgets].sort(
    (left, right) =>
      left.rank.localeCompare(right.rank) || left.id.localeCompare(right.id),
  )
}

function nextWidgetRank(widgets: readonly DashboardWidgetConfig[]): string {
  const maximum = widgets.reduce((highest, widget) => {
    const parsed = Number.parseInt(widget.rank.replace(/\D/g, ""), 10)
    return Number.isFinite(parsed) ? Math.max(highest, parsed) : highest
  }, -1)
  return `a${maximum + 1}`
}

function widgetTitleFor(
  kind: "metric" | "chart",
  aggregate: SummaryAggregate,
  field: FieldDefinition | undefined,
  groupBy: FieldDefinition | undefined,
): string {
  const fieldName = field?.name
  const groupName = groupBy?.name
  if (kind === "chart" && groupName) {
    if (aggregate === "count" || !fieldName) return `Records by ${groupName}`
    if (aggregate === "avg") return `Average ${fieldName} by ${groupName}`
    if (aggregate === "min") return `Minimum ${fieldName} by ${groupName}`
    if (aggregate === "max") return `Maximum ${fieldName} by ${groupName}`
    if (aggregate === "populated") return `${fieldName} filled by ${groupName}`
    return `${fieldName} by ${groupName}`
  }
  if (!fieldName || aggregate === "count") return "Total records"
  if (aggregate === "populated") return `${fieldName} filled`
  if (aggregate === "avg") return `Average ${fieldName}`
  if (aggregate === "min") return `Minimum ${fieldName}`
  if (aggregate === "max") return `Maximum ${fieldName}`
  return `Total ${fieldName}`
}

function aggregateOptions(
  field: FieldDefinition | undefined,
): SummaryAggregate[] {
  if (!field) return ["count"]
  const options: SummaryAggregate[] = ["count", "populated"]
  if (NUMERIC_FIELD_TYPES.has(field.type)) {
    options.push("sum", "avg", "min", "max")
  }
  return options
}

/**
 * Read-only friendly rendering of one KPI card. Count-based widgets always read
 * the record total; value-based widgets reuse the table summary engine so the
 * dashboard and excel-style footer agree on every number.
 */
function metricDisplay(
  widget: DashboardWidgetConfig,
  records: readonly GridRecord[],
  fields: readonly FieldDefinition[],
): { value: string; caption: string } {
  const field = widget.fieldId
    ? fields.find((candidate) => candidate.id === widget.fieldId)
    : undefined
  const aggregate = widget.aggregate ?? "count"

  if (!field || aggregate === "count") {
    return {
      value: records.length.toLocaleString(),
      caption:
        records.length === 1 ? "record in this table" : "records in this table",
    }
  }

  const summary = computeFieldSummary(records, field)
  if (aggregate === "populated") {
    return {
      value: summary.populatedCount.toLocaleString(),
      caption: `${field.name} filled · ${summary.emptyCount} empty`,
    }
  }
  const numeric =
    aggregate === "sum"
      ? summary.sum
      : aggregate === "avg"
        ? summary.avg
        : aggregate === "min"
          ? summary.min
          : summary.max
  return {
    value: formatSummaryValue(field, numeric),
    caption: `${AGGREGATE_LABELS[aggregate].toLowerCase()} of ${field.name}`,
  }
}

export function DashboardView({
  fields,
  onUpdateWidgets,
  readOnly = false,
  records,
  widgets,
}: {
  fields: readonly FieldDefinition[]
  records: readonly GridRecord[]
  widgets: readonly DashboardWidgetConfig[]
  onUpdateWidgets?: (
    next: DashboardWidgetConfig[],
  ) => void | Promise<void>
  readOnly?: boolean
}) {
  const [draft, setDraft] = useState<{
    base: readonly DashboardWidgetConfig[]
    widgets: DashboardWidgetConfig[]
  }>()
  const [addOpen, setAddOpen] = useState(false)
  const [kind, setKind] = useState<"metric" | "chart">("metric")
  const [draftTitle, setDraftTitle] = useState("")
  const [draftFieldId, setDraftFieldId] = useState("")
  const [draftGroupById, setDraftGroupById] = useState("")
  const [draftAggregate, setDraftAggregate] =
    useState<SummaryAggregate>("count")
  const [draftChartType, setDraftChartType] = useState<ChartViewType>("bar")

  // Optimistic local copy until the parent hands back the new widget list.
  const ordered = useMemo(
    () => sortWidgets(draft && draft.base === widgets ? draft.widgets : widgets),
    [draft, widgets],
  )
  const metricWidgets = ordered.filter((widget) => widget.kind === "metric")
  const chartWidgets = ordered.filter((widget) => widget.kind === "chart")
  const groupCandidates = useMemo(
    () =>
      fields.filter(
        (field) =>
          field.type === "singleSelect" ||
          field.type === "multiSelect" ||
          field.type === "date" ||
          field.type === "createdTime" ||
          field.type === "checkbox" ||
          field.type === "singleLineText" ||
          field.type === "number" ||
          field.type === "currency",
      ),
    [fields],
  )

  function commit(next: DashboardWidgetConfig[]) {
    setDraft({ base: widgets, widgets: next })
    void Promise.resolve(onUpdateWidgets?.(next)).catch(() => undefined)
  }

  function openAddDialog() {
    setKind("metric")
    setDraftTitle("")
    setDraftFieldId("")
    setDraftGroupById(groupCandidates[0]?.id ?? "")
    setDraftAggregate("count")
    setDraftChartType("bar")
    setAddOpen(true)
  }

  function draftField(): FieldDefinition | undefined {
    return draftFieldId
      ? fields.find((field) => field.id === draftFieldId)
      : undefined
  }

  const availableAggregates = aggregateOptions(draftField())
  const effectiveAggregate = availableAggregates.includes(draftAggregate)
    ? draftAggregate
    : "count"

  function addWidget() {
    const field = draftField()
    const groupBy =
      kind === "chart"
        ? fields.find((candidate) => candidate.id === draftGroupById)
        : undefined
    if (kind === "chart" && !groupBy) return
    const aggregate =
      kind === "metric" && !field ? "count" : effectiveAggregate
    const widget: DashboardWidgetConfig = {
      id: `dashboard_widget_${nanoid(8)}`,
      kind,
      title:
        draftTitle.trim() ||
        widgetTitleFor(kind, aggregate, field, groupBy),
      fieldId: field?.id,
      groupByFieldId: groupBy?.id,
      aggregate,
      chartType: kind === "chart" ? draftChartType : undefined,
      rank: nextWidgetRank(ordered),
    }
    commit([...ordered, widget])
    setAddOpen(false)
  }

  function removeWidget(widgetId: string) {
    commit(ordered.filter((widget) => widget.id !== widgetId))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-muted/15 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Dashboard</h2>
          <p className="text-xs text-muted-foreground">
            Live metrics computed from the {records.length.toLocaleString()}{" "}
            visible record{records.length === 1 ? "" : "s"}.
          </p>
        </div>
        {!readOnly ? (
          <Button
            className="ml-auto h-8 gap-1.5"
            onClick={openAddDialog}
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus />
            Add widget
          </Button>
        ) : null}
      </div>

      {metricWidgets.length > 0 ? (
        <section
          aria-label="Key metrics"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          {metricWidgets.map((widget) => {
            const display = metricDisplay(widget, records, fields)
            return (
              <article
                aria-label={`${widget.title} metric`}
                className="relative flex min-w-0 flex-col gap-1 rounded-xl border bg-background p-3 shadow-xs sm:p-4"
                key={widget.id}
              >
                <p className="truncate text-xs font-medium text-muted-foreground">
                  {widget.title}
                </p>
                <p className="text-2xl font-semibold tracking-tight tabular-nums">
                  {display.value}
                </p>
                <p className="text-[11px] leading-4 text-muted-foreground">
                  {display.caption}
                </p>
                {!readOnly ? (
                  <Button
                    aria-label={`Remove ${widget.title}`}
                    className="absolute right-1.5 top-1.5 text-muted-foreground opacity-70 hover:opacity-100"
                    onClick={() => removeWidget(widget.id)}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </article>
            )
          })}
        </section>
      ) : null}

      {chartWidgets.length > 0 ? (
        <section
          aria-label="Dashboard charts"
          className="grid grid-cols-1 gap-3 lg:grid-cols-2"
        >
          {chartWidgets.map((widget) => {
            const groupField = widget.groupByFieldId
              ? fields.find(
                  (candidate) => candidate.id === widget.groupByFieldId,
                )
              : undefined
            const metricField = widget.fieldId
              ? fields.find((candidate) => candidate.id === widget.fieldId)
              : undefined
            const aggregate = widget.aggregate ?? "count"
            const data = groupField
              ? computeGroupedSeries(
                  records,
                  groupField,
                  metricField,
                  aggregate,
                )
              : []
            const valueFormatter =
              !metricField ||
              aggregate === "count" ||
              aggregate === "populated"
                ? (value: number) => value.toLocaleString()
                : (value: number) => formatSummaryValue(metricField, value)

            return (
              <article
                aria-label={`${widget.title} chart`}
                className="relative min-w-0 rounded-xl border bg-background p-3 shadow-xs sm:p-4"
                key={widget.id}
              >
                <header className="mb-2 flex min-w-0 items-center gap-2 pr-7">
                  <h3 className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                    {widget.title}
                  </h3>
                </header>
                {!readOnly ? (
                  <Button
                    aria-label={`Remove ${widget.title}`}
                    className="absolute right-1.5 top-1.5 text-muted-foreground opacity-70 hover:opacity-100"
                    onClick={() => removeWidget(widget.id)}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                ) : null}
                {groupField ? (
                  <ChartView
                    data={data}
                    title={widget.title}
                    type={widget.chartType ?? "bar"}
                    valueFormatter={valueFormatter}
                  />
                ) : (
                  <p className="flex min-h-32 items-center justify-center rounded-lg border border-dashed bg-muted/25 px-4 text-center text-xs text-muted-foreground">
                    Choose a group-by column to chart this widget.
                  </p>
                )}
              </article>
            )
          })}
        </section>
      ) : null}

      {metricWidgets.length === 0 && chartWidgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-background px-6 py-12 text-center">
          <p className="text-sm font-medium">No widgets yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Add a metric card or chart to surface the numbers that matter for
            this table. Widgets stay scoped to this view.
          </p>
          {!readOnly ? (
            <Button
              className="h-8 gap-1.5"
              onClick={openAddDialog}
              size="sm"
              type="button"
            >
              <Plus />
              Add widget
            </Button>
          ) : null}
        </div>
      ) : null}

      <Dialog
        onOpenChange={(open) => {
          if (!open) setAddOpen(false)
        }}
        open={addOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add widget</DialogTitle>
            <DialogDescription>
              Metrics summarise a column; charts break a column down by group.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Widget type
              </span>
              <div
                aria-label="Widget type"
                className="flex gap-1 rounded-lg border p-1"
                role="group"
              >
                {(
                  [
                    { value: "metric", label: "Metric", icon: ChartBar },
                    { value: "chart", label: "Chart", icon: ChartLine },
                  ] as const
                ).map((option) => (
                  <button
                    aria-pressed={kind === option.value}
                    className={cn(
                      "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors",
                      kind === option.value
                        ? "bg-muted text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    key={option.value}
                    onClick={() => setKind(option.value)}
                    type="button"
                  >
                    <option.icon className="size-3.5" />
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="dashboard-widget-title">Widget title</Label>
              <Input
                id="dashboard-widget-title"
                onChange={(event) => setDraftTitle(event.target.value)}
                placeholder="Generated from the column names"
                value={draftTitle}
              />
            </div>

            {kind === "chart" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="dashboard-widget-group">Group by</Label>
                <select
                  className="h-8 w-full rounded-lg border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                  id="dashboard-widget-group"
                  onChange={(event) => setDraftGroupById(event.target.value)}
                  value={draftGroupById}
                >
                  {groupCandidates.length === 0 ? (
                    <option value="">No groupable columns</option>
                  ) : null}
                  {groupCandidates.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="grid gap-1.5">
              <Label htmlFor="dashboard-widget-field">
                {kind === "chart" ? "Value field (optional)" : "Field"}
              </Label>
              <select
                className="h-8 w-full rounded-lg border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                id="dashboard-widget-field"
                onChange={(event) => {
                  setDraftFieldId(event.target.value)
                  const field = event.target.value
                    ? fields.find(
                        (candidate) => candidate.id === event.target.value,
                      )
                    : undefined
                  if (
                    !aggregateOptions(field).includes(draftAggregate)
                  ) {
                    setDraftAggregate("count")
                  }
                }}
                value={draftFieldId}
              >
                <option value="">
                  {kind === "chart" ? "Count records" : "Whole table"}
                </option>
                {fields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="dashboard-widget-aggregate">Aggregate</Label>
              <select
                className="h-8 w-full rounded-lg border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                id="dashboard-widget-aggregate"
                onChange={(event) =>
                  setDraftAggregate(event.target.value as SummaryAggregate)
                }
                value={effectiveAggregate}
              >
                {availableAggregates.map((aggregate) => (
                  <option key={aggregate} value={aggregate}>
                    {AGGREGATE_LABELS[aggregate]}
                  </option>
                ))}
              </select>
            </div>

            {kind === "chart" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="dashboard-widget-chart-type">Chart type</Label>
                <select
                  className="h-8 w-full rounded-lg border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                  id="dashboard-widget-chart-type"
                  onChange={(event) =>
                    setDraftChartType(event.target.value as ChartViewType)
                  }
                  value={draftChartType}
                >
                  <option value="bar">Bar</option>
                  <option value="line">Line</option>
                  <option value="pie">Pie</option>
                </select>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              onClick={() => setAddOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={kind === "chart" && !draftGroupById}
              onClick={addWidget}
              type="button"
            >
              Add widget
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
