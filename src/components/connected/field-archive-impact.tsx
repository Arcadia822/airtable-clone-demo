import { LoaderCircle } from "lucide-react"

export type FieldArchiveDependency = {
  category:
    | "Draft form"
    | "Published form"
    | "Saved view"
    | "Saved analysis"
  name: string
  effect?: string
}

export type FieldArchiveImpactData = {
  columnName: string
  canArchive: boolean
  blockingReason: string | null
  dependencies: FieldArchiveDependency[]
}

export function fieldArchiveDescription(columnName: string): string {
  return `“${columnName}” will be hidden from this table. Saved values are kept. Any filters, sorting, grouping, or layouts named below pause until you restore the column.`
}

export function fieldArchiveSuccessMessage(
  columnName: string,
  dependencies: readonly FieldArchiveDependency[],
): string {
  return dependencies.some(
    (dependency) => dependency.category === "Saved view",
  )
    ? `“${columnName}” archived. Saved-view filters, sorting, grouping, and layouts using it are paused until the column is restored.`
    : `“${columnName}” archived`
}

export function FieldArchiveImpact({
  impact,
}: {
  impact: FieldArchiveImpactData | undefined
}) {
  if (!impact) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        Checking where this column is used…
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {impact.blockingReason ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {impact.blockingReason}
        </div>
      ) : null}
      {impact.dependencies.length ? (
        <div className="rounded-lg border p-3">
          <p className="text-xs font-medium">Places using this column</p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {impact.dependencies.map((dependency, index) => (
              <li
                className="grid gap-1 rounded-md py-1 sm:grid-cols-[minmax(0,1fr)_auto]"
                key={`${dependency.category}-${dependency.name}-${index}`}
              >
                <span className="truncate">{dependency.name}</span>
                <span className="shrink-0">{dependency.category}</span>
                {dependency.effect ? (
                  <span className="text-[11px] leading-4 sm:col-span-2">
                    {dependency.effect}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {impact.dependencies.some(
            (dependency) => dependency.category === "Draft form",
          ) ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Draft forms will stop asking this question.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
