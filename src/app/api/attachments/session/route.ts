import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import {
  clientIp,
  enforceRateLimit,
  jsonError,
  jsonOk,
  requireSameOrigin,
} from "@/server/http"
import {
  createPublicUploadSession,
  createUploadSession,
} from "@/server/services/attachments"

export const runtime = "nodejs"

/** Anonymous respondents get a small upload budget per IP and form. */
const PUBLIC_SESSION_LIMIT = 20
const PUBLIC_SESSION_WINDOW_MS = 60_000

export async function POST(request: Request) {
  try {
    const url = new URL(request.url)
    const body = (await request.json().catch(() => ({}))) as {
      publicFormSlug?: unknown
    }
    const publicFormSlug =
      typeof body.publicFormSlug === "string" && body.publicFormSlug.trim()
        ? body.publicFormSlug.trim()
        : url.searchParams.get("publicFormSlug")

    const db = await getDb()
    if (publicFormSlug) {
      enforceRateLimit({
        key: `public-upload-session:${clientIp(request)}:${publicFormSlug}`,
        limit: PUBLIC_SESSION_LIMIT,
        windowMs: PUBLIC_SESSION_WINDOW_MS,
      })
      return jsonOk(await createPublicUploadSession(db, publicFormSlug, body), 201)
    }

    requireSameOrigin(request)
    const session = await requireSession(request)
    return jsonOk(
      await createUploadSession(db, session.orgId, session.userId, body),
      201,
    )
  } catch (error) {
    return jsonError(error)
  }
}
