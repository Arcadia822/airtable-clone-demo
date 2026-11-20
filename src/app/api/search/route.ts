import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"
import { searchWorkspace } from "@/server/services/search"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const session = await requireSession(request)
    const db = await getDb()
    const q = new URL(request.url).searchParams.get("q") ?? ""
    return jsonOk(await searchWorkspace(db, session.orgId, q))
  } catch (error) {
    return jsonError(error)
  }
}
