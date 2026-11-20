/**
 * Server-only client for Factory's managed `app-ai` protocol
 * (`apps/app/lib/app-ai/runtime.ts`) plus an opt-in OpenAI-compatible fallback.
 *
 * Credentials are read from the process environment at call time and never
 * logged, echoed, or included in errors. This module must not be imported from
 * client components.
 *
 * Retries always reuse the caller's `requestId`: when the upstream answers
 * `request-pending`, the client surfaces a retryable error and the caller sends
 * the same request again instead of minting a new identifier.
 */

export type FactoryAiRole = "system" | "user" | "assistant"

export interface FactoryAiMessage {
  role: FactoryAiRole
  content: string
}

export type FactoryAiErrorCode =
  | "ai-unavailable"
  | "request-pending"
  | "credits-exhausted"
  | "schema-invalid"
  | "provider-failed"
  | "unauthorized"

export const FACTORY_AI_ERROR_MESSAGES: Record<FactoryAiErrorCode, string> = {
  "ai-unavailable":
    "The AI assistant is not available right now. Try again in a moment.",
  "credits-exhausted":
    "This workspace has used all of its AI credits. A workspace admin can add more.",
  "provider-failed":
    "The AI assistant could not finish that request. Try again.",
  "request-pending":
    "Your previous request is still running. Retry to reconnect to it.",
  "schema-invalid":
    "The assistant could not turn that into a safe workspace change. Try rephrasing the request.",
  unauthorized:
    "The assistant connection could not be verified. Reload the page and try again.",
}

const RETRYABLE: ReadonlySet<FactoryAiErrorCode> = new Set([
  "ai-unavailable",
  "provider-failed",
  "request-pending",
])

export type FactoryAiUsage = Record<string, number>

export type FactoryAiStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; requestId: string; usage?: FactoryAiUsage }
  | {
      type: "error"
      code: FactoryAiErrorCode
      message: string
      retryable: boolean
    }

export class FactoryAiError extends Error {
  readonly code: FactoryAiErrorCode
  readonly retryable: boolean
  readonly requestId?: string

  constructor(
    code: FactoryAiErrorCode,
    options?: {
      message?: string
      requestId?: string
      retryable?: boolean
    },
  ) {
    super(options?.message ?? FACTORY_AI_ERROR_MESSAGES[code])
    this.name = "FactoryAiError"
    this.code = code
    this.requestId = options?.requestId
    this.retryable = options?.retryable ?? RETRYABLE.has(code)
  }
}

export interface FactoryAiRequest {
  requestId: string
  messages: readonly FactoryAiMessage[]
  schema?: Record<string, unknown>
  signal?: AbortSignal
  lastEventId?: string
}

export interface CallFactoryAiResult {
  requestId: string
  text: string
  usage?: FactoryAiUsage
}

interface FactoryAiConfig {
  token: string
  url: string
}

interface LlmGatewayConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export function isFactoryAiConfigured(): boolean {
  return Boolean(
    process.env.FACTORY_APP_AI_URL?.trim() &&
      process.env.FACTORY_APP_AI_TOKEN?.trim(),
  )
}

export function isAssistantAiConfigured(): boolean {
  return isFactoryAiConfigured() || Boolean(readLlmGatewayConfig())
}

/**
 * Streams the assistant response. Protocol-level failures arrive as `error`
 * events; transport failures (missing configuration, network errors, aborted
 * requests) throw `FactoryAiError`.
 */
export async function* streamFactoryAi(
  request: FactoryAiRequest,
): AsyncGenerator<FactoryAiStreamEvent> {
  const factory = readFactoryAiConfig()
  if (factory) {
    yield* streamFactoryProtocol(factory, request)
    return
  }

  const fallback = readLlmGatewayConfig()
  if (fallback) {
    yield* streamOpenAiCompatible(fallback, request)
    return
  }

  throw new FactoryAiError("ai-unavailable", { requestId: request.requestId })
}

export async function callFactoryAi(
  request: FactoryAiRequest & { onDelta?: (text: string) => void },
): Promise<CallFactoryAiResult> {
  let text = ""
  let finalRequestId = request.requestId
  let usage: FactoryAiUsage | undefined

  for await (const event of streamFactoryAi(request)) {
    if (event.type === "delta") {
      text += event.text
      request.onDelta?.(event.text)
      continue
    }
    if (event.type === "done") {
      finalRequestId = event.requestId
      usage = event.usage
      continue
    }
    throw new FactoryAiError(event.code, {
      message: event.message,
      requestId: finalRequestId,
      retryable: event.retryable,
    })
  }

  return { requestId: finalRequestId, text, usage }
}

