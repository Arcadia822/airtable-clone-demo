"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type {
  AssistantChart,
  AssistantCitation,
  AssistantProposal,
  AssistantStreamEvent,
} from "@/lib/eve/contracts"
import type { AssistantPageContext } from "@/lib/eve/page-context"

export type AssistantChatStatus = "error" | "complete" | "streaming"

export interface AssistantToolResult {
  data: unknown
  tool: string
}

export interface AssistantChatMessage {
  chart?: AssistantChart
  citations?: AssistantCitation[]
  content: string
  error?: AssistantFailure
  id: string
  role: "assistant" | "user"
  status: AssistantChatStatus
  toolResults: AssistantToolResult[]
}

export interface AssistantFailure {
  code: string
  message: string
  retryable: boolean
}

export type AssistantProposalStatus =
  | "pending"
  | "saving"
  | "applied"
  | "denied"
  | "failed"

export interface AssistantProposalState extends AssistantProposal {
  error?: string
  id: string
  resultSummary?: string
  status: AssistantProposalStatus
}

export interface SavedAssistantReport {
  baseId: string
  chart: AssistantChart | null
  citations: AssistantCitation[]
  content: string
  createdAt: number
  format: string
  id: string
  name: string
  scopeLabel: string
  tableId: string | null
}

export interface SaveAssistantReportInput {
  chart?: AssistantChart | null
  citations?: AssistantCitation[]
  content: string
  name: string
  scopeLabel?: string
}

export interface MutationResult {
  baseId?: string
  tableId?: string
}

export interface UseFactoryAiOptions {
  context?: AssistantPageContext
  onDataMutated?: (result?: MutationResult) => void
}

export interface UseFactoryAiResult {
  approveProposal: (proposalId: string) => Promise<void>
  cancel: () => void
  deleteReport: (reportId: string) => Promise<void>
  denyProposal: (proposalId: string) => void
  error?: AssistantFailure
  isSavingReport: boolean
  isStreaming: boolean
  messages: AssistantChatMessage[]
  proposals: AssistantProposalState[]
  refreshReports: () => Promise<void>
  reports: SavedAssistantReport[]
  retry: () => void
  saveReport: (input: SaveAssistantReportInput) => Promise<SavedAssistantReport>
  sendMessage: (text: string) => Promise<void>
}

interface PendingTurn {
  history: Array<{ content: string; role: "assistant" | "user" }>
  requestId: string
}

const CHAT_ENDPOINT = "/api/ai/chat"
const WRITE_ENDPOINT = "/api/ai/tools/write"
const REPORTS_ENDPOINT = "/api/ai/reports"

