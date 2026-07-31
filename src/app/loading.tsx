import { BrandMark } from "@/components/brand-mark"

export default function AppLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading page"
      className="grid min-h-dvh place-items-center bg-muted/20 px-5"
    >
      <div className="flex items-center gap-3 rounded-2xl border bg-background px-5 py-4 shadow-sm">
        <BrandMark className="size-8 animate-pulse motion-reduce:animate-none" />
        <div>
          <p className="text-sm font-semibold">Opening your workspace</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Your latest changes are on the way…
          </p>
        </div>
      </div>
    </main>
  )
}
