import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk, requireSameOrigin } from "@/server/http"
import { deleteView, getView, updateView } from "@/server/services/views"

export const runtime = "nodejs"

type Context = { params: Promise<{ viewId: string }> }

export async function GET(request: Request, context: Context) {
  try {
    const session = await requireSession(request)
    const { viewId } = await context.params
    const db = await getDb()
    return jsonOk(await getView(db, session.orgId, viewId))
  } catch (error) {
    return jsonError(error)
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    requireSameOrigin(request)
    const session = await requireSession(request)
    const { viewId } = await context.params
    const db = await getDb()
    const body = await request.json().catch(() => ({}))
    return jsonOk(await updateView(db, session.orgId, viewId, body))
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    requireSameOrigin(request)
    const session = await requireSession(request)
    const { viewId } = await context.params
    const db = await getDb()
    return jsonOk(await deleteView(db, session.orgId, viewId))
  } catch (error) {
    return jsonError(error)
  }
}
