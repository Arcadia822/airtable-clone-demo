"use client"

import Link from "next/link"
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react"
import { useEffect } from "react"

import { BrandMark } from "@/components/brand-mark"
import { Button } from "@/components/ui/button"

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="grid min-h-dvh place-items-center bg-muted/20 px-5 py-12">
      <section
        aria-labelledby="app-error-title"
        className="w-full max-w-md rounded-2xl border bg-background p-7 shadow-sm"
        role="alert"
      >
        <div className="flex items-center gap-3">
          <BrandMark className="size-9" />
          <span className="text-sm font-semibold">Basecraft</span>
        </div>
        <div className="mt-8 flex size-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700">
          <AlertTriangle className="size-5" />
        </div>
        <h1
          className="mt-4 text-2xl font-semibold tracking-tight"
          id="app-error-title"
        >
          This page hit a snag
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Your saved work is still safe. Try loading the page again, or return
          to your workspace and continue from there.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={reset}>
            <RefreshCw />
            Try again
          </Button>
          <Button render={<Link href="/dashboard" />} variant="outline">
            Go to workspace
          </Button>
          <Button onClick={() => window.history.back()} variant="ghost">
            <ArrowLeft />
            Go back
          </Button>
        </div>
      </section>
    </main>
  )
}
