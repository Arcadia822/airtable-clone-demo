"use client"

import { FileText, Sparkles } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { BrandMark } from "@/components/brand-mark"
import { Button } from "@/components/ui/button"
import {
  GlobalSearchButton,
  GlobalSearchDialog,
} from "@/components/workspace/global-search"
import { cn } from "@/lib/utils"

export function WorkspaceHeader({
  actions,
  assistantOpen = false,
  baseId,
  baseName,
  className,
  onOpenAssistant,
  tableName,
}: {
  actions?: React.ReactNode
  assistantOpen?: boolean
  baseId?: string
  baseName?: string
  className?: string
  onOpenAssistant?: () => void
  tableName?: string
}) {
  const [searchOpen, setSearchOpen] = useState(false)

  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-2 backdrop-blur sm:px-4",
        className,
      )}
    >
      <Link
        aria-label="All bases"
        className="flex shrink-0 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href="/bases"
      >
        <BrandMark showName={false} />
      </Link>

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1.5 text-sm">
          <li className="min-w-0">
            {baseId && baseName ? (
              <Link
                className="block truncate rounded px-1 py-0.5 text-muted-foreground transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                href={`/bases/${baseId}`}
              >
                {baseName}
              </Link>
            ) : (
              <span className="block truncate px-1 py-0.5 text-muted-foreground">
                Bases
              </span>
            )}
          </li>
          {tableName ? (
            <>
              <li aria-hidden="true" className="text-muted-foreground/60">
                /
              </li>
              <li className="min-w-0">
                <span className="block truncate px-1 py-0.5 font-medium">
                  {tableName}
                </span>
              </li>
            </>
          ) : null}
        </ol>
      </nav>

      <div className="flex shrink-0 items-center gap-1.5">
        {actions}
        {baseId ? (
          <Button
            aria-label="Forms for this base"
            className="hidden sm:inline-flex"
            nativeButton={false}
            render={<Link href={`/bases/${baseId}/forms`} />}
            size="sm"
            variant="ghost"
          >
            <FileText className="size-4" />
            Forms
          </Button>
        ) : null}
        <GlobalSearchButton onClick={() => setSearchOpen(true)} />
        {onOpenAssistant ? (
          <Button
            aria-expanded={assistantOpen}
            aria-label="Open the AI assistant"
            className="gap-1.5"
            onClick={onOpenAssistant}
            size="sm"
            variant={assistantOpen ? "secondary" : "outline"}
          >
            <Sparkles className="size-4" />
            <span className="hidden sm:inline">Ask AI</span>
          </Button>
        ) : null}
      </div>

      <GlobalSearchDialog
        baseId={baseId}
        onOpenChange={setSearchOpen}
        open={searchOpen}
      />
    </header>
  )
}
