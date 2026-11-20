"use client"

import {
  Archive,
  BarChart3,
  Check,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  X,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import {
  AssistantAnalysisText,
  AssistantChartView,
  AssistantCitationLink,
} from "@/components/assistant/analysis-artifact"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  useFactoryAi,
  type AssistantChatMessage,
  type AssistantProposalState,
  type MutationResult,
  type SavedAssistantReport,
} from "@/hooks/use-factory-ai"
import type { AssistantPageContext } from "@/lib/eve/page-context"
import { cn } from "@/lib/utils"

export type { AssistantPageContext } from "@/lib/eve/page-context"

export type AssistantPanelProps = {
  className?: string
  context?: AssistantPageContext
  title?: string
  onDataMutated?: (result?: MutationResult) => void
}

type ChatSuggestion = { label: string; prompt: string }

export function AssistantPanel({
  className,
  context,
  title = "Workspace analyst",
  onDataMutated,
}: AssistantPanelProps) {
  const ai = useFactoryAi({ context, onDataMutated })
  const [draft, setDraft] = useState("")
  const [openReportId, setOpenReportId] = useState<string | null>(null)
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null)
  const [savingMessageId, setSavingMessageId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const suggestions = useMemo(() => buildSuggestions(context), [context])
  const scopeLabel = useMemo(() => describeScope(context), [context])
  const pendingProposals = ai.proposals.filter(
    (proposal) => proposal.status !== "denied",
  )
  const openReport =
    ai.reports.find((report) => report.id === openReportId) ?? null

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [ai.messages, ai.isStreaming])

  const submit = useCallback(() => {
    const text = draft.trim()
    if (!text || ai.isStreaming) return
    setDraft("")
    void ai.sendMessage(text)
  }, [ai, draft])

  const saveMessage = useCallback(
    async (message: AssistantChatMessage) => {
      setSavingMessageId(message.id)
      try {
        await ai.saveReport({
          chart: message.chart ?? null,
          citations: message.citations ?? [],
          content: message.content,
          name: defaultReportName(context),
          scopeLabel,
        })
        toast.success("Analysis saved to reports")
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "That analysis could not be saved.",
        )
      } finally {
        setSavingMessageId(null)
      }
    },
    [ai, context, scopeLabel],
  )

  const archiveReport = useCallback(
    async (reportId: string) => {
      if (confirmArchiveId !== reportId) {
        setConfirmArchiveId(reportId)
        return
      }
      setConfirmArchiveId(null)
      try {
        await ai.deleteReport(reportId)
        setOpenReportId((current) => (current === reportId ? null : current))
        toast.success("Report archived")
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "That report could not be archived.",
        )
      }
    },
    [ai, confirmArchiveId],
  )

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            <p className="truncate text-xs text-muted-foreground">{scopeLabel}</p>
          </div>
        </div>
        {ai.isStreaming ? (
          <Button variant="ghost" size="sm" onClick={ai.cancel}>
            <Square aria-hidden />
            Stop
          </Button>
        ) : null}
      </header>

      <Tabs defaultValue="chat" className="min-h-0 flex-1 gap-0">
        <div className="border-b px-3 py-2">
          <TabsList className="w-full">
            <TabsTrigger value="chat">
              <MessageSquareText aria-hidden />
              Chat
            </TabsTrigger>
            <TabsTrigger value="reports">
              <Archive aria-hidden />
              Saved reports
              {ai.reports.length > 0 ? (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[0.65rem]">
                  {ai.reports.length}
                </Badge>
              ) : null}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="chat" className="flex min-h-0 flex-col">
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-4 px-4 py-4">
              {ai.messages.length === 0 ? (
                <EmptyConversation
                  suggestions={suggestions}
                  onPick={(prompt) => void ai.sendMessage(prompt)}
                />
              ) : (
                ai.messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isThinking={
                      ai.isStreaming &&
                      message.role === "assistant" &&
                      message.status === "streaming" &&
                      message.content.trim().length === 0
                    }
                    saving={savingMessageId === message.id}
                    onSave={() => void saveMessage(message)}
                  />
                ))
              )}

              {pendingProposals.length > 0 ? (
                <section className="space-y-3" aria-label="Changes awaiting approval">
                  <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    <ShieldCheck className="size-3.5" aria-hidden />
                    Changes awaiting approval
                  </h3>
                  {pendingProposals.map((proposal) => (
                    <ApprovalCard
                      key={proposal.id}
                      proposal={proposal}
                      onApprove={() => void ai.approveProposal(proposal.id)}
                      onDeny={() => ai.denyProposal(proposal.id)}
                    />
                  ))}
                </section>
              ) : null}

              {ai.error ? (
                <div
                  role="alert"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
                >
                  <span className="text-destructive">{ai.error.message}</span>
                  {ai.error.retryable ? (
                    <Button variant="outline" size="sm" onClick={ai.retry}>
                      <RefreshCw aria-hidden />
                      Retry
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <div ref={bottomRef} />
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="reports" className="min-h-0">
          <ScrollArea className="h-full">
            <div className="space-y-3 px-4 py-4">
              {ai.reports.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                  Saved analyses and charts will appear here.
                </p>
              ) : (
                ai.reports.map((report) => (
                  <ReportRow
                    key={report.id}
                    report={report}
                    confirmingArchive={confirmArchiveId === report.id}
                    onOpen={() => {
                      setConfirmArchiveId(null)
                      setOpenReportId(report.id)
                    }}
                    onArchive={() => void archiveReport(report.id)}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <div className="border-t px-3 py-3">
        <Composer
          draft={draft}
          isStreaming={ai.isStreaming}
          onChange={setDraft}
          onSubmit={submit}
        />
      </div>

      <Dialog
        open={openReport !== null}
        onOpenChange={(open) => {
          if (!open) setOpenReportId(null)
        }}
      >
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
          {openReport ? (
            <>
              <DialogHeader>
                <DialogTitle>{openReport.name}</DialogTitle>
                <DialogDescription>
                  {openReport.scopeLabel || "Workspace analysis"} ·{" "}
                  {formatDate(openReport.createdAt)}
                </DialogDescription>
              </DialogHeader>
              <AssistantAnalysisText text={openReport.content} />
              {openReport.chart ? (
                <AssistantChartView chart={openReport.chart} />
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Composer({
  draft,
  isStreaming,
  onChange,
  onSubmit,
}: {
  draft: string
  isStreaming: boolean
  onChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      className="space-y-2"
    >
      <Textarea
        aria-label="Message the workspace analyst"
        placeholder="Ask about your data, or describe a table to build…"
        value={draft}
        rows={2}
        className="resize-none"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            onSubmit()
          }
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Enter to send · Shift+Enter for a new line
        </span>
        <Button type="submit" size="sm" disabled={!draft.trim() || isStreaming}>
          {isStreaming ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : (
            <Send aria-hidden />
          )}
          Send
        </Button>
      </div>
    </form>
  )
}

function EmptyConversation({
  suggestions,
  onPick,
}: {
  suggestions: ChatSuggestion[]
  onPick: (prompt: string) => void
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Build and analyze with plain language</h3>
        <p className="text-sm text-muted-foreground">
          Ask for a table, a summary, or a chart. Every change is previewed before
          it is applied.
        </p>
      </div>
      <div className="space-y-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.label}
            type="button"
            onClick={() => onPick(suggestion.prompt)}
            className="flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
          >
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
            <span>{suggestion.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function MessageBubble({
  message,
  isThinking,
  saving,
  onSave,
}: {
  message: AssistantChatMessage
  isThinking: boolean
  saving: boolean
  onSave: () => void
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    )
  }

  const hasArtifacts = Boolean(message.chart || message.citations?.length)

  return (
    <div className="space-y-2">
      <div className="rounded-2xl rounded-bl-sm border bg-card px-3 py-2.5 text-sm">
        {isThinking ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            Thinking…
          </span>
        ) : message.content.trim() ? (
          <AssistantAnalysisText text={message.content} />
        ) : message.status === "error" ? (
          <span className="text-destructive">
            {message.error?.message ?? "The assistant could not complete that request."}
          </span>
        ) : null}

        {message.chart ? <AssistantChartView chart={message.chart} /> : null}

        {message.citations && message.citations.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.citations.slice(0, 6).map((citation) => (
              <AssistantCitationLink
                key={`${citation.kind}:${citation.href}`}
                citation={citation}
              />
            ))}
          </div>
        ) : null}
      </div>

      {message.status === "complete" &&
      message.content.trim().length > 0 ? (
        <div className="flex items-center gap-1 pl-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={onSave}
            disabled={saving}
            aria-label="Save this analysis to reports"
          >
            <Archive aria-hidden />
            {saving ? "Saving…" : hasArtifacts ? "Save report & chart" : "Save report"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function ApprovalCard({
  proposal,
  onApprove,
  onDeny,
}: {
  proposal: AssistantProposalState
  onApprove: () => void
  onDeny: () => void
}) {
  const decided =
    proposal.status === "applied" ||
    proposal.status === "denied" ||
    proposal.status === "failed"

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <ShieldCheck className="size-4 text-primary" aria-hidden />
          {proposal.title}
        </CardTitle>
        <CardDescription>{proposal.summary}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {proposal.diff.map((row) => (
          <div
            key={`${row.label}:${row.after}`}
            className="grid grid-cols-[minmax(0,7rem)_1fr] gap-2 text-xs"
          >
            <span className="truncate text-muted-foreground">{row.label}</span>
            <span className="text-foreground">
              {row.before ? (
                <span className="mr-1.5 text-muted-foreground line-through">
                  {row.before}
                </span>
              ) : null}
              {row.after}
            </span>
          </div>
        ))}
        {proposal.warnings.map((warning) => (
          <p key={warning} className="text-xs text-amber-600 dark:text-amber-400">
            {warning}
          </p>
        ))}
        {proposal.status === "failed" && proposal.error ? (
          <p className="text-xs text-destructive">{proposal.error}</p>
        ) : null}
      </CardContent>
      <CardFooter className="justify-end gap-2">
        {proposal.status === "applied" ? (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="size-3.5" aria-hidden />
            {proposal.resultSummary ?? "Applied"}
          </span>
        ) : proposal.status === "denied" ? (
          <span className="text-xs text-muted-foreground">Denied — nothing changed</span>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={onDeny} disabled={decided}>
              <X aria-hidden />
              Deny
            </Button>
            <Button size="sm" onClick={onApprove} disabled={decided}>
              {proposal.status === "saving" ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : (
                <Check aria-hidden />
              )}
              {proposal.status === "saving" ? "Applying…" : "Approve"}
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  )
}

function ReportRow({
  report,
  confirmingArchive,
  onOpen,
  onArchive,
}: {
  report: SavedAssistantReport
  confirmingArchive: boolean
  onOpen: () => void
  onArchive: () => void
}) {
  return (
    <div className="rounded-lg border px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 text-left"
        >
          <span className="flex items-center gap-1.5 text-sm font-medium">
            {report.chart ? (
              <BarChart3 className="size-3.5 text-primary" aria-hidden />
            ) : (
              <MessageSquareText className="size-3.5 text-primary" aria-hidden />
            )}
            <span className="truncate">{report.name}</span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {report.scopeLabel || "Workspace"} · {formatDate(report.createdAt)}
          </span>
        </button>
        <Button
          variant="ghost"
          size="xs"
          onClick={onArchive}
          aria-label={
            confirmingArchive
              ? `Confirm archiving ${report.name}`
              : `Archive ${report.name}`
          }
        >
          <Archive aria-hidden />
          {confirmingArchive ? "Confirm" : "Archive"}
        </Button>
      </div>
    </div>
  )
}

function buildSuggestions(context?: AssistantPageContext): ChatSuggestion[] {
  const suggestions: ChatSuggestion[] = [
    {
      label: "帮我建一张客户跟进表（含状态、金额、序号、跟进日期）",
      prompt:
        "帮我建一张客户跟进表，包含客户名称、状态（线索、跟进中、已成交、已流失）、金额、序号和跟进日期，并加 4 行示例数据。",
    },
  ]

  if (context?.table?.id) {
    suggestions.push({
      label: "分析当前表的数据分布和关键指标",
      prompt: `分析当前表「${context.table.name ?? "当前表"}」的数据分布和关键指标。`,
    })
    suggestions.push({
      label: "按状态统计当前表的记录数并生成图表",
      prompt: "按状态统计当前表的记录数并生成图表。",
    })
    return suggestions
  }

  suggestions.push({
    label: "帮我设计一张订单表（含状态、金额、客户、下单日期）",
    prompt:
      "帮我设计一张订单表，包含订单号、客户、状态、金额和下单日期，并加 3 行示例数据。",
  })
  suggestions.push({
    label: "我的工作区里现在有哪些数据？",
    prompt: "我的工作区里现在有哪些数据？请简要说明。",
  })
  return suggestions
}

function defaultReportName(context?: AssistantPageContext): string {
  const table = context?.table?.name?.trim()
  const base = context?.base?.name?.trim()
  const scope = table || base || "Workspace"
  const date = new Date().toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })
  return `${scope} analysis · ${date}`.slice(0, 240)
}

function describeScope(context?: AssistantPageContext): string {
  if (!context) return "No page selected"
  const parts = [context.base?.name, context.table?.name, context.form?.name]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => value.trim())
  return parts.length > 0 ? parts.join(" › ") : "No page selected"
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  })
}
