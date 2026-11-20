"use client"

import { Database, LayoutGrid, Loader2, Plus } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { BrandMark } from "@/components/brand-mark"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { WorkspaceHeader } from "@/components/workspace/workspace-header"

export interface BaseListEntry {
  id: string
  name: string
  description: string
  color: string
  tableCount: number
  recordCount: number
  tables: Array<{ id: string; name: string }>
}

export function BaseList({ bases }: { bases: BaseListEntry[] }) {
  const router = useRouter()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)

  async function createBase() {
    const trimmed = name.trim()
    if (!trimmed) return
    setCreating(true)
    try {
      const response = await fetch("/api/bases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { base?: { id: string }; table?: { id: string }; message?: string }
        | null
      if (!response.ok || !payload?.base || !payload.table) {
        throw new Error(payload?.message ?? "Could not create this base.")
      }
      setCreateOpen(false)
      setName("")
      toast.success(`${trimmed} created`, {
        description: "A starter table with a Name column is ready.",
      })
      router.push(`/bases/${payload.base.id}/tables/${payload.table.id}`)
      router.refresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create this base.",
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <WorkspaceHeader
        actions={
          <Button onClick={() => setCreateOpen(true)} size="sm">
            <Plus className="size-4" />
            <span className="hidden sm:inline">New base</span>
          </Button>
        }
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Your bases</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every base holds the tables, views, forms, and records for one
              workspace area.
            </p>
          </div>
        </div>

        {bases.length ? (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {bases.map((base) => (
              <li key={base.id}>
                <Card className="h-full transition hover:border-foreground/20">
                  <CardHeader>
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg text-white"
                        style={{ backgroundColor: base.color }}
                      >
                        <Database className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <CardTitle className="truncate">
                          <Link
                            className="rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            href={`/bases/${base.id}`}
                          >
                            {base.name}
                          </Link>
                        </CardTitle>
                        <CardDescription className="mt-1 line-clamp-2">
                          {base.description || "No description yet."}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <div className="flex flex-wrap gap-1.5">
                      {base.tables.slice(0, 3).map((table) => (
                        <Link
                          key={table.id}
                          className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
                          href={`/bases/${base.id}/tables/${table.id}`}
                        >
                          {table.name}
                        </Link>
                      ))}
                      {base.tables.length > 3 ? (
                        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                          +{base.tables.length - 3}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">{base.tableCount} tables</Badge>
                      <Badge variant="secondary">{base.recordCount} records</Badge>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <Card className="mt-6">
            <CardContent className="grid place-items-center gap-2 py-16 text-center">
              <LayoutGrid className="size-8 text-muted-foreground" />
              <p className="font-medium">Create your first base</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Bases hold your tables, views, and public forms. Start with one
                table and add columns as you go.
              </p>
              <Button className="mt-2" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                New base
              </Button>
            </CardContent>
          </Card>
        )}
      </main>

      <footer className="border-t px-4 py-4 sm:px-6">
        <p className="mx-auto flex max-w-5xl items-center gap-2 text-xs text-muted-foreground">
          <BrandMark showName={false} className="scale-90" />
          Data lives in your own database — PGlite locally, Postgres in
          production.
        </p>
      </footer>

      <Dialog onOpenChange={setCreateOpen} open={createOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New base</DialogTitle>
            <DialogDescription>
              A base starts with one table and a required Name column.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="base-name">Base name</Label>
            <Input
              autoFocus
              id="base-name"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createBase()
              }}
              placeholder="Customer success"
              value={name}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={creating || !name.trim()}
              onClick={() => void createBase()}
            >
              {creating ? <Loader2 className="size-4 animate-spin" /> : null}
              Create base
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
