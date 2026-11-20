"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { cn } from "@/lib/utils"

export type ChartViewType = "bar" | "line" | "pie"

export type ChartViewDatum = {
  label: string
  value: number
  color?: string
}

const DEFAULT_COLOR = "#6366F1"
const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 } as const

function defaultFormatter(value: number): string {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 2,
  }).format(value)
}

function truncateTick(value: string): string {
  return value.length > 14 ? `${value.slice(0, 13)}…` : value
}

/**
 * Renders a bar, line or pie chart for a grouped series. Every chart ships a
 * visually hidden data table so screen readers (and tests without layout) get
 * the same numbers the SVG shows.
 */
export function ChartView({
  className,
  data,
  emptyMessage = "No data to chart yet",
  height = 240,
  title,
  type,
  valueFormatter,
}: {
  className?: string
  data: readonly ChartViewDatum[]
  emptyMessage?: string
  height?: number
  title: string
  type: ChartViewType
  valueFormatter?: (value: number) => string
}) {
  const formatValue = valueFormatter ?? defaultFormatter
  const rows = data.map((datum, index) => ({
    ...datum,
    color:
      datum.color ??
      (type === "line"
        ? DEFAULT_COLOR
        : [
            "#6366F1",
            "#0EA5E9",
            "#10B981",
            "#F59E0B",
            "#EF4444",
            "#8B5CF6",
            "#14B8A6",
            "#EC4899",
          ][index % 8]),
  }))

  if (rows.length === 0) {
    return (
      <div
        className={cn(
          "flex min-h-32 items-center justify-center rounded-lg border border-dashed bg-muted/25 px-4 py-8 text-center text-xs text-muted-foreground",
          className,
        )}
        role="status"
      >
        {emptyMessage}
      </div>
    )
  }

  return (
    <figure className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="min-w-0">
        <ResponsiveContainer
          height={height}
          initialDimension={{ height, width: 480 }}
          width="100%"
        >
          {type === "bar" ? (
            <BarChart data={rows} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="label"
                fontSize={11}
                interval="preserveStartEnd"
                tickFormatter={truncateTick}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                fontSize={11}
                tickLine={false}
                width={44}
              />
              <Tooltip
                cursor={{ fill: "rgba(99, 102, 241, 0.08)" }}
                formatter={(value) => formatValue(Number(value))}
              />
              <Bar dataKey="value" maxBarSize={56} radius={[4, 4, 0, 0]}>
                {rows.map((row) => (
                  <Cell fill={row.color} key={row.label} />
                ))}
              </Bar>
            </BarChart>
          ) : type === "line" ? (
            <LineChart data={rows} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="label"
                fontSize={11}
                interval="preserveStartEnd"
                tickFormatter={truncateTick}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                fontSize={11}
                tickLine={false}
                width={44}
              />
              <Tooltip formatter={(value) => formatValue(Number(value))} />
              <Line
                activeDot={{ r: 5 }}
                dataKey="value"
                dot={{ r: 3 }}
                stroke={DEFAULT_COLOR}
                strokeWidth={2}
                type="monotone"
              />
            </LineChart>
          ) : (
            <PieChart margin={CHART_MARGIN}>
              <Tooltip formatter={(value) => formatValue(Number(value))} />
              <Pie
                data={rows}
                dataKey="value"
                innerRadius="42%"
                nameKey="label"
                outerRadius="78%"
                paddingAngle={2}
                stroke="none"
              >
                {rows.map((row) => (
                  <Cell fill={row.color} key={row.label} />
                ))}
              </Pie>
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>

      {type === "pie" ? (
        <ul
          aria-label={`${title} legend`}
          className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground"
        >
          {rows.map((row) => (
            <li className="flex min-w-0 items-center gap-1.5" key={row.label}>
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
              />
              <span className="truncate">{row.label}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <table className="sr-only">
        <caption>{title} values</caption>
        <thead>
          <tr>
            <th scope="col">Label</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{formatValue(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
