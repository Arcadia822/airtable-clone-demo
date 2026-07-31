"use client"

import Link from "next/link"
import { ArrowUpRight, BookOpen, Database, TriangleAlert } from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts"

import type {
  AssistantChart,
  AssistantCitation,
} from "@/lib/eve/analysis-artifacts"
import { parseAssistantAnalysis } from "@/lib/eve/analysis-presentation"
import { cn } from "@/lib/utils"

export function AssistantAnalysisText({
  className,
  text,
}: {
  className?: string
  text: string
}) {
  const sections = parseAssistantAnalysis(text)
  if (!sections) {
    return (
      <div className={cn("space-y-2", className)}>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-4 text-amber-900 dark:text-amber-100">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" />
          This response did not clearly separate workspace facts from the
          analyst&apos;s interpretation.
        </p>
      </div>
    )
  }

  return (
    <div className={cn("space-y-2.5", className)}>
      {sections.map((section) => (
        <section
          aria-label={section.label}
          className={cn(
            "rounded-lg border px-3 py-2.5",
            section.kind === "facts" && "bg-background",
            section.kind === "interpretation" && "bg-muted/25",
            section.kind === "limitations" &&
              "border-amber-500/20 bg-amber-500/[0.04]",
          )}
          key={section.kind}
        >
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {section.kind === "facts" ? (
              <Database className="size-3" />
            ) : section.kind === "interpretation" ? (
              <BookOpen className="size-3" />
            ) : (
              <TriangleAlert className="size-3" />
            )}
            {section.label}
          </p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {section.body}
          </p>
        </section>
      ))}
    </div>
  )
}

export function AssistantCitationLink({
  citation,
}: {
  citation: AssistantCitation
}) {
  return (
    <Link
      aria-label={`Open source ${citation.label}`}
      className="inline-flex min-w-0 items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-[11px] font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      href={citation.href}
    >
      <Database className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{citation.label}</span>
      <ArrowUpRight className="size-3 shrink-0 text-muted-foreground" />
    </Link>
  )
}

export function AssistantChartView({ chart }: { chart: AssistantChart }) {
  const chartLabel = `${chart.title}. ${chart.yLabel} by ${chart.xLabel}.`
  return (
    <section
      aria-label={chart.title}
      className="rounded-lg border bg-background p-3"
    >
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{chart.title}</h3>
        <p className="text-[11px] text-muted-foreground">
          {chart.yLabel} by {chart.xLabel}
        </p>
      </div>
      <div aria-label={chartLabel} className="h-56 min-w-0" role="img">
        <ResponsiveContainer height="100%" minHeight={200} minWidth={240} width="100%">
          {chart.type === "line" ? (
            <LineChart data={chart.data} margin={{ left: 0, right: 12, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                minTickGap={24}
                tick={{ fontSize: 10 }}
                tickLine={false}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} />
              <RechartsTooltip />
              <Line
                dataKey="value"
                dot={false}
                name={chart.yLabel}
                stroke="var(--primary)"
                strokeWidth={2}
                type="monotone"
              />
            </LineChart>
          ) : (
            <BarChart data={chart.data} margin={{ left: 0, right: 12, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                minTickGap={20}
                tick={{ fontSize: 10 }}
                tickLine={false}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} />
              <RechartsTooltip />
              <Bar
                dataKey="value"
                fill="var(--primary)"
                name={chart.yLabel}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{chartLabel}</caption>
        <thead>
          <tr>
            <th scope="col">{chart.xLabel}</th>
            <th scope="col">{chart.yLabel}</th>
          </tr>
        </thead>
        <tbody>
          {chart.data.map((point, index) => (
            <tr key={`${point.label}:${index}`}>
              <td>{point.label}</td>
              <td>{point.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