async function* streamFactoryProtocol(
  config: FactoryAiConfig,
  request: FactoryAiRequest,
): AsyncGenerator<FactoryAiStreamEvent> {
  let response: Response
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(request.lastEventId ? { "Last-Event-ID": request.lastEventId } : {}),
      },
      body: JSON.stringify({
        requestId: request.requestId,
        messages: request.messages,
        ...(request.schema ? { schema: request.schema } : {}),
      }),
      signal: request.signal,
      cache: "no-store",
    })
  } catch (error) {
    throw transportError(error, request)
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "")
    throw responseError(response.status, bodyText, request)
  }
  if (!response.body) {
    throw new FactoryAiError("ai-unavailable", {
      requestId: request.requestId,
    })
  }

  for await (const frame of readSseFrames(response.body)) {
    if (frame.data === "[DONE]") continue
    const payload = parseJsonObject(frame.data)
    const type =
      frame.event ??
      (typeof payload?.type === "string" ? payload.type : undefined)

    if (type === "delta") {
      const text = typeof payload?.text === "string" ? payload.text : ""
      if (text) yield { type: "delta", text }
      continue
    }

    if (type === "done") {
      yield {
        type: "done",
        requestId:
          typeof payload?.requestId === "string"
            ? payload.requestId
            : request.requestId,
        ...(readUsage(payload?.usage)
          ? { usage: readUsage(payload?.usage) }
          : {}),
      }
      return
    }

    if (type === "error") {
      const code = normalizeErrorCode(payload?.error)
      yield {
        type: "error",
        code,
        message: FACTORY_AI_ERROR_MESSAGES[code],
        retryable: RETRYABLE.has(code),
      }
      return
    }
  }

  throw new FactoryAiError("provider-failed", {
    requestId: request.requestId,
  })
}

async function* streamOpenAiCompatible(
  config: LlmGatewayConfig,
  request: FactoryAiRequest,
): AsyncGenerator<FactoryAiStreamEvent> {
  const messages: FactoryAiMessage[] = request.schema
    ? [
        ...request.messages,
        {
          role: "system",
          content: `Respond with a single JSON object that conforms to this JSON Schema and nothing else:\n${JSON.stringify(request.schema)}`,
        },
      ]
    : [...request.messages]

  let response: Response
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
      }),
      signal: request.signal,
      cache: "no-store",
    })
  } catch (error) {
    throw transportError(error, request)
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "")
    throw responseError(response.status, bodyText, request)
  }
  if (!response.body) {
    throw new FactoryAiError("ai-unavailable", {
      requestId: request.requestId,
    })
  }

  let completed = false
  for await (const frame of readSseFrames(response.body)) {
    if (frame.data === "[DONE]") {
      completed = true
      break
    }
    const payload = parseJsonObject(frame.data)
    if (!payload) continue

    if (payload.error !== undefined) {
      const code = normalizeErrorCode(payload.error)
      yield {
        type: "error",
        code,
        message: FACTORY_AI_ERROR_MESSAGES[code],
        retryable: RETRYABLE.has(code),
      }
      return
    }

    const text = openAiDeltaText(payload)
    if (text) yield { type: "delta", text }
  }

  if (!completed) {
    throw new FactoryAiError("provider-failed", {
      requestId: request.requestId,
    })
  }

  yield { type: "done", requestId: request.requestId }
}

function openAiDeltaText(payload: Record<string, unknown>): string {
  const choices = payload.choices
  if (!Array.isArray(choices) || choices.length === 0) return ""
  const choice = choices[0]
  if (choice === null || typeof choice !== "object") return ""
  const delta = (choice as { delta?: unknown }).delta
  if (delta === null || typeof delta !== "object") return ""
  const content = (delta as { content?: unknown }).content
  return typeof content === "string" ? content : ""
}

function readFactoryAiConfig(): FactoryAiConfig | null {
  const url = process.env.FACTORY_APP_AI_URL?.trim().replace(/\/+$/, "")
  const token = process.env.FACTORY_APP_AI_TOKEN?.trim()
  if (!url || !token) return null
  return { url, token }
}

