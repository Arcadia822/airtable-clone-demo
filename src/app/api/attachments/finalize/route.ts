import { getDb } from "@/db/client"
import { getServerSession } from "@/server/auth"
import { AppError } from "@/lib/domain"
import { jsonError, jsonOk } from "@/server/http"
import {
  finalizeAttachment,
  finalizePublicAttachment,
} from "@/server/services/attachments"

export const runtime = "nodejs"

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
      return jsonOk(await finalizePublicAttachment(db, publicFormSlug, body), 201)
    }

    const session = await getServerSession(request)
    if (!session.authenticated) {
      throw new AppError("UNAUTHORIZED", "Authentication required.")
    }
    return jsonOk(
      await finalizeAttachment(db, session.orgId, session.userId, body),
      201,
    )
  } catch (error) {
    return jsonError(error)
  }
}
