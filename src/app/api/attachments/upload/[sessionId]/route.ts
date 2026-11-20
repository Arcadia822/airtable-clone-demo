import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import {
  clientIp,
  enforceRateLimit,
  jsonError,
  jsonOk,
  requireSameOrigin,
} from "@/server/http"
import { storePublicUpload, storeUpload } from "@/server/services/attachments"

export const runtime = "nodejs"

type Context = { params: Promise<{ sessionId: string }> }

/** Uploads are heavier than the surrounding API calls, so the budget is small. */
const PUBLIC_UPLOAD_LIMIT = 20
const PUBLIC_UPLOAD_WINDOW_MS = 60_000

async function handleUpload(request: Request, context: Context) {
  try {
    const { sessionId } = await context.params
    const publicFormSlug = new URL(request.url).searchParams.get("publicFormSlug")
    const db = await getDb()

    if (publicFormSlug) {
      enforceRateLimit({
        key: `public-upload:${clientIp(request)}:${publicFormSlug}`,
        limit: PUBLIC_UPLOAD_LIMIT,
        windowMs: PUBLIC_UPLOAD_WINDOW_MS,
      })
      return jsonOk(await storePublicUpload(db, publicFormSlug, sessionId, request), 201)
    }

    requireSameOrigin(request)
    const session = await requireSession(request)
    return jsonOk(await storeUpload(db, session.orgId, sessionId, request), 201)
  } catch (error) {
    return jsonError(error)
  }
}

export async function PUT(request: Request, context: Context) {
  return handleUpload(request, context)
}

export async function POST(request: Request, context: Context) {
  return handleUpload(request, context)
}
