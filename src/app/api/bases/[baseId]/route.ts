import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk } from "@/server/http"
import { deleteBase, getBase, updateBase } from "@/server/services/bases"

export const runtime = "nodejs"

type Context = { params: Promise<{ baseId: string }> }

export async function GET(request: Request, context: Context) {
  try {
    const session = await requireSession(request)
    const { baseId } = await context.params
    const db = await getDb()
    return jsonOk(await getBase(db, session.orgId, baseId))
  } catch (error) {
    return jsonError(error)
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const session = await requireSession(request)
    const { baseId } = await context.params
    const db = await getDb()
    const body = await request.json().catch(() => ({}))
    return jsonOk(await updateBase(db, session.orgId, baseId, body))
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const session = await requireSession(request)
    const { baseId } = await context.params
    const db = await getDb()
    return jsonOk(await deleteBase(db, session.orgId, baseId))
  } catch (error) {
    return jsonError(error)
  }
}
