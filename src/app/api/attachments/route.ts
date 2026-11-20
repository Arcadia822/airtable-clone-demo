import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"
import { listAttachments } from "@/server/services/attachments"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const session = await requireSession(request)
    const db = await getDb()
    const url = new URL(request.url)
    const ids = url.searchParams
      .getAll("ids")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean)
    return jsonOk(await listAttachments(db, session.orgId, ids))
  } catch (error) {
    return jsonError(error)
  }
}
