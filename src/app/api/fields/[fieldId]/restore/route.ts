import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"
import { restoreField } from "@/server/services/fields"

export const runtime = "nodejs"

type Context = { params: Promise<{ fieldId: string }> }

export async function POST(request: Request, context: Context) {
  try {
    const session = await requireSession(request)
    const { fieldId } = await context.params
    const db = await getDb()
    return jsonOk(await restoreField(db, session.orgId, fieldId))
  } catch (error) {
    return jsonError(error)
  }
}
