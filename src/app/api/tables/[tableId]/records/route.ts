import { getDb } from "@/db/client"
import { requireSession } from "@/server/auth"
import { jsonError, jsonOk, requireSameOrigin } from "@/server/http"
import { createRecord, deleteRecords, getRecords } from "@/server/services/records"

export const runtime = "nodejs"

type Context = { params: Promise<{ tableId: string }> }

export async function GET(request: Request, context: Context) {
  try {
    const session = await requireSession(request)
    const { tableId } = await context.params
    const db = await getDb()
    return jsonOk(await getRecords(db, session.orgId, tableId))
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request)
    const session = await requireSession(request)
    const { tableId } = await context.params
    const db = await getDb()
    const body = await request.json().catch(() => ({ values: {} }))
    return jsonOk(
      await createRecord(db, session.orgId, session.userId, tableId, body),
      201,
    )
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
    const body = await request.json().catch(() => ({}))
    return jsonOk(await deleteRecords(db, session.orgId, tableId, body))
  } catch (error) {
    return jsonError(error)
  }
}
