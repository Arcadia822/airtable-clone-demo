import { NextResponse } from "next/server"
import { ZodError } from "zod"

import { AppError, type AppErrorCode } from "@/lib/domain"

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  QUOTA_EXCEEDED: 429,
  FORM_UPDATED: 409,
  FORM_CLOSED: 410,
  RATE_LIMITED: 429,
  REVISION_CONFLICT: 409,
  VALIDATION_ERROR: 400,
  BILLING_UNAVAILABLE: 503,
}

/**
 * Transport-level codes that are not (yet) part of the `AppErrorCode` union.
 *
 * They are kept here instead of widening the shared domain union so the API
 * boundary owns its own vocabulary. `HttpStatusError` is deliberately not an
 * `AppError`: `AppError` means "a handled domain failure", while these are
 * request-lifecycle failures (misconfigured deployment, expired upload
 * session, challenge verification).
 */
const STATUS_BY_TRANSPORT_CODE: Record<string, number> = {
  AUTH_NOT_CONFIGURED: 503,
  AUTH_INSECURE_ORIGIN: 503,
  AUTH_START_FAILED: 502,
  TURNSTILE_INVALID: 403,
  TURNSTILE_UNAVAILABLE: 503,
  UPLOAD_SESSION_CONSUMED: 409,
  UPLOAD_SESSION_EXPIRED: 409,
  RATE_LIMITED: 429,
}

export class HttpStatusError extends Error {
  readonly status: number

  constructor(
    public readonly code: string,
    message: string,
    status?: number,
    public readonly details?: Record<string, unknown>,
    public readonly headers?: Record<string, string>,
  ) {
    super(message)
    this.name = "HttpStatusError"
    this.status = status ?? STATUS_BY_TRANSPORT_CODE[code] ?? 500
  }
}

export function jsonOk<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status })
}

/** Patterns whose values must never reach logs: credentials or bearer secrets. */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\/\/[^/\s@]+:[^/\s@]+@/g, "//***:***@"],
  [/\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 ***"],
  [
    /\b(token|secret|password|passwd|api[_-]?key|authorization)\b(\s*[=:]\s*)("?)[^"\s,;]{4,}\3/gi,
    "$1$2$3***$3",
  ],
]

export function redactSecrets(text: string): string {
  let output = text
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement)
  }
  return output
}

/**
 * Logs the real failure server-side. The client only receives the error id, so
 * the operator can correlate a support report with this line without exposing
 * internals (or credentials) in the response.
 */
export function logServerError(errorId: string, error: unknown): void {
  if (error instanceof Error) {
    console.error(`[api:${errorId}] ${error.name}: ${redactSecrets(error.message)}`, {
      stack: error.stack ? redactSecrets(error.stack) : undefined,
    })
    return
  }
  console.error(`[api:${errorId}]`, redactSecrets(String(error)))
}