export function useFactoryAi(options: UseFactoryAiOptions = {}): UseFactoryAiResult {
  const { context, onDataMutated } = options
  const baseId = context?.base?.id
  const tableId = context?.table?.id

  const [messages, setMessages] = useState<AssistantChatMessage[]>([])
  const [proposals, setProposals] = useState<AssistantProposalState[]>([])
  const [reports, setReports] = useState<SavedAssistantReport[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isSavingReport, setIsSavingReport] = useState(false)
  const [error, setError] = useState<AssistantFailure | undefined>()

  const abortRef = useRef<AbortController | null>(null)
  const pendingTurnRef = useRef<PendingTurn | null>(null)
  const contextRef = useRef(context)
  const onDataMutatedRef = useRef(onDataMutated)

  useEffect(() => {
    contextRef.current = context
    onDataMutatedRef.current = onDataMutated
  })

  const patchMessage = useCallback(
    (
      messageId: string,
      update: (message: AssistantChatMessage) => AssistantChatMessage,
    ) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId ? update(message) : message,
        ),
      )
    },
    [],
  )

  const streamTurn = useCallback(
    async ({
      requestId,
      history,
      assistantId,
    }: {
      assistantId: string
      history: PendingTurn["history"]
      requestId: string
    }) => {
      const controller = new AbortController()
      abortRef.current = controller
      setIsStreaming(true)
      setError(undefined)

      let settled = false
      let sawProposal = false

      const applyEvent = (event: AssistantStreamEvent) => {
        switch (event.type) {
          case "delta":
            patchMessage(assistantId, (message) => ({
              ...message,
              content: message.content + event.text,
            }))
            return
          case "tool_result":
            patchMessage(assistantId, (message) => ({
              ...message,
              toolResults: [
                ...message.toolResults,
                { data: event.data, tool: event.tool },
              ].slice(-8),
            }))
            return
          case "chart":
            patchMessage(assistantId, (message) => ({
              ...message,
              chart: event.chart,
            }))
            return
          case "proposal":
            sawProposal = true
            setProposals((current) => [
              {
                ...event.proposal,
                id: createId("proposal"),
                status: "pending",
              },
              ...current,
            ])
            patchMessage(assistantId, (message) =>
              message.content.trim()
                ? message
                : {
                    ...message,
                    content:
                      "I prepared this change for your review. Nothing has been applied yet.",
                  },
            )
            return
          case "done":
            settled = true
            patchMessage(assistantId, (message) => ({
              ...message,
              citations: event.citations,
              content:
                message.content.trim() || message.chart || sawProposal
                  ? message.content
                  : "I could not find anything to report for that request.",
              status: "complete",
            }))
            pendingTurnRef.current = null
            return
          case "error":
            settled = true
            setError({
              code: event.code,
              message: event.message,
              retryable: event.retryable,
            })
            patchMessage(assistantId, (message) => ({
              ...message,
              error: {
                code: event.code,
                message: event.message,
                retryable: event.retryable,
              },
              status: "error",
            }))
            return
        }
      }

      try {
        const response = await fetch(CHAT_ENDPOINT, {
          body: JSON.stringify({
            context: contextRef.current,
            messages: history,
            requestId,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
          signal: controller.signal,
        })

        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => null)) as
            | { code?: string; message?: string }
            | null
          throw new ChatRequestError(
            payload?.message ?? "The assistant could not start that request.",
            payload?.code ?? "request-failed",
          )
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let boundary = buffer.indexOf("\n\n")
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const event = parseStreamFrame(frame)
            if (event) applyEvent(event)
            boundary = buffer.indexOf("\n\n")
          }
        }

        if (!settled) {
          patchMessage(assistantId, (message) =>
            message.status === "streaming"
              ? { ...message, status: "complete" }
              : message,
          )
        }
      } catch (thrown) {
        const aborted =
          controller.signal.aborted ||
          (thrown instanceof DOMException && thrown.name === "AbortError")
        if (aborted) {
          patchMessage(assistantId, (message) => ({
            ...message,
            status: "complete",
          }))
          return
        }
        const failure: AssistantFailure =
          thrown instanceof ChatRequestError
            ? {
                code: thrown.code,
                message: thrown.message,
                retryable: true,
              }
            : {
                code: "network-error",
                message:
                  "The assistant could not reach the workspace. Check your connection and try again.",
                retryable: true,
              }
        setError(failure)
        patchMessage(assistantId, (message) => ({
          ...message,
          error: failure,
          status: "error",
        }))
      } finally {
        setIsStreaming(false)
        abortRef.current = null
      }
    },
    [patchMessage],
  )

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || isStreaming) return

      const history = [
        ...messages
          .filter((message) => message.status !== "error")
          .map((message) => ({
            content: message.content,
            role: message.role,
          }))
          .filter((message) => message.content.trim().length > 0),
        { content: trimmed, role: "user" as const },
      ]

      const requestId = createId("req")
      const userMessage: AssistantChatMessage = {
        content: trimmed,
        id: createId("msg"),
        role: "user",
        status: "complete",
        toolResults: [],
      }
      const assistantId = createId("msg")

      pendingTurnRef.current = { history, requestId }
      setMessages((current) => [
        ...current,
        userMessage,
        {
          content: "",
          id: assistantId,
          role: "assistant",
          status: "streaming",
          toolResults: [],
        },
      ])

      await streamTurn({ assistantId, history, requestId })
    },
    [isStreaming, messages, streamTurn],
  )

  const retry = useCallback(() => {
    const pending = pendingTurnRef.current
    if (!pending || isStreaming) return

    setMessages((current) => {
      const withoutFailure = current.filter(
        (message) => message.status !== "error",
      )
      return withoutFailure
    })

    const assistantId = createId("msg")
    setMessages((current) => [
      ...current,
      {
        content: "",
        id: assistantId,
        role: "assistant",
        status: "streaming",
        toolResults: [],
      },
    ])
    setError(undefined)

    void streamTurn({
      assistantId,
      history: pending.history,
      requestId: pending.requestId,
    })
  }, [isStreaming, streamTurn])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsStreaming(false)
  }, [])

  const approveProposal = useCallback(async (proposalId: string) => {
    const proposal = proposals.find((item) => item.id === proposalId)
    if (!proposal || proposal.status !== "pending") return

    setProposals((current) =>
      current.map((item) =>
        item.id === proposalId ? { ...item, status: "saving" } : item,
      ),
    )

    try {
      const response = await fetch(WRITE_ENDPOINT, {
        body: JSON.stringify({
          input: proposal.input,
          operation: proposal.operation,
          token: proposal.token,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      const payload = (await response.json().catch(() => null)) as
        | {
            message?: string
            result?: {
              entityIds?: Record<string, string>
              summary?: string
            }
          }
        | null

      if (!response.ok) {
        throw new Error(payload?.message ?? "That change could not be applied.")
      }

      const entityIds = payload?.result?.entityIds ?? {}
      setProposals((current) =>
        current.map((item) =>
          item.id === proposalId
            ? {
                ...item,
                resultSummary:
                  payload?.result?.summary ?? "The approved change is complete.",
                status: "applied",
              }
            : item,
        ),
      )
      onDataMutatedRef.current?.({
        ...(entityIds.baseId ? { baseId: entityIds.baseId } : {}),
        ...(entityIds.tableId ? { tableId: entityIds.tableId } : {}),
      })
    } catch (thrown) {
      setProposals((current) =>
        current.map((item) =>
          item.id === proposalId
            ? {
                ...item,
                error:
                  thrown instanceof Error
                    ? thrown.message
                    : "That change could not be applied.",
                status: "failed",
              }
            : item,
        ),
      )
    }
  }, [proposals])

  const denyProposal = useCallback((proposalId: string) => {
    setProposals((current) =>
      current.map((item) =>
        item.id === proposalId && item.status === "pending"
          ? { ...item, status: "denied" }
          : item,
      ),
    )
  }, [])

  const refreshReports = useCallback(async () => {
    if (!baseId) {
      setReports([])
      return
    }
    try {
      const response = await fetch(
        `${REPORTS_ENDPOINT}?baseId=${encodeURIComponent(baseId)}${tableId ? `&tableId=${encodeURIComponent(tableId)}` : ""}`,
        { cache: "no-store" },
      )
      if (!response.ok) return
      const payload = (await response.json().catch(() => null)) as
        | { reports?: SavedAssistantReport[] }
        | null
      setReports(payload?.reports ?? [])
    } catch {
      // Saved reports are optional; keep the current list on failure.
    }
  }, [baseId, tableId])

  useEffect(() => {
    void refreshReports()
  }, [refreshReports])

  const saveReport = useCallback(
    async (input: SaveAssistantReportInput): Promise<SavedAssistantReport> => {
      if (!baseId) {
        throw new Error("Open a base before saving a report.")
      }
      setIsSavingReport(true)
      try {
        const response = await fetch(REPORTS_ENDPOINT, {
          body: JSON.stringify({
            baseId,
            chart: input.chart ?? null,
            citations: input.citations ?? [],
            content: input.content,
            format: input.chart ? "chart" : "markdown",
            name: input.name,
            scopeLabel: input.scopeLabel ?? "",
            tableId: tableId ?? null,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
        const payload = (await response.json().catch(() => null)) as
          | { message?: string; report?: SavedAssistantReport }
          | null
        if (!response.ok || !payload?.report) {
          throw new Error(payload?.message ?? "That report could not be saved.")
        }
        setReports((current) => [payload.report as SavedAssistantReport, ...current])
        return payload.report
      } finally {
        setIsSavingReport(false)
      }
    },
    [baseId, tableId],
  )

  const deleteReport = useCallback(async (reportId: string) => {
    const response = await fetch(
      `${REPORTS_ENDPOINT}/${encodeURIComponent(reportId)}`,
      { method: "DELETE" },
    )
    if (!response.ok) {
      throw new Error("That report could not be archived.")
    }
    setReports((current) => current.filter((report) => report.id !== reportId))
  }, [])

  return {
    approveProposal,
    cancel,
    deleteReport,
    denyProposal,
    ...(error ? { error } : {}),
    isSavingReport,
    isStreaming,
    messages,
    proposals,
    refreshReports,
    reports,
    retry,
    saveReport,
    sendMessage,
  }
}

class ChatRequestError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = "ChatRequestError"
    this.code = code
  }
}

function parseStreamFrame(frame: string): AssistantStreamEvent | undefined {
  const dataLines: string[] = []
  for (const line of frame.split("\n")) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""))
    }
  }
  if (dataLines.length === 0) return undefined
  try {
    const parsed = JSON.parse(dataLines.join("\n")) as {
      type?: unknown
    }
    if (typeof parsed?.type !== "string") return undefined
    return parsed as AssistantStreamEvent
  } catch {
    return undefined
  }
}

function createId(prefix: string): string {
  const globalCrypto = globalThis.crypto
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return `${prefix}_${globalCrypto.randomUUID()}`
  }
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}
