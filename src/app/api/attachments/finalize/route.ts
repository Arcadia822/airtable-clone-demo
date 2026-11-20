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
  finalizeAttachment,
  finalizePublicAttachment,
} from "@/server/services/attachments"

export const runtime = "nodejs"

const PUBLIC_FINALIZE_LIMIT = 20
const PUBLIC_FINALIZE_WINDOW_MS = 60_000

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
        key: `public-finalize:${clientIp(request)}:${publicFormSlug}`,
        limit: PUBLIC_FINALIZE_LIMIT,
        windowMs: PUBLIC_FINALIZE_WINDOW_MS,
      })
      return jsonOk(await finalizePublicAttachment(db, publicFormSlug, body), 201)
    }

    requireSameOrigin(request)
    const session = await requireSession(request)
    return jsonOk(
      await finalizeAttachment(db, session.orgId, session.userId, body),
      201,
    )
  } catch (error) {
    return jsonError(error)
  }
}
