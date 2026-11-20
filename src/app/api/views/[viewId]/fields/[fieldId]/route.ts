import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"
import { upsertViewFieldConfig } from "@/server/services/views"

export const runtime = "nodejs"

type Context = { params: Promise<{ viewId: string; fieldId: string }> }

export async function PATCH(request: Request, context: Context) {
  try {
    const session = await requireSession(request)
    const { viewId, fieldId } = await context.params
    const db = await getDb()
    const body = await request.json().catch(() => ({}))
    return jsonOk(
      await upsertViewFieldConfig(db, session.orgId, viewId, fieldId, body),
    )
  } catch (error) {
    return jsonError(error)
  }
}
