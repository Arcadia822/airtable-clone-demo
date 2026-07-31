import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Columns3,
  Database,
  FileText,
  FormInput,
  Globe2,
  GripVertical,
  LockKeyhole,
  MousePointer2,
  Plus,
  Rows3,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { MarketingHeader } from "@/components/marketing-header";
import { Button } from "@/components/ui/button";
import { isClerkConfigured } from "@/lib/clerk/config";

const workflow = [
  {
    number: "01",
    title: "Shape the data",
    description:
      "Create a base, add tables, then arrange typed columns around the way your team already works.",
  },
  {
    number: "02",
    title: "Collect responses",
    description:
      "Build public forms visually and choose which table column receives every answer.",
  },
  {
    number: "03",
    title: "Measure the journey",
    description:
      "See views, starts, submissions, exits, and top answers without leaving the workspace.",
  },
  {
    number: "04",
    title: "Act with confidence",
    description:
      "Ask the assistant to investigate live data, then approve or reject any suggested edit.",
  },
];

const rows = [
  {
    name: "Mobile inbox",
    status: "In review",
    owner: "Alex Morgan",
    date: "12 Aug",
    tone: "bg-amber-50 text-amber-800 ring-amber-700/15",
  },
  {
    name: "Form analytics",
    status: "Building",
    owner: "Priya Shah",
    date: "18 Aug",
    tone: "bg-blue-50 text-blue-700 ring-blue-700/15",
  },
  {
    name: "Workspace templates",
    status: "Shipped",
    owner: "Maya Chen",
    date: "29 Jul",
    tone: "bg-emerald-50 text-emerald-700 ring-emerald-700/15",
  },
  {
    name: "Bulk record import",
    status: "Building",
    owner: "Noah Williams",
    date: "21 Aug",
    tone: "bg-blue-50 text-blue-700 ring-blue-700/15",
  },
  {
    name: "Customer portal",
    status: "Planned",
    owner: "Elena Rossi",
    date: "03 Sep",
    tone: "bg-slate-100 text-slate-600 ring-slate-700/10",
  },
];

const chartBars = [40, 54, 47, 68, 58, 78, 64, 86, 72, 92, 76, 83];

