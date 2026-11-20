import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"
import { searchRecords } from "@/server/services/search"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const session = await requireSession(request)
    const db = await getDb()
    const params = new URL(request.url).searchParams
    const limitParam = params.get("limit")
    const limit = limitParam ? Number(limitParam) : undefined
    return jsonOk(
      await searchRecords(db, session.orgId, {
        q: params.get("q") ?? "",
        baseId: params.get("baseId") ?? undefined,
        tableId: params.get("tableId") ?? undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
      }),
    )
  } catch (error) {
    return jsonError(error)
  }
}
