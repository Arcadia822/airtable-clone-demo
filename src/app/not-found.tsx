import Link from "next/link"
import { ArrowLeft, SearchX } from "lucide-react"

import { BrandMark } from "@/components/brand-mark"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-muted/20 px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border bg-background p-7 shadow-sm">
        <div className="flex items-center gap-3">
          <BrandMark className="size-9" />
          <span className="text-sm font-semibold">Basecraft</span>
        </div>
        <SearchX className="mt-8 size-9 text-muted-foreground" />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          We couldn’t find that page
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The link may be old, or the item may no longer be available in this
          workspace.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button render={<Link href="/dashboard" />}>
            Go to workspace
          </Button>
          <Button
            render={<Link href="/" />}
            variant="outline"
          >
            <ArrowLeft />
            Basecraft home
          </Button>
        </div>
      </section>
    </main>
  )
}
