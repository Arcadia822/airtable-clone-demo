import Link from "next/link"
import { ArrowRight, DatabaseZap, KeyRound } from "lucide-react"

import { BrandMark } from "@/components/brand-mark"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function isConnectedStackConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() &&
      process.env.CLERK_SECRET_KEY?.trim() &&
      process.env.NEXT_PUBLIC_CONVEX_URL?.trim(),
  )
}

export function ConnectionRequired({
  destination,
}: {
  destination: "dashboard" | "workspace" | "forms"
}) {
  return (
    <main className="app-grid min-h-dvh bg-[#f6f6f3] px-5 py-8 dark:bg-background">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <BrandMark />
        <Button render={<Link href="/demo" />} variant="outline">
          Open interactive demo
        </Button>
      </div>
      <Card className="mx-auto mt-20 max-w-2xl overflow-hidden border-foreground/10 bg-background shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
        <CardHeader className="border-b p-8">
          <div className="mb-5 grid size-12 place-items-center rounded-xl bg-foreground text-background">
            <DatabaseZap className="size-5" />
          </div>
          <CardTitle className="text-2xl">
            Live workspace is not connected
          </CardTitle>
          <CardDescription className="max-w-xl text-sm leading-6">
            The live {destination} is not ready yet. You can still explore the
            interactive demo while the workspace owner finishes connecting it.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 p-8 sm:grid-cols-2">
          <div className="rounded-xl border bg-muted/25 p-4">
            <KeyRound className="size-4 text-foreground" />
            <p className="mt-3 text-sm font-medium">Secure access</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Only signed-in members of the selected organization can open its
              live bases.
            </p>
          </div>
          <div className="rounded-xl border bg-muted/25 p-4">
            <DatabaseZap className="size-4 text-foreground" />
            <p className="mt-3 text-sm font-medium">Live collaboration</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Once connected, edits appear for everyone in the workspace
              without needing to refresh.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button render={<Link href="/onboarding" />}>
              Return to workspace setup
              <ArrowRight />
            </Button>
            <Button render={<Link href="/demo" />} variant="outline">
              Explore the demo
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
