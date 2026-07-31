import Link from "next/link"
import type { ReactNode } from "react"
import { KeyRound, ShieldCheck } from "lucide-react"

import { BrandMark } from "@/components/brand-mark"

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <main className="relative isolate grid min-h-dvh overflow-hidden bg-background lg:grid-cols-[minmax(0,0.9fr)_minmax(480px,1.1fr)]">
      <div className="app-grid absolute inset-0 -z-20 opacity-35" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_10%,color-mix(in_oklch,var(--primary),transparent_84%),transparent_36%),radial-gradient(circle_at_80%_85%,color-mix(in_oklch,var(--chart-2),transparent_86%),transparent_34%)]" />

      <section className="hidden border-r border-border/70 p-10 lg:flex lg:flex-col">
        <Link href="/" className="w-fit" aria-label="Basecraft home">
          <BrandMark />
        </Link>

        <div className="my-auto max-w-lg">
          <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">
            Realtime workspaces
          </p>
          <h2 className="mt-5 text-balance text-4xl leading-[1.08] font-semibold tracking-[-0.04em]">
            Bring data, forms, and your team into one shared system.
          </h2>
          <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">
            Every workspace keeps its people, billing, and data separate.
          </p>

          <div className="mt-10 grid gap-3">
            <div className="flex items-center gap-3 rounded-xl border bg-background/70 p-4 shadow-sm">
              <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                <ShieldCheck className="size-4" />
              </span>
              <div>
                <p className="text-sm font-medium">Organization-first access</p>
                <p className="text-xs text-muted-foreground">
                  Members only see the workspaces their organization owns.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border bg-background/70 p-4 shadow-sm">
              <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                <KeyRound className="size-4" />
              </span>
              <div>
                <p className="text-sm font-medium">One secure place for your team</p>
                <p className="text-xs text-muted-foreground">
                  Sign in once to open only the work and plan details your team
                  can access.
                </p>
              </div>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Secure sign-in and workspace billing are built in.
        </p>
      </section>

      <section className="flex min-h-dvh flex-col px-5 py-6 sm:px-8 lg:px-12">
        <Link
          href="/"
          className="mb-10 w-fit lg:hidden"
          aria-label="Basecraft home"
        >
          <BrandMark />
        </Link>

        <div className="m-auto w-full max-w-md">
          <div className="mb-7">
            <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">
              {eyebrow}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em]">
              {title}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>
          {children}
        </div>
      </section>
    </main>
  )
}

export function ClerkSetupState() {
  return (
    <div className="rounded-2xl border border-dashed border-primary/35 bg-primary/[0.035] p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <KeyRound className="size-5" />
        </span>
        <div>
          <p className="font-medium">Sign-in is not available yet</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            This workspace is still being connected to its sign-in service.
            Please try again later or ask the workspace owner for help.
          </p>
        </div>
      </div>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        Your account and workspace data have not been changed.
      </p>
    </div>
  )
}