export function jsonError(
  err: unknown,
): NextResponse<{ code: string; message: string; details?: unknown; errorId?: string }> {
  if (err instanceof AppError) {
    return NextResponse.json(
      {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
      { status: STATUS_BY_CODE[err.code] ?? 400 },
    )
  }

  if (err instanceof HttpStatusError) {
    return NextResponse.json(
      {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
      {
        status: err.status,
        ...(err.headers ? { headers: err.headers } : {}),
      },
    )
  }

  if (err instanceof ZodError) {
    const first = err.issues[0]
    return NextResponse.json(
      {
        code: "VALIDATION_ERROR",
        message: first?.message ?? "Invalid request payload.",
        details: err.issues,
      },
      { status: 400 },
    )
  }

  const errorId = crypto.randomUUID()
  logServerError(errorId, err)
  return NextResponse.json(
    {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      errorId,
    },
    { status: 500 },
  )
}

/* -------------------------------------------------------------------------- */
/* Client identity + origins                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Best-effort client IP for per-visitor throttling. `x-real-ip` and
 * `cf-connecting-ip` are set by the platform proxy; the first `x-forwarded-for`
 * entry is the browser's address. Values are attacker-controlled on a direct
 * (non-proxied) deployment, which is why throttling treats them as a hint and
 * never as an authorization signal.
 */
export function clientIp(request: Request): string {
  const headers = request.headers
  const realIp = headers.get("x-real-ip")?.trim()
  if (realIp) return realIp
  const cfIp = headers.get("cf-connecting-ip")?.trim()
  if (cfIp) return cfIp
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  if (forwarded) return forwarded
  return "unknown"
}

/** Normalizes a configured host or URL into a scheme://host:port origin. */
export function normalizeOrigin(raw: string | null | undefined): string | undefined {
  const value = raw?.trim()
  if (!value) return undefined
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`
  try {
    return new URL(candidate).origin
  } catch {
    return undefined
  }
}

/**
 * Origins this deployment may legitimately be served from. Mirrors
 * `resolveAppOrigin` (auth.ts) and adds the concrete request host so that a
 * preview URL and its custom domain both pass the CSRF check.
 */
export function allowedRequestOrigins(request: Request): Set<string> {
  const allowed = new Set<string>()
  const add = (value: string | null | undefined) => {
    const origin = normalizeOrigin(value)
    if (origin) allowed.add(origin)
  }

  try {
    allowed.add(new URL(request.url).origin)
  } catch {
    // A malformed request URL cannot vouch for any origin.
  }
  add(process.env.NEXT_PUBLIC_APP_URL)
  add(process.env.FACTORY_PREVIEW_HOST)

  const host = request.headers.get("host")
  if (host) {
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
    const proto =
      forwardedProto === "http" || forwardedProto === "https"
        ? forwardedProto
        : (() => {
            try {
              return new URL(request.url).protocol.replace(":", "")
            } catch {
              return undefined
            }
          })()
    if (proto) add(`${proto}://${host}`)
  }

  return allowed
}

/**
 * CSRF guard for cookie-authenticated, state-changing requests.
 *
 * Browsers always attach `Origin` to cross-site POST/PATCH/DELETE, so a
 * missing header means a non-browser client (which cannot be tricked into
 * replaying a victim's cookies). When `Sec-Fetch-Site` is present we only
 * accept `same-origin`/`none`; `same-site` is rejected because a sibling
 * subdomain is not ours to trust.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (!origin) {
    const site = request.headers.get("sec-fetch-site")?.toLowerCase()
    if (!site) return true
    return site === "same-origin" || site === "none"
  }
  const normalized = normalizeOrigin(origin)
  if (!normalized) return false
  return allowedRequestOrigins(request).has(normalized)
}

/**
 * Enforces the check above. Call it at the top of every cookie-authenticated
 * `POST`/`PATCH`/`PUT`/`DELETE` handler. Routes that still lack it (records,
 * tables, fields, views, forms, preferences, auth logout) must adopt the same
 * call; they are intentionally left to their owners so this slice can land
 * without touching their files.
 */
export function requireSameOrigin(request: Request): void {
  if (!isSameOriginRequest(request)) {
    throw new AppError("FORBIDDEN", "This request came from an untrusted origin.")
  }
}

/* -------------------------------------------------------------------------- */
/* Fixed-window rate limiting                                                 */
/* -------------------------------------------------------------------------- */

interface RateLimitBucket {
  count: number
  resetAt: number
}

const RATE_LIMIT_BUCKETS = new Map<string, RateLimitBucket>()
const RATE_LIMIT_MAX_BUCKETS = 10_000
const RATE_LIMIT_PRUNE_EVERY = 256
let rateLimitCalls = 0

function pruneRateLimitBuckets(now: number): void {
  for (const [key, bucket] of RATE_LIMIT_BUCKETS) {
    if (bucket.resetAt <= now) RATE_LIMIT_BUCKETS.delete(key)
  }
  // Map iteration follows insertion order, so dropping the head evicts the
  // oldest windows first when a burst of distinct keys fills the table.
  while (RATE_LIMIT_BUCKETS.size > RATE_LIMIT_MAX_BUCKETS) {
    const oldest = RATE_LIMIT_BUCKETS.keys().next().value
    if (oldest === undefined) break
    RATE_LIMIT_BUCKETS.delete(oldest)
  }
}

/**
 * Per-key fixed window limiter. In-memory by design: it protects a single
 * instance from a burst, and the platform proxy is the outer bound. Expired
 * windows are pruned periodically and the table is capped so a spray of unique
 * keys cannot grow memory without bound.
 */
export function enforceRateLimit(options: {
  key: string
  limit: number
  windowMs: number
}): void {
  const now = Date.now()
  rateLimitCalls += 1
  if (rateLimitCalls % RATE_LIMIT_PRUNE_EVERY === 0) pruneRateLimitBuckets(now)

  const bucket = RATE_LIMIT_BUCKETS.get(options.key)
  if (!bucket || bucket.resetAt <= now) {
    if (RATE_LIMIT_BUCKETS.size >= RATE_LIMIT_MAX_BUCKETS) {
      pruneRateLimitBuckets(now)
    }
    RATE_LIMIT_BUCKETS.set(options.key, { count: 1, resetAt: now + options.windowMs })
    return
  }

  bucket.count += 1
  if (bucket.count > options.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    throw new HttpStatusError(
      "RATE_LIMITED",
      "Too many requests. Wait a moment and retry.",
      429,
      { retryAfterSeconds },
      { "Retry-After": String(retryAfterSeconds) },
    )
  }
}

/** Clears limiter state; only for tests that must not inherit prior windows. */
export function resetRateLimitsForTests(): void {
  RATE_LIMIT_BUCKETS.clear()
  rateLimitCalls = 0
}

/* -------------------------------------------------------------------------- */
/* Cloudflare Turnstile                                                       */
/* -------------------------------------------------------------------------- */

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify"
const TURNSTILE_MAX_TOKEN_LENGTH = 4096

export function isTurnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim())
}

