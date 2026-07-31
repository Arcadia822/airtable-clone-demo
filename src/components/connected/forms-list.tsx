"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery } from "convex/react"
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  CircleDashed,
  Copy,
  EyeOff,
  FileText,
  Link2,
  LoaderCircle,
  Pencil,
  Plus,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { useLiveConnectionHealth } from "@/components/connected/connection-status"
import { FormBreadcrumbs } from "@/components/connected/form-breadcrumbs"
import {
  FormWriteStatus,
  formWriteRetryGuidance,
} from "@/components/connected/form-write-status"
import { ConnectedTopBar } from "@/components/connected/org-states"
import { OrganizationAuthGate } from "@/components/connected/organization-auth-gate"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
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
import { SearchableSelect } from "@/components/searchable-select"
import { useUrlAction } from "@/lib/use-url-action"

type FormListItem = Doc<"forms"> & {
  stats: {
    views: number
    submissions: number
    conversionRate: number
  }
}

export function ConnectedFormsList({ baseId }: { baseId: string }) {
  return (
    <OrganizationAuthGate>
      {({ auth }) => (
        <FormsListData
          baseId={baseId as Id<"bases">}
          canManage={auth.orgRole?.replace(/^org:/, "") === "admin"}
        />
      )}
    </OrganizationAuthGate>
  )
}

