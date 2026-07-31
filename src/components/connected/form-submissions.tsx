"use client"

import Link from "next/link"
import {
  useConvex,
  usePaginatedQuery,
  useQuery,
} from "convex/react"
import {
  ArrowLeft,
  BarChart3,
  Download,
  ExternalLink,
  FileCheck2,
  Inbox,
} from "lucide-react"
import { useState } from "react"

import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { FormBreadcrumbs } from "@/components/connected/form-breadcrumbs"
import { OrganizationAuthGate } from "@/components/connected/organization-auth-gate"
import {
  ConnectedLoading,
  ConnectedTopBar,
} from "@/components/connected/org-states"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  createFormSubmissionsCsv,
  formSubmissionsCsvFileName,
} from "@/lib/form-submissions"
import { useUrlSelection } from "@/lib/use-url-selection"

function submittedDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value)
}

export function ConnectedFormSubmissions({
  baseId,
  formId,
}: {
  baseId: string
  formId: string
}) {
  return (
    <OrganizationAuthGate>
      {() => (
        <SubmissionsData
          baseId={baseId as Id<"bases">}
          formId={formId as Id<"forms">}
        />
      )}
    </OrganizationAuthGate>
  )
}

function SubmissionsData({
  baseId,
  formId,
}: {
  baseId: Id<"bases">
  formId: Id<"forms">
}) {
  const [selectedResponse, setSelectedResponse] =
    useUrlSelection("response")
  const selectedSubmissionId = selectedResponse
    ? (selectedResponse as Id<"formSubmissions">)
    : null
  const [exporting, setExporting] = useState(false)
  const [exportNotice, setExportNotice] = useState<
    "truncated" | "failed"
  >()
  const convex = useConvex()
  const workspace = useQuery(api.forms.getSubmissionWorkspace, {
    formId,
  })
  const submissions = usePaginatedQuery(
    api.forms.listSubmissions,
    { formId },
    { initialNumItems: 25 },
  )
  const detail = useQuery(
    api.forms.getSubmission,
    selectedSubmissionId
      ? { formId, submissionId: selectedSubmissionId }
      : "skip",
  )

  if (
    workspace === undefined ||
    submissions.status === "LoadingFirstPage"
  ) {
    return <ConnectedLoading label="Loading form responses…" />
  }

  async function downloadResponses() {
    if (exporting || submissions.results.length === 0) return
    setExporting(true)
    setExportNotice(undefined)
    try {
      const exportData = await convex.query(
        api.forms.exportSubmissions,
        { formId },
      )
      const url = URL.createObjectURL(
        new Blob([createFormSubmissionsCsv(exportData)], {
          type: "text/csv;charset=utf-8",
        }),
      )
      const link = document.createElement("a")
      link.href = url
      link.download = formSubmissionsCsvFileName(exportData)
      link.click()
      URL.revokeObjectURL(url)
      if (exportData.truncated) setExportNotice("truncated")
    } catch {
      setExportNotice("failed")
    } finally {
      setExporting(false)
    }
  }

  return (
    <main className="workspace-shell-offset min-h-dvh bg-muted/20">
      <ConnectedTopBar>
        <Button
          render={<Link href={`/bases/${baseId}/forms/${formId}`} />}
          size="sm"
          variant="ghost"
        >
          <ArrowLeft />
          Edit form
        </Button>
      </ConnectedTopBar>

      <div className="mx-auto max-w-6xl px-5 py-8 md:px-8 md:py-12">
        <FormBreadcrumbs
          className="mb-6"
          items={[
            {
              href: `/bases/${baseId}/forms`,
              label: "Forms",
            },
            {
              href: `/bases/${baseId}/forms/${formId}`,
              label: workspace.formName,
            },
            { label: "Responses" },
          ]}
        />
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge className="rounded-full" variant="outline">
                Responses
              </Badge>
              <span className="text-sm text-muted-foreground">
                {workspace.tableName}
              </span>
            </div>
            <h1 className="truncate text-3xl font-semibold tracking-tight">
              {workspace.formName}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Open a response to review its named answers or continue into the
              record it created.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              render={
                <Link
                  href={`/bases/${baseId}/forms/${formId}/analytics`}
                />
              }
              variant="outline"
            >
              <BarChart3 />
              Analytics
            </Button>
            <Button
              disabled={exporting || submissions.results.length === 0}
              onClick={() => void downloadResponses()}
              variant="outline"
            >
              <Download />
              {exporting ? "Preparing download…" : "Download responses"}
            </Button>
          </div>
        </div>

        {exportNotice ? (
          <p className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
            {exportNotice === "truncated"
              ? "This download includes the latest 250 responses."
              : "The response download could not be prepared. Check your connection and try again."}
          </p>
        ) : null}

        <Card className="mt-8 overflow-hidden">
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Recent responses</CardTitle>
                <CardDescription>
                  New submissions appear here automatically.
                </CardDescription>
              </div>
              {submissions.results.length > 0 ? (
                <Badge variant="secondary">
                  {submissions.results.length}
                  {submissions.status === "Exhausted" ? "" : "+"} shown
                </Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {submissions.results.length === 0 ? (
              <div className="grid min-h-72 place-items-center px-6 py-12 text-center">
                <div>
                  <span className="mx-auto mb-4 grid size-11 place-items-center rounded-2xl bg-muted">
                    <Inbox className="size-5 text-muted-foreground" />
                  </span>
                  <h2 className="font-medium">No responses yet</h2>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Share the live form. Its first response will appear here.
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y">
                {submissions.results.map((submission) => (
                  <button
                    className="flex w-full items-center gap-4 px-5 py-4 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60"
                    key={submission.submissionId}
                    onClick={() =>
                      setSelectedResponse(submission.submissionId)
                    }
                    type="button"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                      <FileCheck2 className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {submission.responseLabel}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {submittedDate(submission.submittedAt)}
                      </span>
                    </span>
                    <span className="hidden items-center gap-2 sm:flex">
                      <Badge variant="outline">
                        Live form version {submission.version}
                      </Badge>
                      {submission.recordStatus === "deleted" ? (
                        <Badge variant="secondary">Record archived</Badge>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {submissions.status === "CanLoadMore" ||
        submissions.status === "LoadingMore" ? (
          <div className="mt-5 flex justify-center">
            <Button
              disabled={submissions.status === "LoadingMore"}
              onClick={() => submissions.loadMore(25)}
              variant="outline"
            >
              {submissions.status === "LoadingMore"
                ? "Loading more…"
                : "Load more responses"}
            </Button>
          </div>
        ) : null}
      </div>

      {selectedSubmissionId ? (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open) setSelectedResponse(null)
          }}
        >
          <SheetContent className="w-full overflow-hidden sm:max-w-xl">
          <SheetHeader className="border-b pr-12">
            <SheetTitle>
              {detail?.responseLabel ?? "Response details"}
            </SheetTitle>
            <SheetDescription>
              {detail
                ? `Submitted ${submittedDate(detail.submittedAt)} using live form version ${detail.version}.`
                : "Loading the submitted answers…"}
            </SheetDescription>
          </SheetHeader>

          {detail ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-5 p-5">
                {detail.answers.map((answer, index) => (
                  <div
                    className="grid gap-1.5 border-b pb-5 last:border-0"
                    key={`${answer.question}-${index}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{answer.question}</p>
                      {answer.automatic ? (
                        <Badge variant="secondary">Automatic value</Badge>
                      ) : null}
                    </div>
                    <p
                      className={
                        answer.hasAnswer
                          ? "whitespace-pre-wrap text-sm leading-6"
                          : "text-sm italic text-muted-foreground"
                      }
                    >
                      {answer.displayValue}
                    </p>
                  </div>
                ))}
              </div>
              <div className="sticky bottom-0 border-t bg-background p-4">
                {detail.recordStatus === "active" ? (
                  <Link
                    className={buttonVariants({
                      className: "w-full",
                    })}
                    href={`/bases/${detail.baseId}/tables/${detail.tableId}?record=${detail.recordId}`}
                  >
                    Open record in {detail.tableName}
                    <ExternalLink />
                  </Link>
                ) : (
                  <Button className="w-full" disabled>
                    Created record is archived
                  </Button>
                )}
              </div>
            </div>
          ) : null}
          </SheetContent>
        </Sheet>
      ) : null}
    </main>
  )
}
