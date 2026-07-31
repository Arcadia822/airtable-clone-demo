import { Blocks } from "lucide-react"

import { cn } from "@/lib/utils"

export function BrandMark({
  className,
  showName = true,
  treatment = "color",
}: {
  className?: string
  showName?: boolean
  treatment?: "color" | "ink"
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "grid size-8 place-items-center rounded-lg text-white",
          treatment === "ink"
            ? "bg-slate-950 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]"
            : "bg-primary",
        )}
      >
        <Blocks className="size-[17px]" strokeWidth={2.25} />
      </span>
      {showName ? (
        <span className="text-[15px] font-semibold tracking-[-0.02em]">
          Basecraft
        </span>
      ) : null}
    </span>
  )
}