function FormsListData({
  baseId,
  canManage,
}: {
  baseId: Id<"bases">
  canManage: boolean
}) {
  const router = useRouter()
  const base = useQuery(api.bases.get, { baseId })
  const tables = useQuery(api.tables.list, { baseId })
  const forms = useQuery(api.forms.list, { baseId })
  const archivedForms = useQuery(
    api.forms.listArchived,
    canManage ? { baseId } : "skip",
  )
  const createForm = useMutation(api.forms.create)
  const duplicateForm = useMutation(api.forms.duplicate)
  const archiveForm = useMutation(api.forms.archive)
  const restoreForm = useMutation(api.forms.restore)
  const [dialogOpen, setDialogOpen] = useUrlAction("new-form")
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [duplicateTarget, setDuplicateTarget] =
    useState<Doc<"forms"> | null>(null)
  const [archiveTarget, setArchiveTarget] =
    useState<Doc<"forms"> | null>(null)
  const [name, setName] = useState("")
  const [tableId, setTableId] = useState("")
  const [saving, setSaving] = useState(false)
  const [workingFormId, setWorkingFormId] =
    useState<Id<"forms"> | null>(null)
  const connectionHealth = useLiveConnectionHealth(
    Number(saving) + Number(workingFormId !== null),
  )

  function canStartFormWrite(action: string) {
    if (connectionHealth.canStartWrite) return true
    toast.error(`${action} is paused`, {
      description: formWriteRetryGuidance(
        connectionHealth,
        Boolean(name.trim() || tableId),
      ),
    })
    return false
  }

  async function submit() {
    const normalizedName = name.trim()
    if (!normalizedName || !tableId || saving) return
    if (!canStartFormWrite("Creating the form")) return
    setSaving(true)
    try {
      const formId = await createForm({
        tableId: tableId as Id<"tables">,
        name: normalizedName,
        afterRank: forms?.at(-1)?.rank,
      })
      toast.success(`${normalizedName} form created`, {
        description: "Its questions are ready for you to customize.",
      })
      setDialogOpen(false)
      setName("")
      setTableId("")
      router.push(`/bases/${baseId}/forms/${formId}`)
    } catch (error) {
      toast.error("Could not create the form", {
        description: errorMessage(error),
      })
    } finally {
      setSaving(false)
    }
  }

  async function duplicateSelectedForm() {
    if (!duplicateTarget || workingFormId) return
    if (!canStartFormWrite("Duplicating the form")) return
    setWorkingFormId(duplicateTarget._id)
    try {
      const duplicated = await duplicateForm({
        formId: duplicateTarget._id,
        afterRank: forms?.at(-1)?.rank,
      })
      toast.success("Draft copy created", {
        description: `${duplicated.name} is ready to edit. Responses were not copied.`,
      })
      setDuplicateTarget(null)
      router.push(`/bases/${baseId}/forms/${duplicated.formId}`)
    } catch (error) {
      toast.error("Could not duplicate the form", {
        description: errorMessage(error),
      })
    } finally {
      setWorkingFormId(null)
    }
  }

  async function archiveSelectedForm() {
    if (!archiveTarget || workingFormId) return
    if (!canStartFormWrite("Archiving the form")) return
    setWorkingFormId(archiveTarget._id)
    try {
      await archiveForm({ formId: archiveTarget._id })
      toast.success(`${archiveTarget.name} archived`, {
        description:
          "Its responses and history are safe. You can restore it at any time.",
      })
      setArchiveTarget(null)
    } catch (error) {
      toast.error("Could not archive the form", {
        description: errorMessage(error),
      })
    } finally {
      setWorkingFormId(null)
    }
  }

  async function restoreArchivedForm(form: {
    formId: Id<"forms">
    name: string
  }) {
    if (workingFormId) return
    if (!canStartFormWrite("Restoring the form")) return
    setWorkingFormId(form.formId)
    try {
      const restored = await restoreForm({ formId: form.formId })
      toast.success(`${restored.name} restored`, {
        description:
          restored.status === "draft"
            ? "It is back as an unpublished draft."
            : "It is back as a closed form. Publish it when you are ready.",
      })
    } catch (error) {
      toast.error("Could not restore the form", {
        description: errorMessage(error),
      })
    } finally {
      setWorkingFormId(null)
    }
  }

  async function copyPublicLink(form: FormListItem) {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/f/${form.slug}`,
      )
      toast.success(`${form.name} link copied`, {
        description: "The public form link is ready to share.",
      })
    } catch {
      toast.error("Could not copy the public link", {
        description: "Open the form editor and copy it from Share instead.",
      })
    }
  }

  const loading =
    base === undefined || tables === undefined || forms === undefined

  return (
    <main className="workspace-shell-offset min-h-dvh bg-muted/20">
      <ConnectedTopBar>
        <Button
          render={<Link href={`/bases/${baseId}`} />}
          size="sm"
          variant="ghost"
        >
          <ArrowLeft />
          Back to base
        </Button>
      </ConnectedTopBar>

      <div className="mx-auto max-w-7xl px-5 py-6 md:px-8 md:py-8">
        <FormBreadcrumbs
          className="mb-6"
          items={[
            { href: "/dashboard", label: "Bases" },
            {
              href: `/bases/${baseId}`,
              label: base?.name ?? "Base",
            },
            { label: "Forms" },
          ]}
        />
        <div className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.025em]">
              Public forms
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Collect responses with a shareable form and choose exactly where
              each answer is saved.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              render={<Link href={`/bases/${baseId}/forms/analytics`} />}
              variant="outline"
            >
              <BarChart3 />
              Form analytics
            </Button>
            {canManage ? (
              <Button
                onClick={() => setArchivedOpen(true)}
                variant="outline"
              >
                <Archive />
                Archived forms
                {archivedForms?.length ? (
                  <Badge className="ml-1 rounded-full" variant="secondary">
                    {archivedForms.length}
                  </Badge>
                ) : null}
              </Button>
            ) : null}
            <Button
              disabled={!canManage || !tables?.length}
              onClick={() => setDialogOpen(true)}
            >
              <Plus />
              Create form
            </Button>
          </div>
        </div>
        <FormWriteStatus
          className="mt-4"
          hasUnsavedDraft={Boolean(name.trim() || tableId)}
          health={connectionHealth}
        />

        {loading ? (
          <div className="mt-6 overflow-hidden rounded-lg border bg-background">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                className="h-16 animate-pulse border-b bg-muted/35 last:border-b-0"
                key={index}
              />
            ))}
          </div>
        ) : forms.length ? (
          <div className="mt-6 overflow-hidden rounded-lg border bg-background">
            <div className="hidden h-9 grid-cols-[minmax(14rem,1.7fr)_minmax(8rem,1fr)_6.5rem_6rem_6.5rem_auto] items-center gap-3 border-b bg-muted/45 px-4 text-[11px] font-medium text-muted-foreground md:grid">
              <span>Form</span>
              <span>Response table</span>
              <span>Status</span>
              <span className="text-right">Responses</span>
              <span className="text-right">Conversion</span>
              <span />
            </div>
            <div className="divide-y">
              {forms.map((form: FormListItem) => {
                const table = tables.find(
                  (candidate: Doc<"tables">) =>
                    candidate._id === form.tableId,
                )
                return (
                  <div
                    aria-label={`${form.name} activity`}
                    className="grid min-h-16 items-center gap-3 px-4 py-3 md:grid-cols-[minmax(14rem,1.7fr)_minmax(8rem,1fr)_6.5rem_6rem_6.5rem_auto]"
                    key={form._id}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="grid size-7 shrink-0 place-items-center rounded-md border bg-muted/35 text-muted-foreground">
                        <FileText className="size-3.5" />
                      </span>
                      <span className="min-w-0">
                        <Link
                          className="block truncate text-sm font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                          href={`/bases/${baseId}/forms/${form._id}`}
                        >
                          {form.name}
                        </Link>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {form.title} · Edited{" "}
                          {new Date(form.updatedAt).toLocaleDateString()}
                        </span>
                      </span>
                    </div>
                    <span className="truncate text-xs text-muted-foreground">
                      {table?.name ?? "Unavailable table"}
                    </span>
                    <FormStatus status={form.status} />
                    <span className="text-xs font-medium tabular-nums md:text-right">
                      {form.stats.submissions.toLocaleString()}
                      <span className="ml-1 text-muted-foreground md:hidden">
                        responses
                      </span>
                    </span>
                    <span className="text-xs font-medium tabular-nums md:text-right">
                      {form.stats.views > 0
                        ? `${(form.stats.conversionRate * 100).toFixed(1)}%`
                        : "—"}
                      <span className="ml-1 text-muted-foreground md:hidden">
                        conversion
                      </span>
                    </span>
                    <div className="flex flex-wrap justify-start gap-1 md:justify-end">
                      <Button
                        render={
                          <Link href={`/bases/${baseId}/forms/${form._id}`} />
                        }
                        size="sm"
                        variant="outline"
                      >
                        <Pencil />
                        {canManage ? "Edit" : "View"}
                      </Button>
                      <Button
                        aria-label={`View analytics for ${form.name}`}
                        render={
                          <Link
                            href={`/bases/${baseId}/forms/${form._id}/analytics`}
                          />
                        }
                        size="icon-sm"
                        title="Analytics"
                        variant="ghost"
                      >
                        <BarChart3 />
                      </Button>
                      {form.status === "published" ? (
                        <Button
                          aria-label={`Copy public link for ${form.name}`}
                          onClick={() => void copyPublicLink(form)}
                          size="icon-sm"
                          title="Copy public link"
                          variant="ghost"
                        >
                          <Link2 />
                        </Button>
                      ) : null}
                      {canManage ? (
                        <>
                          <Button
                            aria-label={`Duplicate ${form.name}`}
                            disabled={workingFormId !== null}
                            onClick={() => setDuplicateTarget(form)}
                            size="icon-sm"
                            title="Duplicate"
                            variant="ghost"
                          >
                            <Copy />
                          </Button>
                          <Button
                            aria-label={`Archive ${form.name}`}
                            disabled={workingFormId !== null}
                            onClick={() => setArchiveTarget(form)}
                            size="icon-sm"
                            title="Archive"
                            variant="ghost"
                          >
                            <Archive />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <Card className="mt-6 border-dashed">
            <CardContent className="flex flex-col items-center px-6 py-16 text-center">
              <div className="grid size-10 place-items-center rounded-lg border bg-muted/35 text-muted-foreground">
                <FileText className="size-4" />
              </div>
              <h2 className="mt-5 text-lg font-semibold">No forms yet</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                Create a table first, then make a shareable form that saves
                answers straight into its columns.
              </p>
              <Button
                className="mt-6"
                disabled={!canManage || !tables.length}
                onClick={() => setDialogOpen(true)}
              >
                <Plus />
                Create first form
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a public form</DialogTitle>
            <DialogDescription>
              Choose where responses should be saved. You can customize the
              questions before sharing the form.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="connected-form-name">Form name</Label>
              <Input
                autoFocus
                id="connected-form-name"
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Launch feedback"
                value={name}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="connected-form-table">Save responses in</Label>
              <SearchableSelect
                id="connected-form-table"
                onValueChange={setTableId}
                options={(tables ?? []).map((table: Doc<"tables">) => ({
                  value: table._id,
                  label: table.name,
                }))}
                placeholder="Choose a table"
                searchPlaceholder="Search tables…"
                value={tableId}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setDialogOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={
                !name.trim() ||
                !tableId ||
                saving ||
                !connectionHealth.canStartWrite
              }
              onClick={() => void submit()}
            >
              {saving ? "Creating…" : "Create form"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={duplicateTarget !== null}
        onOpenChange={(open) => {
          if (!open && !workingFormId) setDuplicateTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Duplicate {duplicateTarget ? `“${duplicateTarget.name}”` : "form"}?
            </DialogTitle>
            <DialogDescription className="leading-6">
              This creates a new, unpublished draft with the same questions,
              design, and display rules. Responses and response history are not
              copied.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={workingFormId !== null}
              onClick={() => setDuplicateTarget(null)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={
                workingFormId !== null ||
                !connectionHealth.canStartWrite
              }
              onClick={() => void duplicateSelectedForm()}
            >
              {workingFormId ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Copy />
              )}
              {workingFormId ? "Creating draft…" : "Create draft copy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open && !workingFormId) setArchiveTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Archive {archiveTarget ? `“${archiveTarget.name}”` : "form"}?
            </DialogTitle>
            <DialogDescription className="leading-6">
              Its public link will stop accepting responses. Existing
              responses, analytics, and version history are kept, and you can
              restore the form later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={workingFormId !== null}
              onClick={() => setArchiveTarget(null)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={
                workingFormId !== null ||
                !connectionHealth.canStartWrite
              }
              onClick={() => void archiveSelectedForm()}
            >
              {workingFormId ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Archive />
              )}
              {workingFormId ? "Archiving…" : "Archive form"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={archivedOpen} onOpenChange={setArchivedOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Archived forms</DialogTitle>
            <DialogDescription className="leading-6">
              Archived links no longer accept responses. Questions, responses,
              analytics, and history stay safe until you restore the form.
            </DialogDescription>
          </DialogHeader>
          {archivedForms === undefined ? (
            <div
              aria-label="Loading archived forms"
              className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"
            >
              <LoaderCircle className="size-4 animate-spin" />
              Loading archived forms…
            </div>
          ) : archivedForms.length ? (
            <div className="grid max-h-[min(28rem,60dvh)] gap-2 overflow-y-auto pr-1">
              {archivedForms.map((form) => (
                <div
                  className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between"
                  key={form.formId}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {form.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {form.tableName} · Archived{" "}
                      {new Date(form.archivedAt).toLocaleDateString()}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Restores as {form.willRestoreAs.toLowerCase()}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      aria-label={`View ${form.name} analytics`}
                      onClick={() => setArchivedOpen(false)}
                      render={
                        <Link
                          href={`/bases/${baseId}/forms/${form.formId}/analytics`}
                        />
                      }
                      size="sm"
                      variant="ghost"
                    >
                      <BarChart3 />
                      Analytics
                    </Button>
                    <Button
                      aria-label={`Restore ${form.name}`}
                      disabled={
                        workingFormId !== null ||
                        !connectionHealth.canStartWrite
                      }
                      onClick={() => void restoreArchivedForm(form)}
                      size="sm"
                      variant="outline"
                    >
                      {workingFormId === form.formId ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <ArchiveRestore />
                      )}
                      {workingFormId === form.formId
                        ? "Restoring…"
                        : "Restore"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed px-5 py-10 text-center">
              <Archive className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">No archived forms</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Forms you archive will appear here.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setArchivedOpen(false)} variant="outline">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function FormStatus({
  status,
}: {
  status: "draft" | "published" | "closed" | "deleted"
}) {
  if (status === "published") {
    return (
      <Badge className="rounded-full bg-emerald-500/10 text-emerald-700" variant="outline">
        <CheckCircle2 className="size-3" />
        Published
      </Badge>
    )
  }
  if (status === "closed") {
    return (
      <Badge className="rounded-full" variant="secondary">
        <EyeOff className="size-3" />
        Closed
      </Badge>
    )
  }
  return (
    <Badge className="rounded-full" variant="outline">
      <CircleDashed className="size-3" />
      Not published
    </Badge>
  )
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  if (/UNAUTHENTICATED/i.test(message)) {
    return "Your session has expired. Refresh the page and sign in again."
  }
  if (/ORG_ADMIN_REQUIRED|FORBIDDEN/i.test(message)) {
    return "Ask an organization admin to create this form."
  }
  if (/LIMIT|QUOTA/i.test(message)) {
    return "Your organization has reached its current plan limit."
  }
  return "Please try again. If this continues, refresh the page."
}
