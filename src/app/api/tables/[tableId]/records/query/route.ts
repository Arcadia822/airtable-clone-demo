import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk, requireSameOrigin } from "@/server/http"
import { queryRecords } from "@/server/services/records"

export const runtime = "nodejs"

type Context = { params: Promise<{ tableId: string }> }

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request)
    const session = await requireSession(request)
    const { tableId } = await context.params
    const db = await getDb()
    const body = await request.json().catch(() => ({}))
    return jsonOk(await queryRecords(db, session.orgId, tableId, body))
  } catch (error) {
    return jsonError(error)
  }
}
