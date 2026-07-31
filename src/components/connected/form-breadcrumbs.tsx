import Link from "next/link"
import { ChevronRight } from "lucide-react"

export type FormBreadcrumbItem = {
  href?: string
  label: string
}

export function FormBreadcrumbs({
  className,
  items,
}: {
  className?: string
  items: FormBreadcrumbItem[]
}) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {items.map((item, index) => {
          const current = index === items.length - 1
          return (
            <li
              className="flex min-w-0 items-center gap-1.5"
              key={`${item.href ?? "current"}:${item.label}`}
            >
              {index > 0 ? (
                <ChevronRight aria-hidden="true" className="size-3 shrink-0" />
              ) : null}
              {item.href && !current ? (
                <Link
                  className="max-w-48 truncate rounded outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  href={item.href}
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={current ? "page" : undefined}
                  className="max-w-64 truncate text-foreground"
                >
                  {item.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
