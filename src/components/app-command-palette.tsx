"use client"

import { useEffect, type ReactNode } from "react"
import { Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"

export type AppCommandAction = {
  id: string
  label: string
  description?: string
  group: string
  icon?: ReactNode
  keywords?: readonly string[]
  shortcut?: string
  run: () => void
}

export function AppCommandPalette({
  actions,
  onOpenChange,
  open,
}: {
  actions: readonly AppCommandAction[]
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key.toLocaleLowerCase() === "k" &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onOpenChange, open])

  const groups = Array.from(new Set(actions.map((action) => action.group)))

  return (
    <CommandDialog
      description="Search bases, tables, views, forms, and quick actions."
      onOpenChange={onOpenChange}
      open={open}
      title="Jump to anything"
    >
      <Command>
        <CommandInput
          aria-label="Search bases, tables, views, forms, and actions"
          autoFocus
          placeholder="Search bases, tables, views, and actions…"
        />
        <CommandList>
          <CommandEmpty>No matching destinations or actions.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup heading={group} key={group}>
              {actions
                .filter((action) => action.group === group)
                .map((action) => (
                  <CommandItem
                    key={action.id}
                    onSelect={() => {
                      onOpenChange(false)
                      action.run()
                    }}
                    value={[
                      action.label,
                      action.description,
                      ...(action.keywords ?? []),
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {action.icon}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{action.label}</span>
                      {action.description ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {action.description}
                        </span>
                      ) : null}
                    </span>
                    {action.shortcut ? (
                      <CommandShortcut>{action.shortcut}</CommandShortcut>
                    ) : null}
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

export function CommandPaletteButton({
  onClick,
}: {
  onClick: () => void
}) {
  return (
    <Button
      aria-label="Search and quick actions"
      className="min-w-40 justify-between text-muted-foreground"
      onClick={onClick}
      size="sm"
      variant="outline"
    >
      <span className="flex items-center gap-2">
        <Search />
        Search
      </span>
      <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-normal">
        ⌘K
      </kbd>
    </Button>
  )
}
