import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk, requireSameOrigin } from "@/server/http"
import { deleteTable, getTableBundle, updateTable } from "@/server/services/tables"

export const runtime = "nodejs"

type Context = { params: Promise<{ tableId: string }> }

export async function GET(request: Request, context: Context) {
  try {
    const session = await requireSession(request)
    const { tableId } = await context.params
    const db = await getDb()
    return jsonOk(await getTableBundle(db, session.orgId, tableId))
  } catch (error) {
    return jsonError(error)
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    requireSameOrigin(request)
    const session = await requireSession(request)
    const { tableId } = await context.params
    const db = await getDb()
    const body = await request.json().catch(() => ({}))
    return jsonOk(await updateTable(db, session.orgId, tableId, body))
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    requireSameOrigin(request)
    const session = await requireSession(request)
    const { tableId } = await context.params
    const db = await getDb()
    return jsonOk(await deleteTable(db, session.orgId, tableId))
  } catch (error) {
    return jsonError(error)
  }
}
