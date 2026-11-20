import { getDb } from "@/db/client"
import {
  clientIp,
  enforceRateLimit,
  jsonError,
  jsonOk,
  turnstileTokenFrom,
  verifyTurnstileToken,
} from "@/server/http"
import { submitPublicForm } from "@/server/services/forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface RouteContext {
  params: Promise<{ slug: string }>
}

const SUBMIT_LIMIT = 10
const SUBMIT_WINDOW_MS = 60_000

/**
 * Public submissions arrive as JSON. File and image questions must be uploaded
 * first through `/api/attachments`, then referenced here by their attachment
 * metadata.
 *
 * Throttled per IP and form, and (when `TURNSTILE_SECRET_KEY` is set) gated on
 * Cloudflare Turnstile. The widget token travels as a `cf-turnstile-response`
 * JSON field or request header.
 *
 * The transport also hands the service the respondent facts only it knows
 * (address, user agent, `Idempotency-Key`). A form that allows one response per
 * person keys that decision on them: without it every respondent would share a
 * single "anonymous" key, and the second person to answer would be told they
 * had already submitted.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { slug } = await context.params

    enforceRateLimit({
      key: `public-submit:${clientIp(request)}:${slug}`,
      limit: SUBMIT_LIMIT,
      windowMs: SUBMIT_WINDOW_MS,
    })

    let body: unknown = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    const fields =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null
    await verifyTurnstileToken(request, turnstileTokenFrom(request, fields))

    const db = await getDb()
    return jsonOk(
      await submitPublicForm(db, slug, body, {
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent") ?? "",
        idempotencyKey: request.headers.get("idempotency-key") ?? undefined,
      }),
      201,
    )
  } catch (error) {
    return jsonError(error)
  }
}
