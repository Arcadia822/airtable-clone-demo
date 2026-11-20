import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"
import { getBaseDashboard } from "@/server/services/bases"

export const runtime = "nodejs"

type Context = { params: Promise<{ baseId: string }> }

export async function GET(request: Request, context: Context) {
  try {
    const session = await requireSession(request)
    const { baseId } = await context.params
    const db = await getDb()
    return jsonOk(await getBaseDashboard(db, session.orgId, baseId))
  } catch (error) {
    return jsonError(error)
  }
}
