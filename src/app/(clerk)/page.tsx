import Link from "next/link"
import {
  ArrowRight,
  Bot,
  Check,
  FileUp,
  FormInput,
  MousePointer2,
  Sparkles,
  Users,
  Zap,
} from "lucide-react"

import { BrandMark } from "@/components/brand-mark"
import { MarketingHeader } from "@/components/marketing-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { isClerkConfigured } from "@/lib/clerk/config"

const features = [
  {
    icon: Users,
    title: "Live by default",
    description:
      "Every edit lands instantly for the whole organization, without refresh buttons or merge anxiety.",
  },
  {
    icon: FormInput,
    title: "Forms that feed your data",
    description:
      "Publish polished forms, choose where every answer is saved, and measure completion in one place.",
  },
  {
    icon: Bot,
    title: "AI you stay in control of",
    description:
      "Ask for insights across a base, then review and approve the exact change before anything is updated.",
  },
]

export default function HomePage() {
  return (
    <main className="min-h-dvh overflow-hidden bg-[#fbfbfd] text-slate-950">
      <MarketingHeader
        authEnabled={
          isClerkConfigured() && Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)
        }
      />

      <section className="relative">
        <div className="absolute inset-x-0 top-[-160px] h-[620px] bg-[radial-gradient(circle_at_50%_40%,rgba(109,93,252,0.19),transparent_52%)]" />
        <div className="absolute left-1/2 top-4 h-72 w-[720px] -translate-x-1/2 rounded-full bg-indigo-300/20 blur-[100px]" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:grid-cols-[0.82fr_1.18fr] lg:items-center lg:pb-28 lg:pt-28">
          <div className="relative z-10 max-w-2xl">
            <Badge
              variant="outline"
              className="mb-6 rounded-full border-indigo-200 bg-white/70 px-3 py-1 text-indigo-700 shadow-sm backdrop-blur"
            >
              <Sparkles className="size-3.5" />
              The operational database your team enjoys using
            </Badge>
            <h1 className="text-balance text-[3.45rem] font-semibold leading-[0.96] tracking-[-0.065em] text-slate-950 sm:text-7xl lg:text-[5.2rem]">
              Turn scattered work into
              <span className="bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600 bg-clip-text text-transparent">
                {" "}
                shared momentum.
              </span>
            </h1>
            <p className="mt-7 max-w-xl text-balance text-lg leading-8 text-slate-600 sm:text-xl">
              Build realtime databases, collect structured responses, and let
              a trustworthy AI teammate find the signal.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" render={<Link href="/demo" />} className="h-11 px-5">
                Open interactive workspace
                <ArrowRight data-icon="inline-end" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                render={<Link href="/pricing" />}
                className="h-11 border-slate-200 bg-white/70 px-5"
              >
                View organization plans
              </Button>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
              {["Free organization plan", "No card required", "Realtime from day one"].map(
                (item) => (
                  <span key={item} className="inline-flex items-center gap-1.5">
                    <Check className="size-3.5 text-emerald-600" />
                    {item}
                  </span>
                ),
              )}
            </div>
          </div>

          <div className="relative min-w-0">
            <div className="absolute -left-8 -top-9 hidden rounded-2xl border border-white/70 bg-white/80 p-3 shadow-xl shadow-indigo-950/10 backdrop-blur lg:block">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <span className="grid size-7 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
                  <Zap className="size-3.5" />
                </span>
                3 teammates editing now
              </div>
            </div>
            <div className="overflow-hidden rounded-[24px] border border-white bg-white shadow-[0_32px_90px_-32px_rgba(50,43,120,0.34)] ring-1 ring-slate-900/5">
              <div className="flex h-12 items-center gap-2 border-b border-slate-200 bg-slate-50/90 px-4">
                <span className="size-2.5 rounded-full bg-red-300" />
                <span className="size-2.5 rounded-full bg-amber-300" />
                <span className="size-2.5 rounded-full bg-emerald-300" />
                <div className="ml-3 h-6 flex-1 rounded-md border border-slate-200 bg-white" />
              </div>
              <div className="flex min-h-[450px]">
                <aside className="hidden w-40 shrink-0 border-r border-slate-200 bg-slate-50/70 p-3 sm:block">
                  <div className="mb-5 h-7 rounded-lg bg-indigo-100" />
                  {["Launches", "Feedback", "Roadmap"].map((item, index) => (
                    <div
                      key={item}
                      className={`mb-1 flex h-8 items-center rounded-md px-2 text-[11px] ${
                        index === 0
                          ? "bg-white font-medium text-slate-900 shadow-sm"
                          : "text-slate-500"
                      }`}
                    >
                      {item}
                    </div>
                  ))}
                </aside>
                <div className="min-w-0 flex-1">
                  <div className="flex h-11 items-center justify-between border-b border-slate-200 px-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">Launches</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">
                        Grid
                      </span>
                    </div>
                    <div className="flex -space-x-1.5">
                      {["MC", "AM", "PS"].map((initials, index) => (
                        <span
                          key={initials}
                          className="grid size-6 place-items-center rounded-full border-2 border-white text-[8px] font-semibold text-white"
                          style={{
                            background: ["#7c3aed", "#0891b2", "#ea580c"][index],
                          }}
                        >
                          {initials}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-[34px_1.5fr_1fr_1fr] border-b border-slate-200 bg-slate-50 text-[9px] font-medium uppercase tracking-wide text-slate-400">
                    <span className="border-r border-slate-200 p-2" />
                    <span className="border-r border-slate-200 p-2">Launch</span>
                    <span className="border-r border-slate-200 p-2">Status</span>
                    <span className="p-2">Owner</span>
                  </div>
                  {[
                    [
                      "Workspace templates",
                      "Launched",
                      "Maya Chen",
                      "bg-emerald-100 text-emerald-700",
                    ],
                    [
                      "Mobile inbox",
                      "In review",
                      "Alex Morgan",
                      "bg-amber-100 text-amber-700",
                    ],
                    [
                      "Form analytics",
                      "Building",
                      "Priya Shah",
                      "bg-sky-100 text-sky-700",
                    ],
                    [
                      "Bulk record import",
                      "Building",
                      "Noah Williams",
                      "bg-sky-100 text-sky-700",
                    ],
                    [
                      "AI column insights",
                      "Planning",
                      "Maya Chen",
                      "bg-violet-100 text-violet-700",
                    ],
                    [
                      "Customer portal",
                      "Planning",
                      "Elena Rossi",
                      "bg-violet-100 text-violet-700",
                    ],
                    [
                      "Weekly digest",
                      "In review",
                      "Noah Williams",
                      "bg-amber-100 text-amber-700",
                    ],
                    [
                      "Public API refresh",
                      "Building",
                      "Alex Morgan",
                      "bg-sky-100 text-sky-700",
                    ],
                    [
                      "Research hub",
                      "Planning",
                      "Priya Shah",
                      "bg-violet-100 text-violet-700",
                    ],
                  ].map(([name, status, owner, tone], index) => (
                    <div
                      key={name}
                      className="grid h-10 grid-cols-[34px_1.5fr_1fr_1fr] text-[10px] text-slate-600"
                    >
                      <span className="grid place-items-center border-b border-r border-slate-100 bg-slate-50/70 text-slate-400">
                        {index + 1}
                      </span>
                      <span className="truncate border-b border-r border-slate-100 p-3 font-medium text-slate-800">
                        {name}
                      </span>
                      <span className="border-b border-r border-slate-100 p-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 font-medium ${tone}`}
                        >
                          {status}
                        </span>
                      </span>
                      <span className="truncate border-b border-slate-100 p-3">
                        {owner}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="absolute -bottom-7 right-4 hidden max-w-[220px] rounded-2xl border border-white/80 bg-white/90 p-3 shadow-xl shadow-indigo-950/10 backdrop-blur sm:block">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                <span className="grid size-7 place-items-center rounded-lg bg-indigo-100 text-indigo-700">
                  <Bot className="size-3.5" />
                </span>
                Basecraft AI
              </div>
              <p className="text-[11px] leading-4 text-slate-500">
                Form analytics is 12% ahead of your last three launches.
              </p>
            </div>
            <MousePointer2 className="absolute -right-2 top-32 size-6 rotate-[-12deg] fill-indigo-600 text-indigo-600 drop-shadow-sm" />
          </div>
        </div>
      </section>

      <section id="product" className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl divide-y divide-slate-200 px-5 sm:px-8 md:grid-cols-3 md:divide-x md:divide-y-0">
          {features.map((feature) => (
            <div key={feature.title} className="px-2 py-10 md:px-8 md:py-14">
              <feature.icon className="mb-5 size-5 text-indigo-600" />
              <h2 className="font-semibold tracking-tight">{feature.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section id="ai" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="grid gap-8 overflow-hidden rounded-[28px] bg-slate-950 p-7 text-white sm:p-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
          <div>
            <Badge className="mb-5 border-white/10 bg-white/10 text-indigo-200">
              Pro organizations
            </Badge>
            <h2 className="text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">
              Insights first. Changes only when you approve.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-400">
              Your AI teammate can review the workspace data you choose,
              compare form performance, and suggest precise record or column
              updates. Every change waits for your confirmation and appears in
              the workspace activity history.
            </p>
            <Button
              variant="secondary"
              className="mt-7"
              render={<Link href="/pricing" />}
            >
              Compare plans
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-4 shadow-2xl">
            <div className="mb-4 flex items-center gap-2 text-xs text-slate-400">
              <Sparkles className="size-3.5 text-indigo-300" />
              Analyzing Product operations / Launches
            </div>
            <div className="rounded-xl bg-white/[0.07] p-4 text-sm leading-6 text-slate-200">
              “Three launches with target dates inside 14 days are below 55%
              progress. Mobile inbox has the most execution risk because it
              also has an unresolved review status.”
            </div>
            <div className="mt-3 rounded-xl border border-indigo-400/20 bg-indigo-400/10 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-indigo-100">
                <FileUp className="size-4" />
                Proposed update
              </div>
              <p className="mt-2 text-xs leading-5 text-indigo-200/70">
                Set “Mobile inbox” status from In review → Building and add a
                risk note. This change has not been applied.
              </p>
              <div className="mt-3 flex gap-2">
                <span className="rounded-md bg-indigo-400 px-2.5 py-1.5 text-[11px] font-semibold text-slate-950">
                  Approve change
                </span>
                <span className="rounded-md border border-white/10 px-2.5 py-1.5 text-[11px]">
                  Deny
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <BrandMark />
          <p>Realtime databases and forms for focused teams.</p>
        </div>
      </footer>
    </main>
  )
}