/**
 * Verifies a Turnstile token server-side. Disabled unless
 * `TURNSTILE_SECRET_KEY` is set, so public forms keep working without the
 * Cloudflare account. The client must submit the widget token as
 * `cf-turnstile-response` (JSON body field) or the header of the same name.
 */
export async function verifyTurnstileToken(
  request: Request,
  token: string | null | undefined,
): Promise<void> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim()
  if (!secret) return

  const response = token?.trim()
  if (!response || response.length > TURNSTILE_MAX_TOKEN_LENGTH) {
    throw new HttpStatusError(
      "TURNSTILE_INVALID",
      "Complete the verification before submitting.",
      403,
    )
  }

  const body = new URLSearchParams({ secret, response })
  const ip = clientIp(request)
  if (ip !== "unknown") body.set("remoteip", ip)

  let payload: { success?: boolean; "error-codes"?: string[] } | null = null
  try {
    const upstream = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body,
      cache: "no-store",
    })
    payload = (await upstream.json().catch(() => null)) as {
      success?: boolean
      "error-codes"?: string[]
    } | null
  } catch (error) {
    logServerError("turnstile", error)
    throw new HttpStatusError(
      "TURNSTILE_UNAVAILABLE",
      "Verification is temporarily unavailable. Please try again shortly.",
      503,
    )
  }

  if (payload?.success !== true) {
    throw new HttpStatusError(
      "TURNSTILE_INVALID",
      "The verification expired or could not be confirmed. Complete it again and retry.",
      403,
    )
  }
}

/** Reads the Turnstile token from a JSON body value or the request header. */
export function turnstileTokenFrom(
  request: Request,
  body: Record<string, unknown> | null | undefined,
): string | undefined {
  const fromHeader = request.headers.get("cf-turnstile-response") ?? undefined
  const fromBody = body?.["cf-turnstile-response"] ?? body?.turnstileToken
  if (typeof fromBody === "string") return fromBody
  return fromHeader
}