function readLlmGatewayConfig(): LlmGatewayConfig | null {
  if (process.env.FACTORY_APP_AI_URL?.trim()) return null
  const baseUrl = process.env.LLM_GATEWAY_BASE_URL?.trim().replace(/\/+$/, "")
  const apiKey = process.env.LLM_GATEWAY_API_KEY?.trim()
  const model = process.env.LLM_GATEWAY_MODEL?.trim()
  if (!baseUrl || !apiKey || !model) return null
  return { baseUrl, apiKey, model }
}

function transportError(
  error: unknown,
  request: FactoryAiRequest,
): FactoryAiError {
  if (error instanceof FactoryAiError) return error
  if (request.signal?.aborted) {
    return new FactoryAiError("provider-failed", {
      message: "The request was stopped. No changes were made.",
      requestId: request.requestId,
      retryable: false,
    })
  }
  return new FactoryAiError("ai-unavailable", {
    requestId: request.requestId,
  })
}

function responseError(
  status: number,
  bodyText: string,
  request: FactoryAiRequest,
): FactoryAiError {
  const normalized = bodyText.toLowerCase()
  if (status === 401 || status === 403) {
    return new FactoryAiError("unauthorized", {
      requestId: request.requestId,
    })
  }
  if (status === 402 || normalized.includes("credit")) {
    return new FactoryAiError("credits-exhausted", {
      requestId: request.requestId,
    })
  }
  if (status === 409 || normalized.includes("request-pending")) {
    return new FactoryAiError("request-pending", {
      requestId: request.requestId,
    })
  }
  if (status === 400 && normalized.includes("schema")) {
    return new FactoryAiError("schema-invalid", {
      requestId: request.requestId,
    })
  }
  if (status === 404 || status === 503) {
    return new FactoryAiError("ai-unavailable", {
      requestId: request.requestId,
    })
  }
  return new FactoryAiError("provider-failed", {
    requestId: request.requestId,
  })
}

function normalizeErrorCode(value: unknown): FactoryAiErrorCode {
  const raw =
    typeof value === "string"
      ? value
      : value !== null && typeof value === "object"
        ? [
            (value as Record<string, unknown>).code,
            (value as Record<string, unknown>).reason,
            (value as Record<string, unknown>).type,
            (value as Record<string, unknown>).message,
          ]
            .filter((item): item is string => typeof item === "string")
            .join(" ")
        : ""
  const text = raw.toLowerCase()

  if (text.includes("credit") || text.includes("quota")) {
    return "credits-exhausted"
  }
  if (text.includes("pending")) return "request-pending"
  if (text.includes("schema")) return "schema-invalid"
  if (
    text.includes("unauthor") ||
    text.includes("forbidden") ||
    text.includes("token") ||
    text.includes("session")
  ) {
    return "unauthorized"
  }
  if (text.includes("unavailable")) return "ai-unavailable"
  return "provider-failed"
}

interface SseFrame {
  data: string
  event?: string
}

async function* readSseFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseFrame> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let eventName: string | undefined
  let dataLines: string[] = []

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newline = buffer.indexOf("\n")
      while (newline >= 0) {
        let line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.endsWith("\r")) line = line.slice(0, -1)

        if (line === "") {
          if (dataLines.length > 0) {
            yield {
              data: dataLines.join("\n"),
              ...(eventName ? { event: eventName } : {}),
            }
          }
          eventName = undefined
          dataLines = []
          newline = buffer.indexOf("\n")
          continue
        }

        if (line.startsWith(":")) {
          newline = buffer.indexOf("\n")
          continue
        }

        const separator = line.indexOf(":")
        const field = separator === -1 ? line : line.slice(0, separator)
        let fieldValue = separator === -1 ? "" : line.slice(separator + 1)
        if (fieldValue.startsWith(" ")) fieldValue = fieldValue.slice(1)

        if (field === "event") eventName = fieldValue
        else if (field === "data") dataLines.push(fieldValue)

        newline = buffer.indexOf("\n")
      }
    }

    if (dataLines.length > 0) {
      yield {
        data: dataLines.join("\n"),
        ...(eventName ? { event: eventName } : {}),
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function readUsage(value: unknown): FactoryAiUsage | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }
  const usage: FactoryAiUsage = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) continue
    if (typeof entry !== "number" || !Number.isFinite(entry)) continue
    usage[key] = entry
    if (Object.keys(usage).length >= 8) break
  }
  return Object.keys(usage).length > 0 ? usage : undefined
}