export default function HomePage() {
  return (
    <main className="min-h-dvh overflow-hidden bg-[#f7f6f2] text-slate-950">
      <MarketingHeader
        authEnabled={
          isClerkConfigured() && Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)
        }
      />

      <section className="border-b border-slate-300/80">
        <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[minmax(0,0.9fr)_minmax(600px,1.1fr)]">
          <div className="flex flex-col justify-center border-slate-300/80 px-5 py-16 sm:px-8 sm:py-24 lg:border-r lg:px-12 lg:py-28 xl:px-16">
            <div className="mb-8 flex items-center gap-3 text-xs font-medium text-slate-500">
              <span className="h-px w-8 bg-blue-600" />
              Realtime data, forms, and decisions
            </div>
            <h1 className="max-w-3xl text-balance text-[3.1rem] font-semibold leading-[0.96] tracking-[-0.06em] text-slate-950 sm:text-6xl xl:text-[4.25rem]">
              Data that moves
              <span className="block text-blue-600">with your team.</span>
            </h1>
            <p className="mt-7 max-w-xl text-pretty text-lg leading-8 text-slate-600">
              Build flexible databases that update together. Publish forms that
              save answers straight into your tables. Understand performance,
              then let AI help you find the next move.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button
                size="lg"
                render={<Link href="/demo" />}
                className="h-11 bg-blue-600 px-5 text-white hover:bg-blue-700"
              >
                Explore the live demo
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                render={<Link href="/onboarding" />}
                className="h-11 border-slate-300 bg-white px-5"
              >
                Create a workspace
              </Button>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-500">
              {[
                "Free plan",
                "No card required",
                "Made for organizations",
              ].map((item) => (
                <span key={item} className="inline-flex items-center gap-1.5">
                  <Check className="size-3.5 text-blue-600" aria-hidden="true" />
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="relative min-w-0 bg-[#ecebe6] p-4 sm:p-8 lg:p-10 xl:p-14">
            <div className="absolute inset-0 opacity-50 [background-image:linear-gradient(to_right,#cbd5e1_1px,transparent_1px),linear-gradient(to_bottom,#cbd5e1_1px,transparent_1px)] [background-size:32px_32px]" />
            <div className="relative overflow-hidden rounded-lg border border-slate-300 bg-white shadow-[0_24px_60px_-35px_rgba(15,23,42,0.5)]">
              <div className="flex h-11 items-center border-b border-slate-200 bg-[#fbfbfa] px-3">
                <div className="flex items-center gap-1.5" aria-hidden="true">
                  <span className="size-2 rounded-full bg-slate-300" />
                  <span className="size-2 rounded-full bg-slate-300" />
                  <span className="size-2 rounded-full bg-slate-300" />
                </div>
                <div className="mx-auto flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1 text-[10px] text-slate-500">
                  <LockKeyhole className="size-3" aria-hidden="true" />
                  Product operations / Roadmap
                </div>
              </div>

              <div className="grid min-h-[480px] sm:grid-cols-[150px_minmax(520px,1fr)]">
                <aside className="hidden border-r border-slate-200 bg-[#f8f8f5] p-3 sm:block">
                  <div className="mb-5 flex items-center gap-2 px-1 text-[11px] font-semibold text-slate-800">
                    <span className="grid size-6 place-items-center rounded-md bg-blue-600 text-white">
                      <Database className="size-3.5" aria-hidden="true" />
                    </span>
                    Product ops
                  </div>
                  <p className="mb-2 px-2 text-[8px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Tables
                  </p>
                  {["Product roadmap", "Feedback", "Launch tasks"].map(
                    (item, index) => (
                      <div
                        key={item}
                        className={`mb-0.5 flex h-8 items-center gap-2 rounded-md px-2 text-[10px] ${
                          index === 0
                            ? "bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200"
                            : "text-slate-500"
                        }`}
                      >
                        <Rows3 className="size-3" aria-hidden="true" />
                        {item}
                      </div>
                    ),
                  )}
                  <p className="mb-2 mt-6 px-2 text-[8px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Forms
                  </p>
                  <div className="flex h-8 items-center gap-2 rounded-md px-2 text-[10px] text-slate-500">
                    <FileText className="size-3" aria-hidden="true" />
                    Product feedback
                  </div>
                </aside>

                <div className="min-w-0 overflow-hidden">
                  <div className="flex h-12 items-center justify-between border-b border-slate-200 px-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">
                        Product roadmap
                      </span>
                      <span className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[9px] text-slate-500">
                        Grid
                        <ChevronDown className="size-2.5" aria-hidden="true" />
                      </span>
                    </div>
                    <div className="flex items-center">
                      <span className="mr-2 hidden items-center gap-1 text-[9px] text-emerald-700 md:inline-flex">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        Saved
                      </span>
                      <div className="flex -space-x-1">
                        {[
                          ["MC", "bg-slate-900"],
                          ["AM", "bg-blue-600"],
                          ["PS", "bg-amber-600"],
                        ].map(([initials, tone]) => (
                          <span
                            key={initials}
                            className={`grid size-6 place-items-center rounded-full border-2 border-white text-[7px] font-semibold text-white ${tone}`}
                          >
                            {initials}
                          </span>
                        ))}
                      </div>
                      <span className="ml-2 grid size-6 place-items-center rounded border border-slate-200 text-slate-500">
                        <Plus className="size-3" aria-hidden="true" />
                      </span>
                    </div>
                  </div>
                  <div className="flex h-9 items-center gap-4 border-b border-slate-200 bg-[#fbfbfa] px-3 text-[9px] text-slate-500">
                    <span className="font-medium text-slate-800">Grid</span>
                    <span>Filter</span>
                    <span>Group</span>
                    <span>Sort</span>
                    <span className="ml-auto">Row height</span>
                  </div>
                  <div className="min-w-[540px]">
                    <div className="grid grid-cols-[34px_1.55fr_0.9fr_1fr_0.65fr] border-b border-slate-200 bg-slate-50 text-[9px] font-medium text-slate-500">
                      <span className="border-r border-slate-200 p-2" />
                      <span className="flex items-center gap-1.5 border-r border-slate-200 p-2">
                        <Columns3 className="size-3" aria-hidden="true" />
                        Initiative
                      </span>
                      <span className="flex items-center gap-1.5 border-r border-slate-200 p-2">
                        <Activity className="size-3" aria-hidden="true" />
                        Status
                      </span>
                      <span className="flex items-center gap-1.5 border-r border-slate-200 p-2">
                        <Users className="size-3" aria-hidden="true" />
                        Owner
                      </span>
                      <span className="p-2">Target</span>
                    </div>
                    {rows.map((row, index) => (
                      <div
                        key={row.name}
                        className="grid h-11 grid-cols-[34px_1.55fr_0.9fr_1fr_0.65fr] text-[10px] text-slate-600"
                      >
                        <span className="grid place-items-center border-b border-r border-slate-100 bg-slate-50/60 tabular-nums text-slate-400">
                          {index + 1}
                        </span>
                        <span
                          className={`relative truncate border-b border-r border-slate-100 p-3 font-medium text-slate-800 ${
                            index === 1
                              ? "bg-blue-50 ring-2 ring-inset ring-blue-600"
                              : ""
                          }`}
                        >
                          {row.name}
                          {index === 1 ? (
                            <span className="absolute -bottom-4 right-1 z-10 rounded bg-blue-600 px-1.5 py-0.5 text-[7px] text-white">
                              Priya
                            </span>
                          ) : null}
                        </span>
                        <span className="border-b border-r border-slate-100 p-2.5">
                          <span
                            className={`inline-flex rounded px-1.5 py-0.5 font-medium ring-1 ring-inset ${row.tone}`}
                          >
                            {row.status}
                          </span>
                        </span>
                        <span className="truncate border-b border-r border-slate-100 p-3">
                          {row.owner}
                        </span>
                        <span className="border-b border-slate-100 p-3 tabular-nums">
                          {row.date}
                        </span>
                      </div>
                    ))}
                    <div className="flex h-11 items-center gap-2 border-b border-slate-100 px-3 text-[10px] text-slate-400">
                      <Plus className="size-3" aria-hidden="true" />
                      Add record
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <MousePointer2 className="absolute bottom-20 right-8 size-6 rotate-[-12deg] fill-blue-600 text-blue-600 drop-shadow-sm" />
            <div className="absolute right-5 top-3 hidden items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-[10px] font-medium text-slate-700 shadow-lg sm:flex">
              <Zap className="size-3.5 text-blue-600" aria-hidden="true" />
              3 teammates editing now
            </div>
          </div>
        </div>
      </section>

      <section id="product" className="border-b border-slate-300/80 bg-white">
        <div className="mx-auto max-w-[1440px]">
          <div className="grid border-slate-300/80 md:grid-cols-[0.6fr_1.4fr]">
            <div className="border-b border-slate-300/80 px-5 py-10 sm:px-8 md:border-b-0 md:border-r lg:px-12">
              <p className="text-sm font-semibold text-blue-600">
                One continuous workflow
              </p>
              <h2 className="mt-3 max-w-sm text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                From first row to better decision.
              </h2>
            </div>
            <div className="grid divide-y divide-slate-200 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
              {workflow.map((item) => (
                <div key={item.number} className="min-h-56 p-6 lg:p-7">
                  <span className="font-mono text-xs tabular-nums text-blue-600">
                    {item.number}
                  </span>
                  <h3 className="mt-10 text-base font-semibold tracking-tight">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="forms" className="border-b border-slate-300/80 bg-[#f7f6f2]">
        <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 sm:py-28 lg:px-12">
          <div className="grid gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-end">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-600">
                <FormInput className="size-4" aria-hidden="true" />
                Public forms
              </div>
              <h2 className="mt-4 max-w-xl text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.05em] sm:text-5xl">
                Ask beautifully. Save answers exactly where they belong.
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-7 text-slate-600 lg:justify-self-end">
              Build several forms for the same database without duplicating your
              data. Choose the destination for each question, add validation and
              conditions, customize the public experience, then share one clean
              link.
            </p>
          </div>

          <div className="mt-12 overflow-hidden rounded-lg border border-slate-300 bg-white shadow-[0_20px_60px_-40px_rgba(15,23,42,0.5)]">
            <div className="flex h-12 items-center justify-between border-b border-slate-200 bg-[#fbfbfa] px-4">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <FileText className="size-3.5 text-blue-600" aria-hidden="true" />
                Product feedback
                <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-800">
                  Draft changes
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden text-[10px] text-slate-500 sm:inline">
                  Preview
                </span>
                <span className="rounded-md bg-blue-600 px-3 py-1.5 text-[10px] font-semibold text-white">
                  Publish form
                </span>
              </div>
            </div>
            <div className="grid min-h-[560px] lg:grid-cols-[220px_minmax(360px,1fr)_260px]">
              <div className="border-b border-slate-200 bg-[#f8f8f5] p-4 lg:border-b-0 lg:border-r">
                <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Questions
                </p>
                <div className="mt-3 space-y-1.5">
                  {[
                    ["Summarize your feedback", "Long answer"],
                    ["How urgent is this?", "Single choice"],
                    ["Which area is affected?", "Multiple choice"],
                    ["Add a screenshot", "File upload"],
                    ["Your email", "Email"],
                  ].map(([label, type], index) => (
                    <div
                      key={label}
                      className={`flex items-center gap-2 rounded-md border p-2.5 ${
                        index === 1
                          ? "border-blue-300 bg-blue-50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <GripVertical
                        className="size-3.5 shrink-0 text-slate-300"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-[10px] font-medium text-slate-800">
                          {label}
                        </p>
                        <p className="mt-0.5 text-[8px] text-slate-400">
                          {type}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 py-2 text-[10px] font-medium text-slate-500"
                >
                  <Plus className="size-3" aria-hidden="true" />
                  Add question
                </button>
              </div>

              <div className="flex items-center justify-center bg-[#eeede8] p-5 sm:p-8">
                <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_18px_50px_-34px_rgba(15,23,42,0.65)]">
                  <div className="h-1.5 bg-blue-600" />
                  <div className="p-6 sm:p-8">
                    <div className="mb-8 flex items-center justify-between">
                      <span className="grid size-8 place-items-center rounded-md bg-slate-950 text-white">
                        <FormInput className="size-4" aria-hidden="true" />
                      </span>
                      <span className="inline-flex items-center gap-1 text-[9px] text-slate-400">
                        <Globe2 className="size-3" aria-hidden="true" />
                        Public
                      </span>
                    </div>
                    <h3 className="text-2xl font-semibold tracking-[-0.035em]">
                      Help us shape the roadmap
                    </h3>
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      Tell the product team what would make the biggest
                      difference to your work.
                    </p>
                    <div className="mt-7">
                      <label className="text-xs font-medium text-slate-800">
                        How urgent is this for your team?
                      </label>
                      <div className="mt-2 space-y-2">
                        {["Low", "Medium", "High", "Blocking"].map(
                          (option, index) => (
                            <div
                              key={option}
                              className={`flex items-center gap-2 rounded-md border px-3 py-2.5 text-xs ${
                                index === 2
                                  ? "border-blue-500 bg-blue-50 text-blue-800"
                                  : "border-slate-200 text-slate-600"
                              }`}
                            >
                              <span
                                className={`size-3 rounded-full border ${
                                  index === 2
                                    ? "border-[4px] border-blue-600"
                                    : "border-slate-300"
                                }`}
                              />
                              {option}
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                    <div className="mt-7 flex items-center justify-between">
                      <span className="text-[9px] text-slate-400">
                        2 of 5 questions
                      </span>
                      <span className="rounded-md bg-slate-950 px-4 py-2 text-[10px] font-semibold text-white">
                        Continue
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 bg-white p-4 lg:border-l lg:border-t-0">
                <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Question settings
                </p>
                <div className="mt-4 space-y-5">
                  <div>
                    <p className="text-[10px] font-medium text-slate-700">
                      Question
                    </p>
                    <div className="mt-1.5 rounded-md border border-slate-200 px-3 py-2 text-[10px] text-slate-700">
                      How urgent is this for your team?
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium text-slate-700">
                      Save answer to
                    </p>
                    <div className="mt-1.5 flex items-center justify-between rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-[10px] font-medium text-blue-800">
                      Urgency
                      <ChevronDown className="size-3" aria-hidden="true" />
                    </div>
                    <p className="mt-1.5 text-[9px] leading-4 text-slate-400">
                      Product feedback table · Single choice
                    </p>
                  </div>
                  <div className="border-t border-slate-200 pt-4">
                    {[
                      ["Required answer", true],
                      ["Show description", false],
                      ["Allow an “Other” answer", false],
                    ].map(([label, enabled]) => (
                      <div
                        key={String(label)}
                        className="flex items-center justify-between py-2 text-[10px] text-slate-600"
                      >
                        {label}
                        <span
                          className={`flex h-4 w-7 items-center rounded-full p-0.5 ${
                            enabled ? "justify-end bg-blue-600" : "bg-slate-200"
                          }`}
                        >
                          <span className="size-3 rounded-full bg-white shadow-sm" />
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-md border border-slate-200 bg-[#f8f8f5] p-3">
                    <div className="flex items-center gap-2 text-[10px] font-medium text-slate-700">
                      <CheckCircle2
                        className="size-3.5 text-emerald-600"
                        aria-hidden="true"
                      />
                      Ready to publish
                    </div>
                    <p className="mt-1 text-[9px] leading-4 text-slate-400">
                      Every question has a valid destination.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="analytics"
        className="border-b border-slate-300/80 bg-white"
      >
        <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[0.75fr_1.25fr]">
          <div className="flex flex-col justify-center border-slate-300/80 px-5 py-16 sm:px-8 sm:py-24 lg:border-r lg:px-12">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-600">
              <BarChart3 className="size-4" aria-hidden="true" />
              Form analytics
            </div>
            <h2 className="mt-4 max-w-xl text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.05em] sm:text-5xl">
              Know what happened before the responses arrive.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-600">
              Track the full path from view to submission. Compare periods,
              understand where visitors leave, and see which answers appear most
              often—without collecting invasive browsing details.
            </p>
            <div className="mt-8 grid max-w-lg grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
              {[
                ["Unique views", "839"],
                ["Form starts", "604"],
                ["Submissions", "359"],
                ["Completion", "59.4%"],
              ].map(([label, value]) => (
                <div key={label} className="bg-white p-4">
                  <p className="text-[10px] text-slate-500">{label}</p>
                  <p className="mt-1 font-mono text-xl font-semibold tabular-nums tracking-tight">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#f7f6f2] p-5 sm:p-8 lg:p-12">
            <div className="overflow-hidden rounded-lg border border-slate-300 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <p className="text-xs font-semibold">Product feedback</p>
                  <p className="mt-0.5 text-[9px] text-slate-400">
                    Last 30 days · UTC
                  </p>
                </div>
                <span className="rounded-md border border-slate-200 px-2 py-1 text-[9px] text-slate-500">
                  Compare period
                </span>
              </div>
              <div className="p-4 sm:p-6">
                <div className="flex items-baseline justify-between">
                  <div>
                    <p className="text-[10px] text-slate-500">Daily activity</p>
                    <p className="mt-1 text-sm font-semibold">
                      Views and submissions
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-[9px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <span className="size-1.5 rounded-full bg-blue-600" />
                      Views
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="size-1.5 rounded-full bg-slate-300" />
                      Submitted
                    </span>
                  </div>
                </div>
                <div className="mt-8 flex h-44 items-end gap-2 border-b border-slate-200 sm:gap-3">
                  {chartBars.map((height, index) => (
                    <div
                      key={`${height}-${index}`}
                      className="group relative flex h-full flex-1 items-end justify-center"
                    >
                      <span
                        className="w-full max-w-5 rounded-t-sm bg-blue-600 transition-colors group-hover:bg-blue-700"
                        style={{ height: `${height}%` }}
                      />
                      <span
                        className="absolute bottom-0 right-0 w-1/3 max-w-1.5 rounded-t-sm bg-slate-300"
                        style={{ height: `${Math.max(16, height - 32)}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex justify-between font-mono text-[8px] tabular-nums text-slate-400">
                  <span>02 Jul</span>
                  <span>16 Jul</span>
                  <span>31 Jul</span>
                </div>
                <div className="mt-6 grid gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-3">
                  {[
                    ["Top source", "Search", "38.0%"],
                    ["Top device", "Desktop", "54.2%"],
                    ["Main exit", "Tell us more", "42 exits"],
                  ].map(([label, value, detail]) => (
                    <div key={label} className="bg-[#fbfbfa] p-3">
                      <p className="text-[9px] text-slate-400">{label}</p>
                      <div className="mt-1 flex items-end justify-between gap-2">
                        <p className="text-xs font-medium">{value}</p>
                        <p className="font-mono text-[9px] tabular-nums text-slate-500">
                          {detail}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-300/80 bg-[#f7f6f2]">
        <div className="mx-auto grid max-w-[1440px] lg:grid-cols-2">
          <div className="border-b border-slate-300/80 px-5 py-16 sm:px-8 lg:border-b-0 lg:border-r lg:px-12 lg:py-24">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-600">
              <Users className="size-4" aria-hidden="true" />
              Organization workspaces
            </div>
            <h2 className="mt-4 max-w-xl text-balance text-4xl font-semibold tracking-[-0.05em]">
              One secure home for every team.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-600">
              Clerk keeps membership, organization access, and billing together.
              Switch workspaces without mixing their data, invite teammates, and
              unlock features for the whole organization with one plan.
            </p>
            <div className="mt-9 max-w-xl overflow-hidden rounded-lg border border-slate-300 bg-white">
              <div className="flex items-center gap-3 border-b border-slate-200 p-4">
                <span className="grid size-9 place-items-center rounded-md bg-slate-950 text-sm font-semibold text-white">
                  N
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    Northstar Studio
                  </p>
                  <p className="text-[10px] text-slate-400">8 members</p>
                </div>
                <span className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[9px] font-semibold text-blue-700">
                  Pro
                </span>
              </div>
              <div className="grid grid-cols-2 divide-x divide-slate-200 p-4 text-[10px] text-slate-500">
                <div className="pr-4">
                  <p className="font-mono text-xl font-semibold tabular-nums text-slate-900">
                    12
                  </p>
                  Active bases
                </div>
                <div className="pl-4">
                  <p className="font-mono text-xl font-semibold tabular-nums text-slate-900">
                    6
                  </p>
                  Published forms
                </div>
              </div>
            </div>
          </div>

          <div className="px-5 py-16 sm:px-8 lg:px-12 lg:py-24">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-600">
              <ShieldCheck className="size-4" aria-hidden="true" />
              Built for shared operations
            </div>
            <div className="mt-8 divide-y divide-slate-300 border-y border-slate-300">
              {[
                [
                  "Realtime collaboration",
                  "Edits, presence, and connection state stay visible while the team works.",
                ],
                [
                  "Flexible field types",
                  "Text, dates, choices, attachments, files, and more—without engineering help.",
                ],
                [
                  "Public collection",
                  "Publish multiple branded forms for the same base and share them anywhere.",
                ],
                [
                  "Plan-aware access",
                  "Analytics, branding, and AI capabilities follow the active organization plan.",
                ],
              ].map(([title, description]) => (
                <div
                  key={title}
                  className="grid gap-2 py-5 sm:grid-cols-[0.7fr_1.3fr] sm:gap-6"
                >
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="text-sm leading-6 text-slate-500">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="ai" className="bg-[#171a20] text-white">
        <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[0.74fr_1.26fr]">
          <div className="border-white/10 px-5 py-20 sm:px-8 lg:border-r lg:px-12 lg:py-28">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-400">
              <Bot className="size-4" aria-hidden="true" />
              AI for Pro organizations
            </div>
            <h2 className="mt-4 max-w-xl text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.05em] sm:text-5xl">
              Answers now. Changes only after approval.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-400">
              Ask about records, tables, or form performance in plain language.
              Basecraft can inspect the workspace you have open, cite the
              relevant data, and prepare a change without silently applying it.
            </p>
            <Button
              variant="secondary"
              className="mt-8 bg-white text-slate-950 hover:bg-slate-100"
              render={<Link href="/pricing" />}
            >
              Compare organization plans
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Button>
          </div>

          <div className="flex items-center bg-[#111318] p-5 sm:p-8 lg:p-12">
            <div className="w-full overflow-hidden rounded-lg border border-white/10 bg-[#1b1f26] shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-md bg-blue-600">
                    <Sparkles className="size-3.5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold">Base analyst</p>
                    <p className="text-[9px] text-slate-500">
                      Product operations · Roadmap
                    </p>
                  </div>
                </div>
                <span className="rounded border border-white/10 px-2 py-1 text-[9px] text-slate-400">
                  Read access
                </span>
              </div>
              <div className="space-y-4 p-4 sm:p-6">
                <div className="ml-auto max-w-md rounded-md bg-white px-4 py-3 text-sm text-slate-900">
                  Which launches need attention before the end of August?
                </div>
                <div className="max-w-xl border-l-2 border-blue-500 pl-4">
                  <p className="text-sm leading-6 text-slate-200">
                    Mobile inbox carries the most risk: its target date is 12
                    August and it is still in review. Form analytics is building
                    with a later target of 18 August.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {["Mobile inbox · row 1", "Form analytics · row 2"].map(
                      (reference) => (
                        <span
                          key={reference}
                          className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[9px] text-slate-400"
                        >
                          {reference}
                        </span>
                      ),
                    )}
                  </div>
                </div>
                <div className="rounded-md border border-blue-400/30 bg-blue-400/[0.06]">
                  <div className="flex items-center justify-between border-b border-blue-400/20 px-4 py-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-blue-200">
                      <FileText className="size-3.5" aria-hidden="true" />
                      Suggested edit
                    </div>
                    <span className="text-[9px] text-blue-300/70">
                      Waiting for you
                    </span>
                  </div>
                  <div className="grid gap-px bg-blue-400/20 sm:grid-cols-2">
                    <div className="bg-[#1b1f26] p-4">
                      <p className="text-[9px] uppercase tracking-wider text-slate-500">
                        Before
                      </p>
                      <p className="mt-2 text-xs text-slate-300">
                        Mobile inbox · In review
                      </p>
                    </div>
                    <div className="bg-[#1b1f26] p-4">
                      <p className="text-[9px] uppercase tracking-wider text-blue-400">
                        After
                      </p>
                      <p className="mt-2 text-xs text-white">
                        Mobile inbox · At risk
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 px-4 py-3">
                    <span className="rounded-md border border-white/10 px-3 py-1.5 text-[10px] font-medium text-slate-300">
                      Reject
                    </span>
                    <span className="rounded-md bg-blue-500 px-3 py-1.5 text-[10px] font-semibold text-white">
                      Approve change
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-300 bg-blue-600 text-white">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-8 px-5 py-16 sm:px-8 md:flex-row md:items-center md:justify-between lg:px-12 lg:py-20">
          <div>
            <p className="text-sm font-medium text-blue-100">
              Start with the complete workspace
            </p>
            <h2 className="mt-2 max-w-2xl text-balance text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
              Tables, forms, analytics, and AI—working as one product.
            </h2>
          </div>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
            <Button
              size="lg"
              variant="secondary"
              render={<Link href="/demo" />}
              className="bg-white text-blue-700 hover:bg-blue-50"
            >
              Open the demo
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Button>
            <Button
              size="lg"
              render={<Link href="/pricing" />}
              className="border border-blue-300 bg-transparent text-white hover:bg-blue-700"
            >
              View plans
            </Button>
          </div>
        </div>
      </section>

      <footer className="bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-5 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
          <BrandMark treatment="ink" />
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/#product" className="hover:text-slate-950">
              Product
            </Link>
            <Link href="/demo" className="hover:text-slate-950">
              Demo workspace
            </Link>
            <Link href="/pricing" className="hover:text-slate-950">
              Pricing
            </Link>
          </div>
          <p>Realtime databases and forms for focused teams.</p>
        </div>
      </footer>
    </main>
  );
}
