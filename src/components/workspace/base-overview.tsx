"use client"

import {
  ArrowRight,
  FileText,
  Loader2,
  Plus,
  Table2,
  Trash2,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { WorkspaceHeader } from "@/components/workspace/workspace-header"

export interface BaseOverviewTable {
  id: string
  name: string
  description: string
  fieldCount: number
  viewCount: number
  recordCount: number
}

export interface BaseOverviewForm {
  id: string
  name: string
  slug: string
  status: string
  tableId: string
}

export function BaseOverview({
  base,
  counts,
  forms,
  tables,
}: {
  base: { id: string; name: string; description: string; color: string }
  counts: { tables: number; views: number; records: number; forms: number }
  forms: BaseOverviewForm[]
  tables: BaseOverviewTable[]
}) {
  const router = useRouter()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<BaseOverviewTable>()

  async function createTable() {
    const trimmed = name.trim()
    if (!trimmed) return
    setCreating(true)
    try {
      const response = await fetch("/api/tables", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseId: base.id, name: trimmed }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { table?: { id: string }; message?: string }
        | null
      if (!response.ok || !payload?.table) {
        throw new Error(payload?.message ?? "Could not create this table.")
      }
      toast.success(`${trimmed} created`)
      router.push(`/bases/${base.id}/tables/${payload.table.id}`)
      router.refresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create this table.",
      )
    } finally {
      setCreating(false)
    }
  }

  async function deleteTable(table: BaseOverviewTable) {
    try {
      const response = await fetch(`/api/tables/${table.id}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { message?: string }
          | null
        throw new Error(payload?.message ?? "Could not delete this table.")
      }
      toast.success(`${table.name} deleted`)
      setPendingDelete(undefined)
      router.refresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete this table.",
      )
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <WorkspaceHeader
        actions={
          <Button onClick={() => setCreateOpen(true)} size="sm">
            <Plus className="size-4" />
            <span className="hidden sm:inline">New table</span>
          </Button>
        }
        baseId={base.id}
        baseName={base.name}
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {base.name}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {base.description || "No description yet."}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge variant="secondary">{counts.tables} tables</Badge>
              <Badge variant="secondary">{counts.views} views</Badge>
              <Badge variant="secondary">{counts.records} records</Badge>
              <Badge variant="secondary">{counts.forms} forms</Badge>
            </div>
          </div>
          <Button
            className="gap-1.5"
            nativeButton={false}
            render={<Link href={`/bases/${base.id}/forms`} />}
            variant="outline"
          >
            <FileText className="size-4" />
            Forms
          </Button>
        </div>

        <section className="mt-8" aria-labelledby="tables-heading">
          <h2 className="text-sm font-semibold" id="tables-heading">
            Tables
          </h2>
          {tables.length ? (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {tables.map((table) => (
                <li key={table.id}>
                  <Card className="h-full">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="min-w-0">
                          <Link
                            className="inline-flex items-center gap-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            href={`/bases/${base.id}/tables/${table.id}`}
                          >
                            <Table2 className="size-4 text-muted-foreground" />
                            <span className="truncate">{table.name}</span>
                          </Link>
                        </CardTitle>
                        <Button
                          aria-label={`Delete ${table.name}`}
                          onClick={() => setPendingDelete(table)}
                          size="icon-xs"
                          variant="ghost"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                      <CardDescription className="line-clamp-2">
                        {table.description || "No description yet."}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        {table.fieldCount} columns · {table.viewCount} views ·{" "}
                        {table.recordCount} records
                      </p>
                      <Link
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        href={`/bases/${base.id}/tables/${table.id}`}
                      >
                        Open
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          ) : (
            <Card className="mt-3">
              <CardContent className="grid place-items-center gap-2 py-12 text-center">
                <Table2 className="size-8 text-muted-foreground" />
                <p className="font-medium">No tables yet</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  A table starts with a required Name column and a grid view.
                </p>
                <Button className="mt-2" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                  New table
                </Button>
              </CardContent>
            </Card>
          )}
        </section>

        <section className="mt-10" aria-labelledby="forms-heading">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" id="forms-heading">
              Forms
            </h2>
            <Link
              className="text-xs font-medium text-primary hover:underline"
              href={`/bases/${base.id}/forms`}
            >
              Manage forms
            </Link>
          </div>
          {forms.length ? (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {forms.map((form) => (
                <li key={form.id}>
                  <Link
                    className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition hover:border-foreground/20"
                    href={`/bases/${base.id}/forms/${form.id}`}
                  >
                    <FileText className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{form.name}</span>
                    <Badge
                      variant={
                        form.status === "published" ? "default" : "secondary"
                      }
                    >
                      {form.status}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              No forms yet. Create one to collect records from anyone.
            </p>
          )}
        </section>
      </main>

      <Dialog onOpenChange={setCreateOpen} open={createOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New table</DialogTitle>
            <DialogDescription>
              Tables start with a required Name column you can rename later.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="table-name">Table name</Label>
            <Input
              autoFocus
              id="table-name"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createTable()
              }}
              placeholder="Pipeline"
              value={name}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={creating || !name.trim()}
              onClick={() => void createTable()}
            >
              {creating ? <Loader2 className="size-4 animate-spin" /> : null}
              Create table
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setPendingDelete(undefined)
        }}
        open={Boolean(pendingDelete)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pendingDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The table is archived with its records and can be restored from the
              database if this was a mistake.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) void deleteTable(pendingDelete)
              }}
            >
              Delete table
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
