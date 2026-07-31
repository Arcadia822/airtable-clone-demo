"use client";

import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import {
  Archive,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Check,
  Database,
  File,
  FileText,
  History,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  useEveAgent,
  type EveAuthorizationPart,
  type EveDynamicToolPart,
  type EveMessage,
  type EveMessageInputRequest,
  type EveMessagePart,
} from "eve/react";
import { Client } from "eve/client";
import { toast } from "sonner";

import {
  AssistantAnalysisText,
  AssistantChartView,
  AssistantCitationLink,
} from "@/components/assistant/analysis-artifact";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { resolveEveBearerToken } from "@/lib/eve/auth";
import {
  assistantCitationsFromToolPart,
  collectAssistantReportSources,
  latestAssistantChart,
  type AssistantChart,
  type AssistantCitation,
  type AssistantReportSource,
} from "@/lib/eve/analysis-artifacts";
import {
  ASSISTANT_CANCEL_CONFIRM_TIMEOUT_MS,
  ASSISTANT_TURN_TIMEOUT_MS,
  latestActiveTurnId,
  latestTurnOutcome,
  withAssistantDeadline,
} from "@/lib/eve/assistant-resilience";
import { resolveEveHost } from "@/lib/eve/host";
import {
  buildAssistantClientContext,
  type AssistantPageContext,
} from "@/lib/eve/page-context";
import {
  type AssistantToolDetail,
  type AssistantErrorPresentation,
  presentAssistantTool,
  presentAssistantError,
  sanitizeAssistantText,
} from "@/lib/eve/tool-presentation";
import { publicErrorMessage } from "@/lib/public-errors";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export type { AssistantPageContext } from "@/lib/eve/page-context";

export type AssistantPanelProps = {
  className?: string;
  context?: AssistantPageContext;
  host?: string;
  title?: string;
};

type InputResponse = {
  optionId?: string;
  requestId: string;
  text?: string;
};

type CancellationReason = "manual" | "timeout";
type AnalysisSaveTarget = "report" | "chart";
type ConversationResetResult = "failed" | "ready" | "remounted";

type CompletedAssistantAnalysis = {
  chart?: AssistantChart;
  content: string;
  sources: AssistantReportSource[];
};

type SavedReportSummary = {
  id: Id<"aiReports">;
  name: string;
  scopeLabel: string;
  format: AnalysisSaveTarget;
  sourceCount: number;
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
  canArchive: boolean;
};

type ApprovalDiffRow = {
  after: string;
  afterLabel: string;
  before: string;
  beforeLabel: string;
  label: string;
};

type AssistantTargetReference = {
  href: string;
  label: string;
};

const suggestions = [
  "Summarize this table and flag missing data",
  "What changed in form performance?",
  "Find the most common values",
];

type AssistantPanelSessionProps = AssistantPanelProps & {
  initialDraft: string;
  onHardReset: (draft: string) => void;
};

type AssistantResetState = {
  draft: string;
  epoch: number;
  identityKey: string;
};

export function AssistantPanel(props: AssistantPanelProps) {
  const { isLoaded, orgId, sessionId } = useAuth();
  const identityKey = `${isLoaded ? (sessionId ?? "signed-out") : "loading"}:${
    orgId ?? "no-organization"
  }`;
  const [resetState, setResetState] = useState<AssistantResetState>(() => ({
    draft: "",
    epoch: 0,
    identityKey,
  }));
  const resetMatchesIdentity = resetState.identityKey === identityKey;
  const epoch = resetMatchesIdentity ? resetState.epoch : 0;
  const initialDraft = resetMatchesIdentity ? resetState.draft : "";
  const hardReset = useCallback(
    (draft: string) => {
      setResetState((current) => ({
        draft,
        epoch:
          current.identityKey === identityKey ? current.epoch + 1 : 1,
        identityKey,
      }));
    },
    [identityKey],
  );

  return (
    <AssistantPanelSession
      {...props}
      initialDraft={initialDraft}
      key={`${identityKey}:${epoch}`}
      onHardReset={hardReset}
    />
  );
}

