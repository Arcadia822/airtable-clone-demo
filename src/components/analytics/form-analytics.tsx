"use client"

import Link from "next/link"
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Eye,
  FormInput,
  MousePointerClick,
  Smartphone,
  Sparkles,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { WorkspaceShell } from "@/components/workspace/workspace-shell"
import { DEMO_ANALYTICS, DEMO_FORM } from "@/lib/demo-data"

const totalViews = DEMO_ANALYTICS.reduce((total, row) => total + row.views, 0)
const totalSubmissions = DEMO_ANALYTICS.reduce(
  (total, row) => total + row.submissions,
  0,
)
const conversion = Math.round((totalSubmissions / totalViews) * 1000) / 10

const referrers = [
  { name: "Direct", value: 46, color: "#6658f5" },
  { name: "Social", value: 24, color: "#38bdf8" },
  { name: "Search", value: 18, color: "#0ea5a4" },
  { name: "Other", value: 12, color: "#cbd5e1" },
]

const devices = [
  { name: "Desktop", value: 58 },
  { name: "Mobile", value: 37 },
  { name: "Tablet", value: 5 },
]

function MetricCard({
  label,
  value,
  change,
  icon: Icon,
}: {
  label: string
  value: string
  change: number
  icon: typeof Eye
}) {
  const positive = change >= 0
  return (
    <Card className="gap-3 py-4 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between px-4 pb-0">
        <CardTitle className="text-xs font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="px-4">
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        <div
          className={`mt-1 inline-flex items-center gap-1 text-[10px] ${
            positive ? "text-emerald-600" : "text-red-600"
          }`}
        >
          {positive ? (
            <ArrowUpRight className="size-3" />
          ) : (
            <ArrowDownRight className="size-3" />
          )}
          {Math.abs(change)}% vs previous 14 days
        </div>
      </CardContent>
    </Card>
  )
}

export function FormAnalytics() {
  return (
    <WorkspaceShell section="analytics">
      <div className="min-h-0 flex-1 overflow-auto bg-muted/20">
        <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight">
                  Launch feedback
                </h1>
                <Badge
                  variant="outline"
                  className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700"
                >
                  Live
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Privacy-first conversion analytics · Last 14 days
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                render={
                  <Link
                    href={`/f/${DEMO_FORM.publicSlug}`}
                    target="_blank"
                    rel="noreferrer"
                  />
                }
              >
                <FormInput />
                View form
              </Button>
              <Button
                size="sm"
                render={<Link href="/demo?assistant=open" />}
              >
                <Sparkles />
                Preview AI assistant
              </Button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Unique views"
              value={totalViews.toLocaleString()}
              change={18.4}
              icon={Eye}
            />
            <MetricCard
              label="Form starts"
              value={Math.round(totalViews * 0.72).toLocaleString()}
              change={12.1}
              icon={MousePointerClick}
            />
            <MetricCard
              label="Submissions"
              value={totalSubmissions.toLocaleString()}
              change={22.7}
              icon={CheckCircle2}
            />
            <MetricCard
              label="Completion rate"
              value={`${conversion}%`}
              change={3.6}
              icon={BarChart3}
            />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_0.8fr]">
            <Card className="shadow-none">
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-sm">Views and submissions</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Deduplicated views compared with completed submissions
                  </p>
                </div>
                <Badge variant="secondary">Daily</Badge>
              </CardHeader>
              <CardContent className="h-72 px-2 sm:px-5">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={DEMO_ANALYTICS}>
                    <defs>
                      <linearGradient id="views-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6658f5" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#6658f5" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="#e9e9ef" />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 10, fill: "#7c7c8a" }}
                      tickFormatter={(value: string) => value.slice(5)}
                    />
                    <YAxis
                      width={28}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 10, fill: "#7c7c8a" }}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 10,
                        border: "1px solid #e4e4e7",
                        boxShadow: "0 12px 30px rgba(30, 24, 70, .1)",
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="views"
                      stroke="#6658f5"
                      strokeWidth={2}
                      fill="url(#views-fill)"
                    />
                    <Area
                      type="monotone"
                      dataKey="submissions"
                      stroke="#0ea5a4"
                      strokeWidth={2}
                      fill="transparent"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-sm">Conversion funnel</CardTitle>
                <p className="text-xs text-muted-foreground">
                  From unique view to saved record
                </p>
              </CardHeader>
              <CardContent className="space-y-5">
                {[
                  ["Viewed", totalViews, 100],
                  ["Started", Math.round(totalViews * 0.72), 72],
                  ["Submitted", totalSubmissions, conversion],
                ].map(([label, value, percent]) => (
                  <div key={label}>
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="font-medium">{label}</span>
                      <span className="text-muted-foreground">
                        {Number(value).toLocaleString()} · {percent}%
                      </span>
                    </div>
                    <Progress value={Number(percent)} />
                  </div>
                ))}
                <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-xs leading-5 text-indigo-800">
                  <span className="font-semibold">Healthy signal:</span> your
                  completion rate is 6.8 points above the organization average.
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-sm">Referrer category</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Individual referring pages are never stored
                </p>
              </CardHeader>
              <CardContent className="grid items-center gap-4 sm:grid-cols-[180px_1fr]">
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={referrers}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={48}
                        outerRadius={70}
                        paddingAngle={3}
                      >
                        {referrers.map((item) => (
                          <Cell key={item.name} fill={item.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-3">
                  {referrers.map((item) => (
                    <div key={item.name} className="flex items-center text-xs">
                      <span
                        className="mr-2 size-2 rounded-full"
                        style={{ background: item.color }}
                      />
                      <span>{item.name}</span>
                      <span className="ml-auto font-medium">{item.value}%</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Smartphone className="size-4" />
                  Device class
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Categorized on request; user agents are discarded
                </p>
              </CardHeader>
              <CardContent className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={devices} layout="vertical">
                    <CartesianGrid horizontal={false} stroke="#e9e9ef" />
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 10 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={62}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip />
                    <Bar dataKey="value" fill="#6658f5" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  )
}
