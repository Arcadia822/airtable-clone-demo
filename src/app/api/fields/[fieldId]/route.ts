import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"
import { deleteField, updateField } from "@/server/services/fields"

export const runtime = "nodejs"

type Context = { params: Promise<{ fieldId: string }> }

export async function PATCH(request: Request, context: Context) {
  try {
    const session = await requireSession(request)
    const { fieldId } = await context.params
    const db = await getDb()
    const body = await request.json().catch(() => ({}))
    return jsonOk(await updateField(db, session.orgId, fieldId, body))
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const session = await requireSession(request)
    const { fieldId } = await context.params
    const db = await getDb()
    return jsonOk(await deleteField(db, session.orgId, fieldId))
  } catch (error) {
    return jsonError(error)
  }
}
