import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk, requireSameOrigin } from "@/server/http"
import { restoreRecord } from "@/server/services/records"

export const runtime = "nodejs"

type Context = { params: Promise<{ recordId: string }> }

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request)
    const session = await requireSession(request)
    const { recordId } = await context.params
    const db = await getDb()
    return jsonOk(await restoreRecord(db, session.orgId, recordId))
  } catch (error) {
    return jsonError(error)
  }
}