function AssistantPanelSession({
  className,
  context,
  host,
  initialDraft,
  onHardReset,
  title = "Workspace analyst",
}: AssistantPanelSessionProps) {
  const clerkAuth = useAuth();
  const convexAuth = useConvexAuth();
  const usage = useQuery(
    api.aiSessions.getUsage,
    convexAuth.isAuthenticated ? {} : "skip",
  );
  const reports = useQuery(
    api.aiReports.list,
    convexAuth.isAuthenticated ? {} : "skip",
  );
  const saveReport = useMutation(api.aiReports.save);
  const archiveReport = useMutation(api.aiReports.archive);
  const [openReportId, setOpenReportId] = useState<Id<"aiReports">>();
  const openReport = useQuery(
    api.aiReports.get,
    convexAuth.isAuthenticated && openReportId
      ? { reportId: openReportId }
      : "skip",
  );
  const resolveBearer = useCallback(
    () =>
      resolveEveBearerToken({
        getToken: clerkAuth.getToken,
        isAuthenticated: convexAuth.isAuthenticated,
      }),
    [clerkAuth.getToken, convexAuth.isAuthenticated],
  );
  const resolvedHost = resolveEveHost({
    configuredHost: process.env.NEXT_PUBLIC_EVE_HOST,
    currentUrl:
      typeof window === "undefined" ? undefined : window.location.href,
    explicitHost: host,
    nodeEnv: process.env.NODE_ENV,
  });
  const clientSession = useMemo(
    () =>
      new Client({
        host: resolvedHost ?? "",
        auth: { bearer: resolveBearer },
        preserveCompletedSessions: true,
        redirect: "error",
      }).session(),
    [resolveBearer, resolvedHost],
  );
  const agent = useEveAgent({
    session: clientSession,
  });
  const [draft, setDraft] = useState(initialDraft);
  const [localFailure, setLocalFailure] =
    useState<AssistantErrorPresentation>();
  const [lastRequest, setLastRequest] = useState<string>();
  const [cancellationReason, setCancellationReason] =
    useState<CancellationReason>();
  const [respondingTo, setRespondingTo] = useState<string>();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [reportName, setReportName] = useState("");
  const [saveTarget, setSaveTarget] =
    useState<AnalysisSaveTarget>("report");
  const [reportSaveError, setReportSaveError] = useState<string>();
  const [savingReport, setSavingReport] = useState(false);
  const [archivingReportId, setArchivingReportId] =
    useState<Id<"aiReports">>();
  const messageViewportRef = useRef<HTMLDivElement>(null);
  const activeTurnIdRef = useRef<string | undefined>(undefined);
  const cancellationRequestedRef = useRef(false);
  const cancellationSentTurnRef = useRef<string | undefined>(undefined);
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const messages = agent.data.messages;

  const pageContext = useMemo(
    () => buildAssistantClientContext(context),
    [context],
  );
  const scopeLabel = useMemo(() => describePageScope(context), [context]);
  const latestAnalysis = useMemo(
    () => latestCompletedAssistantAnalysis(messages, isBusy),
    [isBusy, messages],
  );
  const selectedReportSummary = useMemo(
    () =>
      openReportId
        ? [...(reports?.active ?? []), ...(reports?.archived ?? [])].find(
            (report) => report.id === openReportId,
          )
        : undefined,
    [openReportId, reports],
  );
  const activeTurnId = latestActiveTurnId(agent.events);
  const turnOutcome = latestTurnOutcome(agent.events);

  const sendCancellation = useCallback(
    async (turnId: string): Promise<void> => {
      if (
        !cancellationRequestedRef.current ||
        cancellationSentTurnRef.current === turnId
      ) {
        return;
      }
      cancellationSentTurnRef.current = turnId;
      try {
        await withAssistantDeadline(
          clientSession.cancel({ turnId }),
          Math.floor(ASSISTANT_CANCEL_CONFIRM_TIMEOUT_MS / 2),
        );
      } catch {
        cancellationRequestedRef.current = false;
        cancellationSentTurnRef.current = undefined;
        setCancellationReason(undefined);
        setLocalFailure({
          action: "new-session",
          message:
            "We couldn’t confirm that the request stopped. Start a new conversation before trying again.",
        });
      }
    },
    [clientSession],
  );

  useEffect(() => {
    activeTurnIdRef.current = activeTurnId;
    if (activeTurnId && cancellationRequestedRef.current) {
      void sendCancellation(activeTurnId);
    }
  }, [activeTurnId, sendCancellation]);

  const requestCancellation = useCallback(
    (reason: CancellationReason): void => {
      if (cancellationRequestedRef.current) return;
      cancellationRequestedRef.current = true;
      cancellationSentTurnRef.current = undefined;
      setCancellationReason(reason);
      setLocalFailure(undefined);
      const turnId = activeTurnIdRef.current;
      if (turnId) void sendCancellation(turnId);
    },
    [sendCancellation],
  );

  useEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport) {
      return;
    }
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [messages, agent.status]);

  useEffect(() => {
    if (!isBusy || cancellationReason) return;
    const timeout = window.setTimeout(() => {
      void requestCancellation("timeout");
    }, ASSISTANT_TURN_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [cancellationReason, isBusy, requestCancellation]);

  useEffect(() => {
    if (!cancellationReason) return;
    if (turnOutcome === "cancelled") {
      const settle = window.setTimeout(() => {
        cancellationRequestedRef.current = false;
        cancellationSentTurnRef.current = undefined;
        setCancellationReason(undefined);
        setLocalFailure({
          action: "retry",
          message:
            cancellationReason === "timeout"
              ? "The request took too long and was stopped. No changes were made. You can try again."
              : "The request was stopped. No changes were made. You can try again.",
        });
      }, 0);
      return () => window.clearTimeout(settle);
    }
    if (!isBusy && turnOutcome) {
      const settle = window.setTimeout(() => {
        cancellationRequestedRef.current = false;
        cancellationSentTurnRef.current = undefined;
        setCancellationReason(undefined);
      }, 0);
      return () => window.clearTimeout(settle);
    }
  }, [cancellationReason, isBusy, turnOutcome]);

  useEffect(() => {
    if (!cancellationReason) return;
    const timeout = window.setTimeout(() => {
      setLocalFailure({
        action: "new-session",
        message:
          "Stopping is taking longer than expected. Start a new conversation before sending another request.",
      });
    }, ASSISTANT_CANCEL_CONFIRM_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [cancellationReason]);

  async function submitMessage(message: string): Promise<void> {
    const normalized = message.trim();
    if (!normalized || isBusy) {
      return;
    }

    setLocalFailure(undefined);
    cancellationRequestedRef.current = false;
    cancellationSentTurnRef.current = undefined;
    setCancellationReason(undefined);
    if (convexAuth.isLoading) {
      setLocalFailure({
        message:
          "Workspace access is still being confirmed. Wait a moment, then try again.",
      });
      return;
    }
    if (!convexAuth.isAuthenticated) {
      setLocalFailure(
        presentAssistantError("Workspace authentication is unavailable."),
      );
      return;
    }
    setLastRequest(normalized);
    setDraft("");
    try {
      await agent.send({
        message: normalized,
        ...(pageContext ? { clientContext: pageContext } : {}),
      });
    } catch (error) {
      setDraft(normalized);
      setLocalFailure(presentAssistantError(error));
    }
  }

  async function respondToInput(responses: readonly InputResponse[]): Promise<void> {
    const requestId = responses[0]?.requestId;
    if (!requestId || isBusy) {
      return;
    }

    setRespondingTo(requestId);
    setLocalFailure(undefined);
    cancellationRequestedRef.current = false;
    cancellationSentTurnRef.current = undefined;
    setCancellationReason(undefined);
    try {
      await agent.send({ inputResponses: responses });
    } catch (error) {
      setLocalFailure(presentAssistantError(error));
    } finally {
      setRespondingTo(undefined);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submitMessage(draft);
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage(draft);
    }
  }

  async function startNewConversation(
    keepLastRequest = false,
  ): Promise<ConversationResetResult> {
    const requestToKeep = keepLastRequest ? (lastRequest ?? draft) : undefined;
    setLocalFailure(undefined);
    setCancellationReason(undefined);
    cancellationRequestedRef.current = false;
    cancellationSentTurnRef.current = undefined;
    try {
      await withAssistantDeadline(
        clientSession.reset(),
        ASSISTANT_CANCEL_CONFIRM_TIMEOUT_MS,
      );
      agent.reset();
      setDraft(requestToKeep ?? "");
      if (!keepLastRequest) setLastRequest(undefined);
      return "ready";
    } catch (error) {
      const failure = presentAssistantError(error);
      if (failure.action === "new-session") {
        agent.reset();
        onHardReset(requestToKeep ?? "");
        return "remounted";
      }
      setLocalFailure(failure);
      return "failed";
    }
  }

  async function retryLastRequest(): Promise<void> {
    if (!lastRequest || isBusy) return;
    const request = lastRequest;
    const reset = await startNewConversation(true);
    if (reset !== "ready") return;
    await submitMessage(request);
  }

  function beginSavingLatestAnalysis(): void {
    if (!latestAnalysis) {
      return;
    }
    if (latestAnalysis.sources.length < 1) {
      toast.error("Read workspace data before saving", {
        description:
          "Ask the analyst to inspect a table, view, form, or analytics result so the saved analysis has a source you can verify.",
      });
      return;
    }
    setSaveTarget("report");
    setReportName(defaultReportName(scopeLabel));
    setReportSaveError(undefined);
    setSaveDialogOpen(true);
  }

  async function saveLatestAnalysis(): Promise<void> {
    const name = reportName.trim();
    if (!latestAnalysis) {
      setReportSaveError(
        "Ask the analyst a question and wait for the response before saving.",
      );
      return;
    }
    if (latestAnalysis.sources.length < 1) {
      setReportSaveError(
        "This response has no verified workspace source. Ask the analyst to inspect the relevant data, then save the sourced response.",
      );
      return;
    }
    if (saveTarget === "chart" && !latestAnalysis.chart) {
      setReportSaveError(
        "This response does not include supported summary data for a chart.",
      );
      return;
    }
    if (!name) {
      setReportSaveError("Give this report a short, recognizable name.");
      return;
    }
    if (name.length > 120) {
      setReportSaveError("Keep the report name to 120 characters or fewer.");
      return;
    }

    setSavingReport(true);
    setReportSaveError(undefined);
    try {
      await saveReport({
        name,
        content: latestAnalysis.content,
        scopeLabel,
        format: saveTarget,
        ...(saveTarget === "chart" && latestAnalysis.chart
          ? { chart: latestAnalysis.chart }
          : {}),
        sources: latestAnalysis.sources,
      });
      setSaveDialogOpen(false);
      toast.success(saveTarget === "chart" ? "Chart saved" : "Analysis saved", {
        description: `${name} is ready in saved analyses.`,
      });
    } catch (error) {
      setReportSaveError(
        publicErrorMessage(
          error,
          "We could not save this analysis. Please try again.",
        ),
      );
    } finally {
      setSavingReport(false);
    }
  }

  async function archiveSavedReport(report: SavedReportSummary): Promise<void> {
    if (!report.canArchive || archivingReportId) {
      return;
    }
    setArchivingReportId(report.id);
    try {
      await archiveReport({ reportId: report.id });
      if (openReportId === report.id) {
        setOpenReportId(undefined);
      }
      toast.success(`${sanitizeAssistantText(report.name)} archived`, {
        description: "It remains available under archived reports.",
      });
    } catch (error) {
      toast.error("Could not archive the report", {
        description: publicErrorMessage(error),
      });
    } finally {
      setArchivingReportId(undefined);
    }
  }

  const displayedFailure =
    localFailure ??
    (agent.error ? presentAssistantError(agent.error) : undefined);
  const composerDisabled =
    isBusy || convexAuth.isLoading || !convexAuth.isAuthenticated;

  return (
    <TooltipProvider>
      <Card
        className={cn(
          "h-full min-h-[520px] w-full gap-0 overflow-hidden border-0 bg-background py-0 shadow-none ring-0",
          className,
        )}
      >
        <CardHeader className="border-b bg-background py-3.5 pr-14">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
              <MessageSquareText className="size-4" aria-hidden="true" />
              <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-background bg-emerald-500" />
            </div>
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 truncate">
                {title}
                <Badge className="rounded-md" variant="secondary">
                  Pro
                </Badge>
              </CardTitle>
              <CardDescription className="truncate">
                {scopeLabel}
              </CardDescription>
              {usage ? (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {usage.eligible
                    ? `${usage.remaining.toLocaleString()} of ${usage.limit.toLocaleString()} questions left this month`
                    : "Available with the Pro plan"}
                </p>
              ) : null}
            </div>
          </div>
          <CardAction className="flex items-center gap-1">
            {isBusy ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={
                        cancellationReason ? "Stopping response" : "Stop response"
                      }
                      disabled={Boolean(cancellationReason)}
                      onClick={() => requestCancellation("manual")}
                      size="icon-sm"
                      variant="ghost"
                    />
                  }
                >
                  {cancellationReason ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <Square className="size-3.5 fill-current" />
                  )}
                </TooltipTrigger>
                <TooltipContent>
                  {cancellationReason ? "Stopping safely…" : "Stop response"}
                </TooltipContent>
              </Tooltip>
            ) : null}
            <Tooltip>
              <TooltipTrigger
                render={
                    <Button
                      aria-label="Start a new assistant session"
                      onClick={() => void startNewConversation()}
                      size="icon-sm"
                      variant="ghost"
                    />
                }
              >
                <RefreshCw className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>New conversation</TooltipContent>
            </Tooltip>
          </CardAction>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col px-0">
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5"
            ref={messageViewportRef}
          >
            {messages.length === 0 ? (
              <EmptyConversation
                disabled={composerDisabled}
                onSuggestion={(suggestion) => void submitMessage(suggestion)}
              />
            ) : (
              <div className="space-y-5">
                {messages.map((message) => (
                  <AssistantMessage
                    canRespond={!isBusy}
                    isStreaming={
                      isBusy &&
                      message.role === "assistant" &&
                      message === messages.at(-1)
                    }
                    key={message.id}
                    message={message}
                    onInputResponses={respondToInput}
                    respondingTo={respondingTo}
                    scopeLabel={scopeLabel}
                  />
                ))}
              </div>
            )}

            {agent.status === "submitted" || cancellationReason ? (
              <div
                aria-live="polite"
                className="mt-5 flex items-center gap-2 text-sm text-muted-foreground"
                role="status"
              >
                <LoaderCircle className="size-4 animate-spin text-foreground" />
                {cancellationReason === "timeout"
                  ? "This is taking longer than expected. Stopping safely…"
                  : cancellationReason === "manual"
                    ? "Stopping this request safely…"
                    : `Reviewing ${scopeLabel.toLowerCase()}…`}
              </div>
            ) : null}
          </div>

          <div className="border-t bg-muted/15 p-3">
            <SavedReports
              archivingReportId={archivingReportId}
              eligible={usage?.eligible === true}
              hasAnalysis={Boolean(latestAnalysis)}
              hasValidatedSource={Boolean(latestAnalysis?.sources.length)}
              onArchive={(report) => void archiveSavedReport(report)}
              onOpen={setOpenReportId}
              onSave={beginSavingLatestAnalysis}
              reports={reports}
            />

            {usage?.recentChanges.length ? (
              <details className="group mb-3 rounded-lg border bg-background px-3 py-2">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium">
                  <History className="size-3.5 text-muted-foreground" />
                  Recent approved AI changes
                  <span className="ml-auto text-[10px] text-muted-foreground group-open:hidden">
                    {usage.recentChanges.length}
                  </span>
                </summary>
                <ul className="mt-2 space-y-2 border-t pt-2">
                  {usage.recentChanges.map((change) => (
                    <li className="text-xs" key={change.id}>
                      <p className="font-medium">{change.label}</p>
                      <p className="text-muted-foreground">
                        {change.location} ·{" "}
                        {new Date(change.createdAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {displayedFailure ? (
              <AssistantFailure
                failure={displayedFailure}
                hasRetry={Boolean(lastRequest)}
                isBusy={isBusy}
                onNewSession={() => void startNewConversation(true)}
                onRetry={() => void retryLastRequest()}
              />
            ) : null}

            <form className="relative" onSubmit={onSubmit}>
              <Textarea
                aria-label="Message workspace analyst"
                className="max-h-36 min-h-[76px] resize-none rounded-lg bg-background pr-12 shadow-none"
                disabled={composerDisabled}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder="Ask about records, columns, or form performance…"
                value={draft}
              />
              <Button
                aria-label="Send message"
                className="absolute right-2 bottom-2 rounded-md"
                disabled={composerDisabled || draft.trim().length === 0}
                size="icon-sm"
                type="submit"
              >
                {isBusy ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Send />
                )}
              </Button>
            </form>
            <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <ShieldCheck className="size-3" />
                {convexAuth.isLoading
                  ? "Authorizing workspace…"
                  : "Writes always require approval"}
              </span>
              <span>Shift + Enter for a new line</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog
        onOpenChange={(open) => {
          setSaveDialogOpen(open);
          if (!open) setReportSaveError(undefined);
        }}
        open={saveDialogOpen}
      >
        <DialogContent className="sm:max-w-md">
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              void saveLatestAnalysis();
            }}
          >
            <DialogHeader>
              <DialogTitle>Save this analysis</DialogTitle>
              <DialogDescription>
                Save the completed response with its named workspace sources.
                Choose a chart only when this analysis contains supported
                summary data. The readable scope is{" "}
                <span className="font-medium text-foreground">
                  {scopeLabel}
                </span>
                .
              </DialogDescription>
            </DialogHeader>
            <div
              aria-label="Save analysis as"
              className="grid grid-cols-2 gap-2"
              role="group"
            >
              <Button
                aria-pressed={saveTarget === "report"}
                onClick={() => {
                  setSaveTarget("report");
                  setReportSaveError(undefined);
                }}
                type="button"
                variant={saveTarget === "report" ? "default" : "outline"}
              >
                <FileText />
                Report
              </Button>
              {latestAnalysis?.chart ? (
                <Button
                  aria-pressed={saveTarget === "chart"}
                  onClick={() => {
                    setSaveTarget("chart");
                    setReportName(
                      defaultChartName(latestAnalysis.chart?.title, scopeLabel),
                    );
                    setReportSaveError(undefined);
                  }}
                  type="button"
                  variant={saveTarget === "chart" ? "default" : "outline"}
                >
                  <BarChart3 />
                  Chart
                </Button>
              ) : (
                <div
                  className="flex items-center justify-center rounded-lg border border-dashed px-3 text-center text-xs text-muted-foreground"
                  title="Ask for grouped values, top values, averages, or form performance to create a chart."
                >
                  No chart data
                </div>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="assistant-report-name">
                {saveTarget === "chart" ? "Chart name" : "Report name"}
              </Label>
              <Input
                autoComplete="off"
                autoFocus
                id="assistant-report-name"
                maxLength={120}
                onChange={(event) => {
                  setReportName(event.target.value);
                  setReportSaveError(undefined);
                }}
                placeholder="For example, Q3 roadmap review"
                value={reportName}
              />
              <p className="text-xs text-muted-foreground">
                {reportName.length}/120 characters
              </p>
              <p
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs leading-5",
                  latestAnalysis?.sources.length
                    ? "bg-muted/30 text-muted-foreground"
                    : "border-destructive/25 bg-destructive/5 text-destructive",
                )}
              >
                {latestAnalysis?.sources.length
                  ? `${latestAnalysis.sources.length} named workspace ${
                      latestAnalysis.sources.length === 1
                        ? "source"
                        : "sources"
                    } will be saved with this ${saveTarget}.`
                  : "A verified workspace source is required before this analysis can be saved."}
              </p>
              {reportSaveError ? (
                <p className="text-xs text-destructive" role="alert">
                  {reportSaveError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                disabled={savingReport}
                onClick={() => setSaveDialogOpen(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={
                  savingReport ||
                  reportName.trim().length === 0 ||
                  !latestAnalysis?.sources.length
                }
                type="submit"
              >
                {savingReport ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Save />
                )}
                {saveTarget === "chart" ? "Save chart" : "Save report"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setOpenReportId(undefined);
        }}
        open={Boolean(openReportId)}
      >
        <DialogContent className="sm:max-w-xl">
          {openReport === undefined ? (
            <div
              className="flex min-h-44 items-center justify-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              <LoaderCircle className="size-4 animate-spin" />
              Opening report…
            </div>
          ) : openReport === null ? (
            <>
              <DialogHeader>
                <DialogTitle>Report unavailable</DialogTitle>
                <DialogDescription>
                  This report may have been removed or belong to another
                  workspace.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter showCloseButton />
            </>
          ) : (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2 pr-8">
                  <DialogTitle>
                    {sanitizeAssistantText(openReport.name)}
                  </DialogTitle>
                  {openReport.status === "archived" ? (
                    <Badge variant="outline">Archived</Badge>
                  ) : null}
                  <Badge variant="secondary">
                    {openReport.format === "chart" ? "Chart" : "Report"}
                  </Badge>
                </div>
                <DialogDescription>
                  {sanitizeAssistantText(openReport.scopeLabel)} · Saved{" "}
                  {formatReportDate(openReport.createdAt)}
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[65vh] space-y-4 overflow-y-auto rounded-xl border bg-muted/20 p-4">
                {openReport.format === "chart" && openReport.chart ? (
                  <AssistantChartView chart={openReport.chart} />
                ) : null}
                <AssistantAnalysisText
                  text={sanitizeAssistantText(openReport.content)}
                />
                <ReportSources citations={openReport.citations ?? []} />
              </div>
              <DialogFooter showCloseButton>
                {selectedReportSummary?.canArchive ? (
                  <Button
                    disabled={Boolean(archivingReportId)}
                    onClick={() =>
                      void archiveSavedReport(selectedReportSummary)
                    }
                    type="button"
                    variant="outline"
                  >
                    {archivingReportId === selectedReportSummary.id ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Archive />
                    )}
                    Archive analysis
                  </Button>
                ) : null}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

function ReportSources({ citations }: { citations: AssistantCitation[] }) {
  return (
    <section aria-label="Saved analysis sources" className="rounded-lg border bg-background p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <Database className="size-3" />
        Sources
      </p>
      {citations.length ? (
        <div className="flex flex-wrap gap-2">
          {citations.map((citation) => (
            <AssistantCitationLink
              citation={{
                ...citation,
                label: sanitizeAssistantText(citation.label),
              }}
              key={`${citation.kind}:${citation.href}`}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">
          No named workspace source was saved with this analysis.
        </p>
      )}
    </section>
  );
}

function EmptyConversation({
  disabled,
  onSuggestion,
}: {
  disabled: boolean;
  onSuggestion: (suggestion: string) => void;
}) {
  return (
    <div className="mx-auto flex min-h-[360px] max-w-md flex-col items-center justify-center text-center">
      <div className="mb-4 flex size-11 items-center justify-center rounded-lg border bg-muted/35 text-foreground">
        <Database className="size-5" />
      </div>
      <h2 className="font-heading text-base font-medium">Ask your workspace</h2>
      <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
        Explore data quality, spot patterns, understand form conversion, or propose a precise
        change.
      </p>
      <div className="mt-5 flex w-full flex-col gap-2">
        {suggestions.map((suggestion) => (
          <Button
            className="h-auto justify-start whitespace-normal px-3 py-2.5 text-left text-xs"
            disabled={disabled}
            key={suggestion}
            onClick={() => onSuggestion(suggestion)}
            type="button"
            variant="outline"
          >
            <ArrowRight className="size-3.5 text-muted-foreground" />
            {suggestion}
          </Button>
        ))}
      </div>
    </div>
  );
}

function SavedReports({
  archivingReportId,
  eligible,
  hasAnalysis,
  hasValidatedSource,
  onArchive,
  onOpen,
  onSave,
  reports,
}: {
  archivingReportId?: Id<"aiReports">;
  eligible: boolean;
  hasAnalysis: boolean;
  hasValidatedSource: boolean;
  onArchive: (report: SavedReportSummary) => void;
  onOpen: (reportId: Id<"aiReports">) => void;
  onSave: () => void;
  reports:
    | {
        active: SavedReportSummary[];
        archived: SavedReportSummary[];
      }
    | undefined;
}) {
  const reportCount =
    (reports?.active.length ?? 0) + (reports?.archived.length ?? 0);

  return (
    <details className="group mb-3 rounded-lg border bg-background px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium">
        <FileText className="size-3.5 text-muted-foreground" />
        Saved analyses
        <span className="ml-auto text-[10px] text-muted-foreground group-open:hidden">
          {reportCount}
        </span>
      </summary>
      <div className="mt-2 space-y-3 border-t pt-3">
        <Button
          className="w-full justify-center"
          disabled={!eligible || !hasAnalysis || !hasValidatedSource}
          onClick={onSave}
          size="sm"
          type="button"
          variant="outline"
        >
          <Save />
          Save latest analysis
        </Button>
        {!eligible ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Saving assistant analyses is available with the Pro plan.
          </p>
        ) : !hasAnalysis ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Complete an assistant response, then save it here as a named report
            or a supported chart.
          </p>
        ) : !hasValidatedSource ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            This response has no verified workspace source. Ask the analyst to
            inspect the relevant data before saving it.
          </p>
        ) : null}

        {reports === undefined ? (
          <p
            className="flex items-center gap-2 text-xs text-muted-foreground"
            role="status"
          >
            <LoaderCircle className="size-3.5 animate-spin" />
            Loading saved analyses…
          </p>
        ) : reports.active.length === 0 &&
          reports.archived.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No saved analyses yet.
          </p>
        ) : (
          <>
            {reports.active.length > 0 ? (
              <SavedReportList
                archivingReportId={archivingReportId}
                label="Current analyses"
                onArchive={onArchive}
                onOpen={onOpen}
                reports={reports.active}
              />
            ) : null}
            {reports.archived.length > 0 ? (
              <SavedReportList
                archivingReportId={archivingReportId}
                label="Archived analyses"
                onArchive={onArchive}
                onOpen={onOpen}
                reports={reports.archived}
              />
            ) : null}
          </>
        )}
      </div>
    </details>
  );
}

function SavedReportList({
  archivingReportId,
  label,
  onArchive,
  onOpen,
  reports,
}: {
  archivingReportId?: Id<"aiReports">;
  label: string;
  onArchive: (report: SavedReportSummary) => void;
  onOpen: (reportId: Id<"aiReports">) => void;
  reports: SavedReportSummary[];
}) {
  return (
    <section aria-label={label}>
      <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      <ul className="space-y-1.5">
        {reports.map((report) => {
          const safeName = sanitizeAssistantText(report.name);
          return (
            <li
              className="flex items-center gap-1 rounded-lg border bg-muted/15 p-1.5"
              key={report.id}
            >
              <Button
                aria-label={`Open ${safeName}`}
                className="h-auto min-w-0 flex-1 justify-start px-1.5 py-1 text-left"
                onClick={() => onOpen(report.id)}
                type="button"
                variant="ghost"
              >
                {report.format === "chart" ? (
                  <BarChart3 className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <BookOpen className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">
                    {safeName}
                  </span>
                  <span className="block truncate text-[10px] font-normal text-muted-foreground">
                    {sanitizeAssistantText(report.scopeLabel)} ·{" "}
                    {report.format === "chart" ? "Chart" : "Report"} ·{" "}
                    {report.sourceCount ?? 0}{" "}
                    {(report.sourceCount ?? 0) === 1 ? "source" : "sources"} ·{" "}
                    {formatReportDate(report.createdAt)}
                  </span>
                </span>
              </Button>
              {report.canArchive ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label={`Archive ${safeName}`}
                        disabled={Boolean(archivingReportId)}
                        onClick={() => onArchive(report)}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      />
                    }
                  >
                    {archivingReportId === report.id ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Archive />
                    )}
                  </TooltipTrigger>
                  <TooltipContent>Archive report</TooltipContent>
                </Tooltip>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AssistantMessage({
  canRespond,
  isStreaming,
  message,
  onInputResponses,
  respondingTo,
  scopeLabel,
}: {
  canRespond: boolean;
  isStreaming: boolean;
  message: EveMessage;
  onInputResponses: (responses: readonly InputResponse[]) => Promise<void>;
  respondingTo?: string;
  scopeLabel: string;
}) {
  return (
    <article
      className={cn(
        "flex gap-2.5",
        message.role === "user" ? "justify-end" : "justify-start",
      )}
    >
      {message.role === "assistant" ? (
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
          <MessageSquareText className="size-3.5" />
        </div>
      ) : null}
      <div
        className={cn(
          "min-w-0 max-w-[88%] space-y-3",
          message.role === "user" &&
            "rounded-lg rounded-br-sm bg-foreground px-3.5 py-2.5 text-background",
        )}
      >
        {message.parts.map((part, index) => (
          <MessagePart
            canRespond={canRespond}
            isStreaming={isStreaming}
            key={messagePartKey(part, index)}
            onInputResponses={onInputResponses}
            part={part}
            respondingTo={respondingTo}
            scopeLabel={scopeLabel}
          />
        ))}
        {message.role === "assistant" ? (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Database className="size-3" />
            Answered from {scopeLabel.toLowerCase()}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function MessagePart({
  canRespond,
  isStreaming,
  onInputResponses,
  part,
  respondingTo,
  scopeLabel,
}: {
  canRespond: boolean;
  isStreaming: boolean;
  onInputResponses: (responses: readonly InputResponse[]) => Promise<void>;
  part: EveMessagePart;
  respondingTo?: string;
  scopeLabel: string;
}) {
  switch (part.type) {
    case "step-start":
      return null;
    case "text":
      return isStreaming && part.state === "streaming" ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {sanitizeAssistantText(part.text)}
          <span className="ml-1 inline-block h-4 w-1 animate-pulse rounded-full bg-current align-middle" />
        </p>
      ) : (
        <AssistantAnalysisText text={sanitizeAssistantText(part.text)} />
      );
    case "reasoning":
      return part.state === "streaming" ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          Analyzing…
        </div>
      ) : null;
    case "file":
      return (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
          <File className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{part.filename ?? "Attachment"}</span>
          <span className="text-muted-foreground">
            {[part.mediaType, formatBytes(part.size)].filter(Boolean).join(" · ")}
          </span>
        </div>
      );
    case "authorization":
      return <AuthorizationState part={part} />;
    case "dynamic-tool":
      return (
        <ToolState
          canRespond={canRespond}
          onInputResponses={onInputResponses}
          part={part}
          respondingTo={respondingTo}
          scopeLabel={scopeLabel}
        />
      );
  }
}

function ToolState({
  canRespond,
  onInputResponses,
  part,
  respondingTo,
  scopeLabel,
}: {
  canRespond: boolean;
  onInputResponses: (responses: readonly InputResponse[]) => Promise<void>;
  part: EveDynamicToolPart;
  respondingTo?: string;
  scopeLabel: string;
}) {
  const request = part.toolMetadata?.eve?.inputRequest;
  const response = part.toolMetadata?.eve?.inputResponse;
  const isApproval = isApprovalRequest(request);
  const isPending = part.state === "approval-requested" && !response;
  const isRunning =
    part.state === "input-available" || part.state === "approval-responded";
  const isSuccess = part.state === "output-available";
  const isDenied = part.state === "output-denied";
  const isError = part.state === "output-error";
  const presentation = presentAssistantTool(
    part.toolName,
    part.input,
    part.output,
  );
  const citations = assistantCitationsFromToolPart(part);
  const targetReference = assistantTargetReference(part.toolName, part.input);
  const approvalDetails = isApproval
    ? splitApprovalDetails(presentation.details)
    : undefined;
  const ordinaryDetails =
    approvalDetails?.remaining ?? presentation.details;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-card text-card-foreground",
        isPending && "border-amber-400/45",
        isDenied && "border-muted",
        isError && "border-destructive/30",
        isSuccess && "border-emerald-500/25",
      )}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            isPending
              ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
              : isSuccess
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : isError
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-muted-foreground",
          )}
        >
          {isPending ? (
            <ShieldCheck className="size-3.5" />
          ) : isSuccess ? (
            <Check className="size-3.5" />
          ) : isDenied || isError ? (
            <X className="size-3.5" />
          ) : (
            <LoaderCircle className={cn("size-3.5", isRunning && "animate-spin")} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{presentation.title}</p>
          <p className="text-[11px] text-muted-foreground">
            {toolStateLabel(part.state, isApproval)}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
            {scopeLabel}
          </p>
        </div>
        <Badge variant="outline">{isApproval ? "Write" : "Read"}</Badge>
      </div>

      {approvalDetails?.changes.length ? (
        <ApprovalDiff changes={approvalDetails.changes} />
      ) : null}

      {ordinaryDetails.length > 0 ? (
        <dl className="grid gap-2 border-t bg-muted/20 px-3 py-3">
          {ordinaryDetails.map((item, index) => (
            <div
              className="grid grid-cols-[minmax(84px,0.4fr)_minmax(0,1fr)] items-start gap-3 text-xs"
              key={`${item.label}:${index}`}
            >
              <dt className="text-muted-foreground">{item.label}</dt>
              <dd className="min-w-0 break-words font-medium">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {targetReference ? (
        <div className="flex border-t bg-background px-3 py-2">
          <Link
            aria-label={targetReference.label}
            className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={targetReference.href}
          >
            {targetReference.label}
            <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      ) : null}

      {request && isApproval ? (
        <ApprovalActions
          canRespond={canRespond && respondingTo !== request.requestId}
          onInputResponses={onInputResponses}
          part={part}
          responding={respondingTo === request.requestId}
        />
      ) : request ? (
        <QuestionActions
          canRespond={canRespond && respondingTo !== request.requestId}
          onInputResponses={onInputResponses}
          part={part}
          responding={respondingTo === request.requestId}
        />
      ) : null}

      {part.output !== undefined && presentation.result ? (
        <div className="flex items-start gap-2 border-t bg-emerald-500/[0.04] px-3 py-2.5 text-xs text-emerald-800 dark:text-emerald-200">
          <Check className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <p className="font-medium">Completed</p>
            <p className="mt-0.5 text-emerald-800/80 dark:text-emerald-200/80">
              {presentation.result}
            </p>
          </div>
        </div>
      ) : null}

      {citations.length ? (
        <div className="border-t bg-muted/10 px-3 py-2.5">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Named sources
          </p>
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {citations.map((citation) => (
              <AssistantCitationLink
                citation={citation}
                key={`${citation.kind}:${citation.href}`}
              />
            ))}
          </div>
        </div>
      ) : null}

      {part.errorText ? (
        <p className="border-t bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {presentAssistantError(part.errorText).message}
        </p>
      ) : null}
    </div>
  );
}

function ApprovalDiff({ changes }: { changes: ApprovalDiffRow[] }) {
  return (
    <section
      aria-label="Proposed changes"
      className="border-t bg-muted/15 px-3 py-3"
    >
      <p className="mb-2 text-[11px] font-medium text-muted-foreground">
        Proposed changes
      </p>
      <div className="space-y-2.5">
        {changes.map((change, index) => (
          <div key={`${change.label}:${index}`}>
            {change.label !== "Change" ? (
              <p className="mb-1.5 text-xs font-medium">{change.label}</p>
            ) : null}
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2">
              <div className="min-w-0 rounded-md border bg-background px-2.5 py-2">
                <p className="text-[10px] font-medium text-muted-foreground">
                  {change.beforeLabel}
                </p>
                <p className="mt-0.5 break-words text-xs font-medium">
                  {change.before}
                </p>
              </div>
              <ArrowRight
                aria-hidden="true"
                className="mt-4 size-3.5 shrink-0 text-muted-foreground"
              />
              <div className="min-w-0 rounded-md border border-emerald-600/25 bg-emerald-500/[0.04] px-2.5 py-2">
                <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                  {change.afterLabel}
                </p>
                <p className="mt-0.5 break-words text-xs font-medium">
                  {change.after}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ApprovalActions({
  canRespond,
  onInputResponses,
  part,
  responding,
}: {
  canRespond: boolean;
  onInputResponses: (responses: readonly InputResponse[]) => Promise<void>;
  part: EveDynamicToolPart;
  responding: boolean;
}) {
  const request = part.toolMetadata?.eve?.inputRequest;
  if (!request) {
    return null;
  }

  const response = part.toolMetadata?.eve?.inputResponse;
  if (response) {
    const approved = response.optionId === "approve";
    return (
      <div
        className={cn(
          "flex items-center gap-2 border-t px-3 py-2.5 text-xs",
          approved
            ? "bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
            : "bg-muted/40 text-muted-foreground",
        )}
      >
        {approved ? <Check className="size-3.5" /> : <X className="size-3.5" />}
        {approved ? "Change approved" : "Change not approved"}
      </div>
    );
  }

  return (
    <div className="border-t bg-amber-500/[0.04] px-3 py-3">
      <p className="mb-2.5 text-xs leading-relaxed text-muted-foreground">
        Review the change above. Nothing will be updated until you approve it.
      </p>
      <div className="flex flex-wrap gap-2">
        {request.options
          ?.filter((option) => option.id === "approve" || option.id === "deny")
          .map((option) => {
          const isDeny = option.id === "deny" || option.style === "danger";
          return (
            <Button
              disabled={!canRespond || responding}
              key={option.id}
              onClick={() =>
                void onInputResponses([
                  {
                    optionId: option.id,
                    requestId: request.requestId,
                  },
                ])
              }
              size="sm"
              type="button"
              variant={isDeny ? "outline" : "default"}
            >
              {responding ? (
                <LoaderCircle className="animate-spin" />
              ) : isDeny ? (
                <X />
              ) : (
                <Check />
              )}
              {isDeny ? "Keep as is" : "Approve change"}
            </Button>
          );
          })}
      </div>
    </div>
  );
}

function QuestionActions({
  canRespond,
  onInputResponses,
  part,
  responding,
}: {
  canRespond: boolean;
  onInputResponses: (responses: readonly InputResponse[]) => Promise<void>;
  part: EveDynamicToolPart;
  responding: boolean;
}) {
  const request = part.toolMetadata?.eve?.inputRequest;
  const response = part.toolMetadata?.eve?.inputResponse;
  if (!request) return null;
  if (response) {
    return (
      <div className="flex items-center gap-2 border-t bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
        <Check className="size-3.5" />
        Answer received
      </div>
    );
  }

  return (
    <div className="border-t bg-muted/20 px-3 py-3">
      <p className="text-xs font-medium">
        {sanitizeAssistantText(request.prompt)}
      </p>
      {request.options?.length ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {request.options.map((option) => (
            <Button
              disabled={!canRespond || responding}
              key={option.id}
              onClick={() =>
                void onInputResponses([
                  {
                    optionId: option.id,
                    requestId: request.requestId,
                  },
                ])
              }
              size="sm"
              type="button"
              variant="outline"
            >
              {responding ? (
                <LoaderCircle className="animate-spin" />
              ) : null}
              {sanitizeAssistantText(option.label)}
            </Button>
          ))}
        </div>
      ) : null}
      {request.allowFreeform ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          You can also reply in the message box.
        </p>
      ) : null}
    </div>
  );
}

function AuthorizationState({ part }: { part: EveAuthorizationPart }) {
  const completed = part.state === "completed";
  const authorized = completed && part.outcome === "authorized";
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5 text-xs">
      <div className="flex items-center gap-2">
        {authorized ? (
          <Check className="size-3.5 text-emerald-600" />
        ) : completed ? (
          <X className="size-3.5 text-destructive" />
        ) : (
          <ShieldCheck className="size-3.5 text-muted-foreground" />
        )}
        <span className="font-medium">Workspace access</span>
      </div>
      <p className="mt-1 text-muted-foreground">
        {authorized
          ? "Secure workspace access confirmed."
          : completed
            ? "Workspace access was not granted."
            : "Confirming secure access to your workspace…"}
      </p>
    </div>
  );
}

function AssistantFailure({
  failure,
  hasRetry,
  isBusy,
  onNewSession,
  onRetry,
}: {
  failure: AssistantErrorPresentation;
  hasRetry: boolean;
  isBusy: boolean;
  onNewSession: () => void;
  onRetry: () => void;
}) {
  const reload = () => window.location.reload();
  const showRetry = failure.action === "retry" && hasRetry && !isBusy;
  const showNewSession =
    failure.action === "new-session" ||
    (failure.action === "retry" && !hasRetry);

  return (
    <div
      className="mb-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <X className="mt-0.5 size-3.5 shrink-0" />
        <span>{failure.message}</span>
      </div>
      {failure.action ? (
        <div className="mt-2 flex flex-wrap gap-2 pl-5">
          {failure.action === "reload" ? (
            <Button onClick={reload} size="xs" type="button" variant="outline">
              Reload page
            </Button>
          ) : null}
          {showRetry ? (
            <Button onClick={onRetry} size="xs" type="button" variant="outline">
              Try request again
            </Button>
          ) : null}
          {showNewSession ? (
            <Button
              onClick={onNewSession}
              size="xs"
              type="button"
              variant="outline"
            >
              Start new conversation
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function latestCompletedAssistantAnalysis(
  messages: readonly EveMessage[],
  isBusy: boolean,
): CompletedAssistantAnalysis | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      !message ||
      message.role !== "assistant" ||
      (isBusy && index === messages.length - 1)
    ) {
      continue;
    }

    const content = message.parts
      .map((part) =>
        part.type === "text" && part.state !== "streaming"
          ? sanitizeAssistantText(part.text)
          : undefined,
      )
      .filter((part): part is string => Boolean(part))
      .join("\n\n")
      .trim();
    if (content) {
      let turnStart = index;
      while (turnStart > 0 && messages[turnStart - 1]?.role !== "user") {
        turnStart -= 1;
      }
      const turnMessages = messages.slice(turnStart, index + 1);
      const chart = latestAssistantChart(turnMessages);
      return {
        content,
        sources: collectAssistantReportSources(turnMessages),
        ...(chart ? { chart } : {}),
      };
    }
  }
  return undefined;
}

function defaultReportName(scopeLabel: string): string {
  const friendlyScope =
    scopeLabel.split(" · ", 2).at(-1)?.trim() || "Workspace";
  return `${friendlyScope} analysis`.slice(0, 120);
}

function defaultChartName(
  chartTitle: string | undefined,
  scopeLabel: string,
): string {
  return (
    chartTitle?.trim() ||
    `${scopeLabel.split(" · ", 2).at(-1)?.trim() || "Workspace"} chart`
  ).slice(0, 120);
}

function formatReportDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
}

function describePageScope(context?: AssistantPageContext): string {
  if (context?.view) {
    const viewName = sanitizeAssistantText(
      context.view.name?.trim() || "Current view",
    );
    const tableName = context.table?.name?.trim()
      ? sanitizeAssistantText(context.table.name)
      : undefined;
    return tableName
      ? `View · ${viewName} in ${tableName}`
      : `View · ${viewName}`;
  }
  if (context?.form) {
    return `Form · ${sanitizeAssistantText(
      context.form.name?.trim() || "Current form",
    )}`;
  }
  if (context?.table) {
    return `Table · ${sanitizeAssistantText(
      context.table.name?.trim() || "Current table",
    )}`;
  }
  if (context?.base) {
    return `Base · ${sanitizeAssistantText(
      context.base.name?.trim() || "Current base",
    )}`;
  }
  return "Current workspace";
}

function splitApprovalDetails(details: AssistantToolDetail[]): {
  changes: ApprovalDiffRow[];
  remaining: AssistantToolDetail[];
} {
  const changes: ApprovalDiffRow[] = [];
  const used = new Set<number>();

  details.forEach((beforeDetail, beforeIndex) => {
    if (used.has(beforeIndex)) return;

    const exactBefore = /^before$/i.test(beforeDetail.label.trim());
    const suffixMatch = beforeDetail.label.match(/^(.*?)\s+before$/i);
    if (!exactBefore && !suffixMatch) return;

    const label = suffixMatch?.[1]?.trim() || "Change";
    const afterIndex = details.findIndex((candidate, candidateIndex) => {
      if (candidateIndex === beforeIndex || used.has(candidateIndex)) {
        return false;
      }
      return exactBefore
        ? /^after$/i.test(candidate.label.trim())
        : candidate.label.trim().toLocaleLowerCase() ===
            `${label} after`.toLocaleLowerCase();
    });
    if (afterIndex < 0) return;

    const afterDetail = details[afterIndex];
    if (!afterDetail) return;
    used.add(beforeIndex);
    used.add(afterIndex);
    changes.push({
      after: afterDetail.value,
      afterLabel: afterDetail.label,
      before: beforeDetail.value,
      beforeLabel: beforeDetail.label,
      label,
    });
  });

  return {
    changes,
    remaining: details.filter((_, index) => !used.has(index)),
  };
}

function assistantTargetReference(
  toolName: string,
  input: unknown,
): AssistantTargetReference | undefined {
  const values = assistantObject(input);
  const baseId = assistantString(values?.baseId);
  if (!baseId) return undefined;

  const baseHref = `/bases/${encodeURIComponent(baseId)}`;
  const tableId = assistantString(values?.tableId);
  const formId = assistantString(values?.formId);
  const recordId = assistantString(values?.recordId);

  if (
    (toolName === "update_record" || toolName === "delete_record") &&
    tableId &&
    recordId
  ) {
    return {
      href: `${baseHref}/tables/${encodeURIComponent(tableId)}?record=${encodeURIComponent(recordId)}`,
      label: "Open record",
    };
  }

  if (
    [
      "create_field",
      "create_record",
      "delete_field",
      "describe_table",
      "list_records",
      "summarize_table",
    ].includes(toolName) &&
    tableId
  ) {
    return {
      href: `${baseHref}/tables/${encodeURIComponent(tableId)}`,
      label: "Open table",
    };
  }

  if (
    ["form_analytics", "inspect_form", "update_form_settings"].includes(
      toolName,
    ) &&
    formId
  ) {
    return {
      href: `${baseHref}/forms/${encodeURIComponent(formId)}`,
      label: "Open form",
    };
  }

  if (toolName === "create_form") {
    return {
      href: baseHref,
      label: "Open base",
    };
  }

  return undefined;
}

function assistantObject(
  value: unknown,
): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function assistantString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function isApprovalRequest(
  request: EveMessageInputRequest | undefined,
): boolean {
  if (!request || request.display !== "confirmation") return false;
  const optionIds = new Set(request.options?.map((option) => option.id));
  return optionIds.has("approve") && optionIds.has("deny");
}

function toolStateLabel(state: EveDynamicToolPart["state"], approval: boolean): string {
  switch (state) {
    case "approval-requested":
      return "Your approval is required";
    case "approval-responded":
      return "Decision received";
    case "input-available":
      return approval ? "Preparing proposal" : "Reading workspace";
    case "output-available":
      return "Completed";
    case "output-denied":
      return "Change not approved";
    case "output-error":
      return "Could not complete change";
    default:
      return "Working";
  }
}

function formatBytes(size?: number): string | undefined {
  if (size === undefined) {
    return undefined;
  }
  if (size < 1_024) {
    return `${size} B`;
  }
  if (size < 1_024 * 1_024) {
    return `${(size / 1_024).toFixed(1)} KB`;
  }
  return `${(size / (1_024 * 1_024)).toFixed(1)} MB`;
}

function messagePartKey(part: EveMessagePart, index: number): string {
  switch (part.type) {
    case "authorization":
      return `authorization:${part.turnId}:${part.stepIndex}:${part.name}`;
    case "dynamic-tool":
      return part.toolCallId;
    default:
      return `${part.type}:${index}`;
  }
}
